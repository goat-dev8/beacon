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
import { FacilitatorClient, parseUsdtAmount } from "@beacon/x402";

type PaymentPayload = {
  from: string;
  to: string;
  token?: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
  v?: number;
  r?: string;
  s?: string;
  signature?: string;
};

const memoryReceipts = new Map<string, { txHash: string; body: unknown }>();

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
    extra: {
      tokenAddress: env.X402_TOKEN_ADDRESS!,
      facilitatorAddress: env.X402_FACILITATOR_ADDRESS!,
      chainId: env.CHAIN_ID || 114,
      serviceId: res.id,
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

function paymentSignature(payment: PaymentPayload): string {
  if (payment.signature) return payment.signature;
  if (payment.r && payment.s && payment.v != null) {
    return Signature.from({ r: payment.r, s: payment.s, v: payment.v }).serialized;
  }
  throw new AppError("VALIDATION", { message: "x402 payment signature missing." });
}

async function readCachedReceipt(
  redis: Redis | null,
  nonce: string,
): Promise<{ txHash: string; body: unknown } | null> {
  const key = `x402:receipt:${nonce}`;
  if (redis) {
    const hit = await redis.get<{ txHash: string; body: unknown }>(key);
    if (hit) return hit;
  }
  return memoryReceipts.get(nonce) ?? null;
}

async function writeCachedReceipt(
  redis: Redis | null,
  nonce: string,
  receipt: { txHash: string; body: unknown },
): Promise<void> {
  const key = `x402:receipt:${nonce}`;
  memoryReceipts.set(nonce, receipt);
  if (redis) {
    await redis.set(key, receipt, { ex: 86_400 });
  }
}

async function verifyAndSettlePayment(
  payment: PaymentPayload,
  minAmount: bigint,
  env: BeaconEnv,
): Promise<{ txHash: string }> {
  if (BigInt(payment.value) < minAmount) {
    throw new AppError("PAYMENT_REQUIRED", {
      message: "Insufficient x402 payment amount.",
      details: { required: minAmount.toString(), received: payment.value },
    });
  }

  const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
  const client = new FacilitatorClient({
    facilitatorAddress: env.X402_FACILITATOR_ADDRESS!,
    tokenAddress: env.X402_TOKEN_ADDRESS!,
    provider,
  });
  const signature = paymentSignature(payment);

  const ok = await client.verifyPayment(
    payment.from,
    payment.to,
    BigInt(payment.value),
    BigInt(payment.validAfter),
    BigInt(payment.validBefore),
    payment.nonce as `0x${string}`,
    signature,
  );
  if (!ok) {
    throw new AppError("VALIDATION", { message: "x402 payment authorization invalid." });
  }

  const settlerKey = env.DEPLOYER_PRIVATE_KEY || env.SETTLER_PRIVATE_KEY;
  if (!settlerKey) {
    throw new AppError("SETTLE_FAILED", {
      message: "Payment settlement unavailable — settler private key not configured.",
      statusCode: 503,
    });
  }

  const wallet = new Wallet(settlerKey, provider);
  const settled = await client.settlePayment(
    wallet,
    payment.from,
    payment.to,
    BigInt(payment.value),
    BigInt(payment.validAfter),
    BigInt(payment.validBefore),
    payment.nonce as `0x${string}`,
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
          validAfter: z.string(),
          validBefore: z.string(),
          nonce: z.string(),
          v: z.number().optional(),
          r: z.string().optional(),
          s: z.string().optional(),
          signature: z.string().optional(),
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
    });
  }

  const cached = await readCachedReceipt(redis, payment.nonce);
  if (cached) {
    reply.header(
      "X-Payment-Response",
      Buffer.from(JSON.stringify({ transactionHash: cached.txHash, settled: true, replay: true })).toString(
        "base64",
      ),
    );
    return cached.body;
  }

  const minAmount = parseUsdtAmount(parseFloat(res.priceUsdt0));
  const { txHash } = await verifyAndSettlePayment(payment, minAmount, env);

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
  };

  await writeCachedReceipt(redis, payment.nonce, { txHash, body: payload });

  reply.header(
    "X-Payment-Response",
    Buffer.from(JSON.stringify({ transactionHash: txHash, settled: true })).toString("base64"),
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
