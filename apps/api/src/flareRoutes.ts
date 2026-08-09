/**
 * Flare-native API routes: FTSO guard, FDC attestation, FCC shadow, evidence.
 * Honesty labels: REAL / SIMULATED / NOT_AVAILABLE / STUB — never invent proofs.
 */
import type { FastifyInstance } from "fastify";
import type { Redis } from "@upstash/redis";
import { z } from "zod";
import {
  AppError,
  loadEnv,
  readFtsoFeeds,
  evaluateFtsoGuard,
  FTSO_GUARD_DEFAULTS,
  resolveFccMode,
  honestyMessage,
} from "@beacon/shared";
import {
  createAttestationAdapter,
  createConfidentialComputeAdapter,
  createPriceOracleAdapter,
  createEvidenceEnvelope,
  appendEvidenceStage,
  type EvidenceEnvelope,
  type AttestationPersistShape,
} from "@beacon/flare";
import { createHash } from "node:crypto";

const FDC_KEY = (id: string) => `flare:fdc:${id}`;
const EVIDENCE_KEY = (id: string) => `flare:evidence:${id}`;

export function registerFlareNativeRoutes(
  app: FastifyInstance,
  redis: Redis | null,
): void {
  const env = loadEnv();

  /** FTSO snapshot + execution-guard evaluation (does not move funds). */
  app.get("/v1/ftso/guard", async (req) => {
    const q = z
      .object({
        symbol: z.string().default("XRP/USD"),
        maxAgeSeconds: z.coerce.number().optional(),
        maxSlippageBps: z.coerce.number().optional(),
        quotedSlippageBps: z.coerce.number().optional(),
        referencePrice: z.coerce.number().optional(),
        maxDeviationBps: z.coerce.number().optional(),
      })
      .parse(req.query ?? {});

    const snap = await readFtsoFeeds(env);
    const guard = evaluateFtsoGuard(snap.feeds, {
      feedSymbol: q.symbol,
      maxAgeSeconds: q.maxAgeSeconds ?? FTSO_GUARD_DEFAULTS.maxAgeSeconds,
      maxSlippageBps: q.maxSlippageBps ?? FTSO_GUARD_DEFAULTS.maxSlippageBps,
      quotedSlippageBps: q.quotedSlippageBps,
      referencePrice: q.referencePrice,
      maxDeviationBps: q.maxDeviationBps ?? FTSO_GUARD_DEFAULTS.maxDeviationBps,
    });

    return {
      status: "REAL" as const,
      honesty: "Live market data from FTSOv2 via ContractRegistry — used to protect Safe swaps.",
      ftsoV2: snap.ftsoV2,
      timestamp: snap.timestamp,
      feeds: snap.feeds,
      guard,
      defaults: FTSO_GUARD_DEFAULTS,
      docs: ["https://dev.flare.network/ftso/overview"],
    };
  });

  /** FCC shadow authorization — cannot move funds. */
  app.get("/v1/fcc/shadow", async () => {
    const adapter = createConfidentialComputeAdapter(env);
    const info = adapter.getStatus();
    return {
      ...info,
      canMoveFunds: false as const,
      canAuthorize: adapter.canAuthorize(),
      honesty: honestyMessage(env.SIMULATED_TEE),
      docs: adapter.getDocs(),
    };
  });

  app.post("/v1/fcc/shadow/evaluate", async (req) => {
    const body = z
      .object({
        actionHash: z.string().min(8),
        policyHash: z.string().min(8),
        policyEpoch: z.number().int().optional(),
        nonce: z.string().min(4),
        allow: z.boolean(),
        reasonCommitment: z.string().optional(),
        validAfter: z.string().optional(),
        validBefore: z.string().optional(),
      })
      .parse(req.body ?? {});

    const adapter = createConfidentialComputeAdapter(env);
    const result = adapter.evaluateShadowAuthorization(body);
    return {
      ...result,
      compareNote:
        "Shadow FCC result is for comparison with server policy only. It never authorizes on-chain spend.",
    };
  });

  /** FDC attestation lifecycle — REAL only when verifier URLs work; never fake proofs. */
  app.get("/v1/fdc/status", async () => {
    const adapter = createAttestationAdapter(env);
    const xrp = adapter.isAvailable("xrp");
    const evm = adapter.isAvailable("evm");
    return {
      status: xrp || evm ? ("REAL" as const) : ("NOT_AVAILABLE" as const),
      xrpVerifierConfigured: xrp,
      evmVerifierConfigured: evm,
      daLayerConfigured: Boolean(env.DA_LAYER_URL || env.DA_LAYER_API_URL),
      honesty: xrp || evm
        ? "FDC verifier endpoints configured — prepare/submit talk to official verifier URLs. Proofs are never invented."
        : "FDC verifier URLs not configured — attestation API returns NOT_AVAILABLE. Flow does not silently fake FDC.",
      docs: [
        "https://dev.flare.network/fdc/overview",
        "https://dev.flare.network/fdc/getting-started",
      ],
    };
  });

  app.post("/v1/fdc/prepare", async (req) => {
    const body = z
      .object({
        kind: z.enum(["Payment", "EVMTransaction", "Web2Json", "AddressValidity"]),
        source: z.enum(["xrp", "evm"]),
        payload: z.record(z.string(), z.unknown()).default({}),
        jobId: z.string().optional(),
      })
      .parse(req.body ?? {});

    const adapter = createAttestationAdapter(env);
    const result = await adapter.prepare(body);

    if (redis && result.requestId) {
      await redis.set(FDC_KEY(result.requestId), result, { ex: 60 * 60 * 48 });
    }

    if (redis && body.jobId) {
      let envelope = createEvidenceEnvelope({ jobId: body.jobId });
      envelope = appendEvidenceStage(envelope, "fdc_prepare", {
        status: result.status,
        hash: result.requestId || undefined,
        payload: result,
      });
      if (result.requestId) {
        envelope.fdcProof = {
          requestId: result.requestId,
          attestationType: result.kind,
          timestamp: result.createdAt,
        };
      }
      await redis.set(EVIDENCE_KEY(body.jobId), envelope, { ex: 60 * 60 * 48 });
    }

    return result;
  });

  app.post("/v1/fdc/:requestId/submit", async (req) => {
    const requestId = (req.params as { requestId: string }).requestId;
    if (!redis) {
      throw new AppError("VALIDATION", {
        message: "Redis required to persist FDC attestation state.",
        statusCode: 503,
      });
    }
    const stored = await redis.get<AttestationPersistShape>(FDC_KEY(requestId));
    if (!stored) {
      throw new AppError("VALIDATION", {
        message: "Unknown FDC requestId — prepare first, or state expired.",
      });
    }
    const adapter = createAttestationAdapter(env);
    const result = await adapter.submit(stored);
    await redis.set(FDC_KEY(requestId), result, { ex: 60 * 60 * 48 });
    return result;
  });

  app.get("/v1/fdc/:requestId", async (req) => {
    const requestId = (req.params as { requestId: string }).requestId;
    if (!redis) {
      throw new AppError("VALIDATION", {
        message: "Redis required to load FDC attestation state.",
        statusCode: 503,
      });
    }
    const stored = await redis.get<AttestationPersistShape>(FDC_KEY(requestId));
    if (!stored) {
      throw new AppError("VALIDATION", { message: "Unknown FDC requestId." });
    }
    const adapter = createAttestationAdapter(env);
    const result = await adapter.getStatus(stored);
    await redis.set(FDC_KEY(requestId), result, { ex: 60 * 60 * 48 });
    return {
      ...result,
      uiPhases: [
        { id: "Requested", done: true },
        {
          id: "Submitted",
          done: ["Submitted", "Finalized", "Verified", "Accepted"].includes(result.lifecycle),
        },
        {
          id: "Finalized",
          done: ["Finalized", "Verified", "Accepted"].includes(result.lifecycle),
        },
        {
          id: "Verified",
          done: ["Verified", "Accepted"].includes(result.lifecycle),
        },
        {
          id: result.lifecycle === "Rejected" ? "Rejected" : "Accepted",
          done: result.lifecycle === "Accepted" || result.lifecycle === "Rejected",
        },
      ],
      note:
        "Finalized means DA proof bytes were retrieved. Verified requires on-chain FdcVerification — not claimed from fetch alone.",
    };
  });

  /**
   * Gate a financial decision on FDC lifecycle when configured.
   * Without a Verified/Accepted attestation for the given requestId, returns blocked.
   * When FDC is NOT_AVAILABLE, returns honesty + does not invent allow.
   */
  app.post("/v1/fdc/decision", async (req) => {
    const body = z
      .object({
        requestId: z.string().min(4),
        action: z.string().min(2),
      })
      .parse(req.body ?? {});

    const adapter = createAttestationAdapter(env);
    if (!adapter.isAvailable("xrp") && !adapter.isAvailable("evm")) {
      return {
        allowed: false,
        status: "NOT_AVAILABLE" as const,
        reason: "FDC not configured — cannot use attestation as decision evidence.",
        action: body.action,
      };
    }
    if (!redis) {
      return {
        allowed: false,
        status: "NOT_AVAILABLE" as const,
        reason: "Redis unavailable — cannot load attestation state (fail closed).",
        action: body.action,
      };
    }
    const stored = await redis.get<AttestationPersistShape>(FDC_KEY(body.requestId));
    if (!stored) {
      return {
        allowed: false,
        status: "REAL" as const,
        reason: "Unknown attestation requestId.",
        action: body.action,
      };
    }
    const fresh = await adapter.getStatus(stored);
    await redis.set(FDC_KEY(body.requestId), fresh, { ex: 60 * 60 * 48 });

    const accepted =
      fresh.lifecycle === "Accepted" ||
      (fresh.lifecycle === "Verified" && fresh.verification?.verified === true) ||
      (fresh.lifecycle === "Finalized" && Boolean(fresh.proof));

    // Meaningful gate: Finalized+proof can inform research/signal acceptance;
    // value-moving paths should still require explicit Accepted after on-chain verify.
    const valueMoving = /swap|bridge|pay|transfer|redeem|mint/i.test(body.action);
    const allowed = valueMoving
      ? fresh.lifecycle === "Accepted" && fresh.verification?.verified === true
      : accepted;

    return {
      allowed,
      status: fresh.status,
      lifecycle: fresh.lifecycle,
      reason: allowed
        ? "FDC evidence accepted for this action class."
        : valueMoving
          ? "Value-moving action requires on-chain Verified+Accepted FDC proof — not yet available."
          : `Attestation lifecycle is ${fresh.lifecycle}${fresh.error ? `: ${fresh.error}` : ""}`,
      action: body.action,
      attestation: {
        requestId: fresh.requestId,
        kind: fresh.kind,
        lifecycle: fresh.lifecycle,
      },
    };
  });

  /** Evidence envelope CRUD (Redis-backed). */
  app.post("/v1/evidence", async (req) => {
    const body = z
      .object({
        jobId: z.string().min(4),
        intent: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(req.body ?? {});
    if (!redis) {
      throw new AppError("VALIDATION", {
        message: "Redis required for evidence envelopes.",
        statusCode: 503,
      });
    }
    let envelope = createEvidenceEnvelope({
      jobId: body.jobId,
      intent: body.intent
        ? {
            jobId: body.jobId,
            userId: String((body.intent as { userId?: string }).userId ?? "unknown"),
            description: String((body.intent as { description?: string }).description ?? ""),
            timestamp: new Date().toISOString(),
          }
        : undefined,
    });
    envelope = appendEvidenceStage(envelope, "intent", {
      status: "REAL",
      payload: body.intent,
    });
    await redis.set(EVIDENCE_KEY(body.jobId), envelope, { ex: 60 * 60 * 72 });
    return envelope;
  });

  app.get("/v1/evidence/:jobId", async (req) => {
    const jobId = (req.params as { jobId: string }).jobId;
    if (!redis) {
      throw new AppError("VALIDATION", {
        message: "Redis required for evidence envelopes.",
        statusCode: 503,
      });
    }
    const envelope = await redis.get<EvidenceEnvelope>(EVIDENCE_KEY(jobId));
    if (!envelope) {
      throw new AppError("VALIDATION", { message: "Evidence envelope not found." });
    }
    return envelope;
  });

  app.post("/v1/evidence/:jobId/stage", async (req) => {
    const jobId = (req.params as { jobId: string }).jobId;
    const body = z
      .object({
        stage: z.string().min(2),
        status: z.enum(["REAL", "SIMULATED", "NOT_AVAILABLE", "STUB"]),
        hash: z.string().optional(),
        payload: z.unknown().optional(),
      })
      .parse(req.body ?? {});
    if (!redis) {
      throw new AppError("VALIDATION", {
        message: "Redis required for evidence envelopes.",
        statusCode: 503,
      });
    }
    const existing = await redis.get<EvidenceEnvelope>(EVIDENCE_KEY(jobId));
    const base = existing ?? createEvidenceEnvelope({ jobId });
    const next = appendEvidenceStage(base, body.stage, {
      status: body.status,
      hash: body.hash,
      payload: body.payload,
    });
    await redis.set(EVIDENCE_KEY(jobId), next, { ex: 60 * 60 * 72 });
    return next;
  });

  /** Integration honesty map for UI / operators. */
  app.get("/v1/flare/integrations", async () => {
    const oracle = createPriceOracleAdapter(env);
    const fdc = createAttestationAdapter(env);
    const fcc = createConfidentialComputeAdapter(env);
    const fccStatus = fcc.getStatus();
    let ftsoOk = false;
    try {
      await oracle.getSnapshot();
      ftsoOk = true;
    } catch {
      ftsoOk = false;
    }
    return {
      network: env.NETWORK_NAME,
      chainId: env.CHAIN_ID,
      integrations: [
        {
          id: "ftso",
          status: ftsoOk ? "REAL" : "NOT_AVAILABLE",
          role: "execution_guard",
          note: "FTSOv2 prices gate Safe swaps (staleness / slippage / deviation).",
        },
        {
          id: "fdc",
          status: fdc.isAvailable("xrp") || fdc.isAvailable("evm") ? "REAL" : "NOT_AVAILABLE",
          role: "external_evidence",
          note: "Attestation API wired; proofs never invented.",
        },
        {
          id: "fcc",
          status: fccStatus.status,
          role: "shadow_authorization",
          note: fccStatus.note,
        },
        {
          id: "fassets",
          status: "REAL",
          role: "lifecycle_status_redeem",
          note: "Status + redeem prepare REAL; automated mint remains docs handoff / NOT_AVAILABLE.",
        },
        {
          id: "smart_accounts",
          status: "STUB",
          role: "parallel_xrpl_rail",
          note: "Registry helpers only — Beacon Safe is not a Flare Smart Account.",
        },
        {
          id: "x402",
          status: "REAL",
          role: "machine_payment",
          note: "EIP-3009 Flow micropays on Coston2 MockUSDT0.",
        },
        {
          id: "layerzero",
          status: "REAL",
          role: "oft_delivery_tracking",
          note: "OFT send + trackOftDelivery — never mark complete from optimistic local response.",
        },
        {
          id: "beacon_safe",
          status: "REAL",
          role: "personal_vault",
          note: "BeaconAgentVault via factory — separate from Flare Smart Accounts.",
        },
      ],
      fccMode: resolveFccMode(process.env, env.SIMULATED_TEE),
    };
  });

  /** Bind x402 payment fields into an evidence stage (machine economy receipt). */
  app.post("/v1/x402/evidence", async (req) => {
    const body = z
      .object({
        jobId: z.string().min(4),
        serviceId: z.string().min(1),
        price: z.string().min(1),
        token: z.string().min(1),
        payee: z.string().regex(/^0x[a-fA-F0-9]{40}$/i),
        nonce: z.string().min(4),
        expiry: z.number().int(),
        paymentTxHash: z.string().optional(),
        resultHash: z.string().optional(),
        acceptance: z.boolean().optional(),
        settlementTxHash: z.string().optional(),
      })
      .parse(req.body ?? {});

    if (!redis) {
      throw new AppError("VALIDATION", {
        message: "Redis required for x402 evidence.",
        statusCode: 503,
      });
    }

    const replayKey = `x402:nonce:${body.nonce.toLowerCase()}`;
    const seen = await redis.get(replayKey);
    if (seen) {
      throw new AppError("VALIDATION", {
        message: "x402 payment nonce already used — replay rejected.",
        details: { code: "X402_REPLAY" },
      });
    }
    const commitment = createHash("sha256")
      .update(
        JSON.stringify({
          serviceId: body.serviceId,
          price: body.price,
          token: body.token,
          payee: body.payee.toLowerCase(),
          nonce: body.nonce,
          expiry: body.expiry,
          paymentTxHash: body.paymentTxHash ?? null,
          resultHash: body.resultHash ?? null,
        }),
      )
      .digest("hex");

    if (body.expiry < Math.floor(Date.now() / 1000)) {
      throw new AppError("VALIDATION", { message: "x402 authorization expired." });
    }

    await redis.set(replayKey, commitment, { ex: 60 * 60 * 72 });

    let envelope =
      (await redis.get<EvidenceEnvelope>(EVIDENCE_KEY(body.jobId))) ??
      createEvidenceEnvelope({ jobId: body.jobId });
    envelope.payment = {
      rail: "x402",
      txHash: body.paymentTxHash,
      amount: body.price,
      currency: body.token,
      to: body.payee,
      timestamp: new Date().toISOString(),
    };
    if (body.settlementTxHash) {
      envelope.settlement = {
        settlementTxHash: body.settlementTxHash,
        chain: "coston2",
        amount: body.price,
        timestamp: new Date().toISOString(),
      };
    }
    if (body.acceptance != null) {
      envelope.acceptance = {
        accepted: body.acceptance,
        timestamp: new Date().toISOString(),
        hash: body.resultHash,
      };
    }
    envelope = appendEvidenceStage(envelope, "x402_payment", {
      status: "REAL",
      hash: body.paymentTxHash ?? commitment,
      payload: { ...body, commitment },
    });
    await redis.set(EVIDENCE_KEY(body.jobId), envelope, { ex: 60 * 60 * 72 });
    return { ok: true, commitment, envelope };
  });
}
