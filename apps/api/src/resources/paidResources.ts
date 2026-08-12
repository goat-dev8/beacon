import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Redis } from "@upstash/redis";
import { JsonRpcProvider, Wallet, Signature } from "ethers";
import { z } from "zod";
import {
  AppError,
  fulfillPaidResource,
  findPaidResource,
  PAID_RESOURCES,
  type BeaconEnv,
} from "@beacon/shared";
import {
  FacilitatorClient,
  parseUsdtAmount,
  assertX402PaymentFields,
  COSTON2_USDT0_LABEL,
} from "@beacon/x402";

type PaymentPayload = {
  from: string;
  to: string;
  token?: string;
  value: string;
  validAfter?: string;
  validBefore?: string;
  nonce: string;
  mode?: string;
  v?: number;
  r?: string;
  s?: string;
  signature?: string;
  chainId?: number;
  network?: string;
};

const memoryReceipts = new Map<string, { txHash: string; body: unknown; settledAt: number }>();
/** In-flight settles keyed by nonce — prevent double-charge races before receipt write. */
const settlingNonces = new Set<string>();

function resourceIdFromParam(param: string): string {
  return param.replace(/^\/v1\/agents\/resources\//, "").replace(/^\//, "");
}

function paymentRequirementFor(
  resourcePath: string,
  res: (typeof PAID_RESOURCES)[number],
  env: BeaconEnv,
) {
  return {
    scheme: "exact",
    network: "flare-coston2",
    maxAmountRequired: parseUsdtAmount(parseFloat(res.priceUsdt0)).toString(),
    resource: resourcePath,
    description: res.reason,
    mimeType: "application/json",
    payTo: env.X402_PAYEE_ADDRESS!,
    maxTimeoutSeconds: 300,
    asset: "USDT0",
    assetLabel: COSTON2_USDT0_LABEL,
    extra: {
      tokenAddress: env.X402_TOKEN_ADDRESS!,
      facilitatorAddress: env.X402_FACILITATOR_ADDRESS!,
      chainId: env.CHAIN_ID || 114,
      network: env.NETWORK_NAME || "coston2",
      serviceId: res.id,
      testnetOnly: true,
      settleMode: "erc20-transferFrom",
      faucet: "https://faucet.flare.network/coston2",
      eip712Note: "Coston2 faucet USDT0 has no EIP-3009. Approve the facilitator, then Beacon pulls.",
    },
  };
}

function parsePaymentPayload(req: FastifyRequest, body?: unknown): PaymentPayload | null {
  const header = req.headers["x-payment"];
  if (typeof header === "string" && header.length > 0) {
    try {
      return JSON.parse(Buffer.from(header, "base64").toString("utf-8")) as PaymentPayload;
    } catch {
      return null;
    }
  }
  if (body && typeof body === "object" && "payment" in body) {
    const payment = (body as { payment?: PaymentPayload }).payment;
    return payment ?? null;
  }
  return null;
}

function paymentSignature(payment: PaymentPayload): string | null {
  if (payment.mode === "erc20-pull") return null;
  if (payment.signature) return payment.signature;
  if (payment.r && payment.s && payment.v != null) {
    return Signature.from({ r: payment.r, s: payment.s, v: payment.v }).serialized;
  }
  return null;
}

function receiptKey(nonce: string): string {
  return `x402:receipt:${nonce.toLowerCase()}`;
}

async function readCachedReceipt(
  redis: Redis | null,
  nonce: string,
): Promise<{ txHash: string; body: unknown; settledAt?: number } | null> {
  const key = receiptKey(nonce);
  if (redis) {
    try {
      const hit = await redis.get<{ txHash: string; body: unknown; settledAt?: number }>(key);
      if (hit) return hit;
    } catch {
      // Fall through to memory — still prefer not to re-charge if local hit exists.
    }
  }
  return memoryReceipts.get(nonce.toLowerCase()) ?? null;
}

async function writeCachedReceipt(
  redis: Redis | null,
  nonce: string,
  receipt: { txHash: string; body: unknown; settledAt: number },
): Promise<void> {
  const key = receiptKey(nonce);
  memoryReceipts.set(nonce.toLowerCase(), receipt);
  if (redis) {
    try {
      await redis.set(key, receipt, { ex: 86_400 * 7 });
    } catch {
      // Memory map still holds idempotency for this process.
    }
  }
}

async function verifyAndSettlePayment(
  payment: PaymentPayload,
  exactAmount: bigint,
  env: BeaconEnv,
): Promise<{ txHash: string }> {
  const chainId = env.CHAIN_ID || 114;
  const network = env.NETWORK_NAME || "coston2";

  if (payment.chainId != null && payment.chainId !== chainId) {
    throw new AppError("VALIDATION", {
      message: `x402 network mismatch — expected chainId ${chainId} (${network}).`,
    });
  }
  if (payment.network) {
    const n = payment.network.toLowerCase().replace(/\s+/g, "-");
    if (!n.includes("coston2") && n !== "flare-coston2" && n !== network.toLowerCase()) {
      throw new AppError("VALIDATION", {
        message: `x402 network mismatch — expected ${network} / flare-coston2.`,
      });
    }
  }

  let fields;
  try {
    fields = assertX402PaymentFields(payment, {
      chainId,
      network,
      tokenAddress: env.X402_TOKEN_ADDRESS!,
      payeeAddress: env.X402_PAYEE_ADDRESS!,
      exactAmount,
    });
  } catch (err) {
    throw new AppError("PAYMENT_REQUIRED", {
      message: err instanceof Error ? err.message : "x402 payment fields invalid.",
    });
  }

  const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
  const client = new FacilitatorClient({
    facilitatorAddress: env.X402_FACILITATOR_ADDRESS!,
    tokenAddress: env.X402_TOKEN_ADDRESS!,
    provider,
  });
  const settlerKey = env.DEPLOYER_PRIVATE_KEY || env.SETTLER_PRIVATE_KEY;
  if (!settlerKey) {
    throw new AppError("SETTLE_FAILED", {
      message: "Payment settlement unavailable — settler private key not configured.",
      statusCode: 503,
    });
  }
  const wallet = new Wallet(settlerKey, provider);
  const erc20Pull = payment.mode === "erc20-pull" || !paymentSignature(payment);

  if (erc20Pull) {
    const [allowance, balance] = await Promise.all([
      client.readAllowance(payment.from),
      client.readBalance(payment.from),
    ]);
    if (allowance < fields.value) {
      throw new AppError("PAYMENT_REQUIRED", {
        message: `Approve ${env.X402_FACILITATOR_ADDRESS} to spend USDT0 first (allowance ${allowance.toString()}).`,
      });
    }
    if (balance < fields.value) {
      throw new AppError("PAYMENT_REQUIRED", {
        message: "Insufficient Coston2 USDT0. Get testnet USDT0 from https://faucet.flare.network/coston2",
      });
    }
    const settled = await client.settleTransferFrom(wallet, payment.from, payment.to, fields.value);
    if (!settled.success || !settled.txHash) {
      throw new AppError("SETTLE_FAILED", { message: "x402 ERC-20 settlement failed on-chain." });
    }
    return { txHash: settled.txHash };
  }

  const signature = paymentSignature(payment);
  if (!signature) {
    throw new AppError("VALIDATION", { message: "x402 payment signature missing." });
  }

  // EIP-3009 path (fixture MockUSDT0 only — faucet USDT0 has no authorizationState).
  const alreadyUsed = await client.isAuthorizationUsed(payment.from, fields.nonce);
  if (alreadyUsed) {
    throw new AppError("VALIDATION", {
      message: "x402 nonce already settled on-chain — resubmit with receipt replay or a new authorization.",
    });
  }

  const ok = await client.verifyPayment(
    payment.from,
    payment.to,
    fields.value,
    fields.validAfter,
    fields.validBefore,
    fields.nonce,
    signature,
  );
  if (!ok) {
    throw new AppError("VALIDATION", {
      message: "x402 payment authorization invalid (signature/domain).",
    });
  }

  const settled = await client.settlePayment(
    wallet,
    payment.from,
    payment.to,
    fields.value,
    fields.validAfter,
    fields.validBefore,
    fields.nonce,
    signature,
  );
  if (!settled.success || !settled.txHash) {
    throw new AppError("SETTLE_FAILED", { message: "x402 settlement failed on-chain." });
  }

  return { txHash: settled.txHash };
}

async function handlePaidResource(
  req: FastifyRequest,
  reply: FastifyReply,
  resourceId: string,
  redis: Redis | null,
  env: BeaconEnv,
) {
  const res = findPaidResource(resourceId);
  if (!res) {
    throw new AppError("JOB_NOT_FOUND", { message: "Paid resource not found." });
  }

  const resourcePath = `/v1/agents/resources/${resourceId}`;
  const query = req.query as { brief?: string };
  const bodySchema = z
    .object({
      brief: z.string().optional(),
      payment: z
        .object({
          from: z.string(),
          to: z.string(),
          token: z.string().optional(),
          value: z.string(),
          validAfter: z.string().optional(),
          validBefore: z.string().optional(),
          nonce: z.string(),
          mode: z.string().optional(),
          v: z.number().optional(),
          r: z.string().optional(),
          s: z.string().optional(),
          signature: z.string().optional(),
          chainId: z.number().optional(),
          network: z.string().optional(),
        })
        .optional(),
    })
    .optional();
  const parsedBody = bodySchema.parse(req.method === "POST" ? req.body ?? {} : {});

  const payment = parsePaymentPayload(req, parsedBody);
  if (!payment) {
    return reply.status(402).send({
      error: "Payment Required",
      x402Version: "1",
      accepts: [paymentRequirementFor(resourcePath, res, env)],
      honesty: COSTON2_USDT0_LABEL,
    });
  }

  const nonceKey = payment.nonce.toLowerCase();
  const cached = await readCachedReceipt(redis, payment.nonce);
  if (cached) {
    reply.header(
      "X-Payment-Response",
      Buffer.from(
        JSON.stringify({
          transactionHash: cached.txHash,
          settled: true,
          replay: true,
          asset: "USDT0",
          testnetOnly: true,
        }),
      ).toString("base64"),
    );
    return cached.body;
  }

  if (settlingNonces.has(nonceKey)) {
    throw new AppError("VALIDATION", {
      message: "x402 settlement already in progress for this nonce — retry shortly for receipt replay.",
      statusCode: 409,
    });
  }

  const exactAmount = parseUsdtAmount(parseFloat(res.priceUsdt0));
  settlingNonces.add(nonceKey);
  let txHash: string;
  try {
    ({ txHash } = await verifyAndSettlePayment(payment, exactAmount, env));
  } finally {
    settlingNonces.delete(nonceKey);
  }

  // Re-check receipt after settle (concurrent twin may have written).
  const raced = await readCachedReceipt(redis, payment.nonce);
  if (raced) {
    reply.header(
      "X-Payment-Response",
      Buffer.from(
        JSON.stringify({ transactionHash: raced.txHash, settled: true, replay: true }),
      ).toString("base64"),
    );
    return raced.body;
  }

  const brief = parsedBody?.brief ?? query.brief ?? "Paid resource request";
  const fulfilled = await fulfillPaidResource({
    serviceId: res.id,
    message: brief,
    creativeBrief: brief,
    settlementTxHash: txHash,
    env,
  });
  if (!fulfilled) {
    throw new AppError("INTERNAL", { message: "Resource fulfillment failed." });
  }

  const payload = {
    ok: true,
    resourceId: res.id,
    resource: resourcePath,
    settlementTxHash: txHash,
    agentId: fulfilled.agentId,
    text: fulfilled.text,
    cards: fulfilled.cards,
    asset: "USDT0",
    assetLabel: COSTON2_USDT0_LABEL,
    testnetOnly: true,
    network: env.NETWORK_NAME || "coston2",
    chainId: env.CHAIN_ID || 114,
  };

  await writeCachedReceipt(redis, payment.nonce, {
    txHash,
    body: payload,
    settledAt: Date.now(),
  });

  reply.header(
    "X-Payment-Response",
    Buffer.from(
      JSON.stringify({
        transactionHash: txHash,
        settled: true,
        asset: "USDT0",
        testnetOnly: true,
      }),
    ).toString("base64"),
  );
  return payload;
}

export async function registerPaidResourceRoutes(
  app: FastifyInstance,
  redis: Redis | null,
  env: BeaconEnv,
) {
  if (!env.X402_TOKEN_ADDRESS || !env.X402_FACILITATOR_ADDRESS || !env.X402_PAYEE_ADDRESS) {
    app.log.warn("x402 resource routes disabled — missing token/facilitator/payee env");
    return;
  }

  const handler = async (req: FastifyRequest, reply: FastifyReply) => {
    const resourceId = resourceIdFromParam((req.params as { resourceId: string }).resourceId);
    return handlePaidResource(req, reply, resourceId, redis, env);
  };

  app.get("/v1/agents/resources/:resourceId", handler);
  app.post("/v1/agents/resources/:resourceId", handler);
}
