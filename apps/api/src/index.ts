import "dotenv/config";
import Fastify, { type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import pg from "pg";
import { Redis } from "@upstash/redis";
import { z } from "zod";
import {
  AppError,
  JobStatus,
  transition,
  loadEnv,
  honestyMessage,
  resolveFccMode,
  probeExtProxy,
  isAppError,
  newId,
  assertFlareRequired,
  BEACON_AGENTS,
  runBeaconAgentChat,
  readFtsoFeeds,
  prepareUsdt0ToFxrpSwap,
  prepareFxrpOftBridge,
  trackOftDelivery,
  readErc20Balance,
  resolveFxrpAddress,
  discoverFxrpOftRoutes,
  discoverSparkDexPools,
  readFassetsDesk,
  prepareFassetsRedeemLots,
  prepareFassetsRedeemAmount,
  prepareFassetsRedeemWithTag,
  trackFassetsRedemption,
  readFassetsRedemptionQueue,
  buildMarketIntelligence,
  readPortfolioDesk,
  readYieldVaultDesk,
  prepareFirelightDeposit,
  prepareUpshiftDeposit,
  readAgentVaultStatus,
  prepareAgentVaultDeposit,
  prepareAgentVaultWithdraw,
  prepareAgentVaultSetPolicy,
  prepareAgentVaultSetPaused,
  prepareAgentVaultSetExecutor,
  prepareCreateSafe,
  prepareBeaconSafeSwap,
  executeBeaconSafeSwap,
  ensureSafeSwapPolicy,
  readSwapDeskStatus,
  executeBeaconAgentBridge,
  agentBridgeReadiness,
  executeSafeJobLock,
  COSTON2_USDT0,
  chatCompletionStream,
  resolveModelForRole,
  resolveAiBaseUrl,
  isAiConfigured,
  probeModels,
  type BeaconAgentId,
  type ConversationState,
} from "@beacon/shared";
import {
  FacilitatorClient,
  assertX402PaymentFields,
  resolveEip3009Domain,
  buildEip3009Domain,
  TRANSFER_WITH_AUTHORIZATION_TYPES,
  randomAuthNonce,
  COSTON2_USDT0_LABEL,
} from "@beacon/x402";
import { JsonRpcProvider, Wallet, Signature } from "ethers";
import {
  buildBoundOffer,
  evaluateSealedFit,
  toQuoteDto,
  SERVICE_CATALOG,
  type ServiceId,
} from "@beacon/quote";
import { registryFromEnv, assertRegistryConfigured, encodeCreditDepositMemo } from "@beacon/smart-accounts";
import { startEmbeddedWorkers } from "./workers.js";
import { PIPELINE_CAPS } from "@beacon/pipeline";
import { getFccLifecycleStatus } from "@beacon/fdc";
import { attachHardwareCapFcc } from "./hardwareCapEvaluate.js";
import { attachFdcFlow } from "./fdcFlow.js";
import {
  assertPolicyAllows,
  DEFAULT_SECURITY_POLICY,
  getDailySpendUsdt0,
  loadPolicy,
  parseUsdt0Display,
  policyKey,
  recordSpendUsdt0,
  refreshSecuritySession,
  type BeaconSecurityPolicy,
} from "./securityPolicy.js";
import { runAfterPolicyAllows } from "./policyBeforeSpend.js";
import {
  appendMessage,
  archiveConversation,
  createConversation,
  ensureFlowSchema,
  getConversation,
  listActivity,
  listConversations,
  listMessages,
  pinConversation,
  recordActivity,
  renameConversation,
  updateConversationState,
} from "./flowStore.js";
import { registerPaidResourceRoutes } from "./resources/paidResources.js";
import { registerExecutionRoutes } from "./execution/routes.js";
import { registerFlareNativeRoutes } from "./flareRoutes.js";
import {
  createSafeSessionChallenge,
  verifyChallengeAndIssueSession,
  verifySafeSessionToken,
} from "./safeSession.js";
import { registerMcpRoutes, revokeMcpGrantsForWallet } from "./mcpRoutes.js";

const env = loadEnv();
assertFlareRequired(env);

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
});

const redis = env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
  ? new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN })
  : null;

const app = Fastify({
  logger: { level: env.LOG_LEVEL },
});
const revokedSafeSessions = new Map<string, number>();

function bearerToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token || null;
}

async function requireSafeSession(req: FastifyRequest, wallet: string): Promise<void> {
  const token = bearerToken(req);
  const session = token
    ? verifySafeSessionToken(token, wallet, env.SESSION_SECRET)
    : null;
  const key = `safe-session-revoked-after:${wallet.toLowerCase()}`;
  const redisRevokedAt = session && redis ? await redis.get<number>(key) : null;
  const revokedAt = Math.max(revokedSafeSessions.get(key) ?? 0, Number(redisRevokedAt ?? 0));
  if (!session || session.issuedAt <= revokedAt) {
    throw new AppError("UNAUTHORIZED", {
      message:
        "Unlock Beacon Agent once with your wallet. Jobs and Flow then execute from the Safe without per-action MetaMask prompts.",
      details: { code: "SAFE_SESSION_REQUIRED" },
    });
  }
}

await app.register(cors, {
  origin: resolveCorsOrigin(),
  credentials: true,
});
await app.register(sensible);

function resolveCorsOrigin(): boolean | string | string[] {
  const raw = process.env.ALLOWED_ORIGINS || process.env.WEB_ORIGIN || "";
  const listed = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (listed.length > 0) {
    return listed.length === 1 ? listed[0]! : listed;
  }
  if ((process.env.NODE_ENV ?? "development") === "production") {
    console.warn(
      "[cors] WEB_ORIGIN / ALLOWED_ORIGINS unset — reflecting request origin. Set explicit production origins.",
    );
  }
  return true;
}

app.setErrorHandler((error, _req, reply) => {
  if (isAppError(error)) {
    return reply.status(error.statusCode).send(error.toJSON());
  }
  // Zod validation must not surface as INTERNAL 500
  if (error instanceof z.ZodError) {
    return reply.status(400).send({
      error: {
        code: "BAD_REQUEST",
        message: "Invalid request",
        detail: error.issues.slice(0, 5),
      },
    });
  }
  const name = error instanceof Error ? error.name : "";
  if (name === "ZodError" || (error as { issues?: unknown })?.issues) {
    return reply.status(400).send({
      error: {
        code: "BAD_REQUEST",
        message: "Invalid request",
        detail: error instanceof Error ? error.message.slice(0, 400) : String(error).slice(0, 400),
      },
    });
  }
  app.log.error(error);
  const detail = error instanceof Error ? error.message : String(error);
  return reply.status(500).send({
    error: {
      code: "INTERNAL",
      message: "Something went wrong on our side. Please try again.",
      // Surface detail so Coston2 demos can diagnose without Render log SSH.
      detail: detail.slice(0, 240),
    },
  });
});

app.get("/health", async () => ({
  ok: true,
  chainId: env.CHAIN_ID,
  network: env.NETWORK_NAME,
  flareRequired: (env.FLARE_REQUIRED || "true").toLowerCase() !== "false",
  aiConfigured: isAiConfigured(env),
  aiBaseHost: (() => {
    try {
      return new URL(resolveAiBaseUrl(env)).host;
    } catch {
      return null;
    }
  })(),
  flareRails: {
    escrow: env.BEACON_ESCROW,
    x402Token: env.X402_TOKEN_ADDRESS,
    facilitator: env.X402_FACILITATOR_ADDRESS,
    jobRegistry: env.BEACON_JOB_REGISTRY,
    agentVault: env.BEACON_AGENT_VAULT_ADDRESS || null,
    contractRegistry: env.FLARE_CONTRACT_REGISTRY,
    rpc: env.COSTON2_RPC_URL,
  },
  flareSkills: [
    "flare-general-skill",
    "flare-ftso-skill",
    "flare-fassets-skill",
    "flare-fdc-skill",
    "flare-smart-accounts-skill",
    "flare-fcc-skill",
  ],
  simulatedTee: env.SIMULATED_TEE,
  fccMode: resolveFccMode(process.env, env.SIMULATED_TEE),
  honesty: honestyMessage(env.SIMULATED_TEE, resolveFccMode(process.env, env.SIMULATED_TEE)),
  service: "beacon-api",
  version: "0.1.0",
  pipeline: PIPELINE_CAPS,
}));

app.post("/v1/auth/safe-session/challenge", async (req) => {
  const body = z
    .object({ wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/i) })
    .parse(req.body ?? {});
  const challenge = createSafeSessionChallenge(body.wallet, env.SESSION_SECRET);
  return {
    ok: true,
    ...challenge,
    scope: "Safe jobs, swaps, and bridges within on-chain policy",
  };
});

app.post("/v1/auth/safe-session/verify", async (req) => {
  const body = z
    .object({
      wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/i),
      message: z.string().min(32).max(4096),
      signature: z.string().regex(/^0x[a-fA-F0-9]+$/i),
    })
    .parse(req.body ?? {});
  const issued = verifyChallengeAndIssueSession({
    wallet: body.wallet,
    message: body.message,
    signature: body.signature,
    secret: env.SESSION_SECRET,
  });
  if (!issued) {
    throw new AppError("UNAUTHORIZED", {
      message: "Beacon Agent session signature is invalid or expired.",
    });
  }
  return {
    ok: true,
    token: issued.token,
    wallet: issued.session.wallet,
    issuedAt: issued.session.issuedAt,
    expiresAt: issued.session.expiresAt,
  };
});

app.get("/v1/auth/safe-session", async (req) => {
  const wallet = z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/i)
    .parse((req.query as { wallet?: string }).wallet);
  const token = bearerToken(req);
  const session = token
    ? verifySafeSessionToken(token, wallet, env.SESSION_SECRET)
    : null;
  const key = `safe-session-revoked-after:${wallet.toLowerCase()}`;
  const redisRevokedAt = session && redis ? await redis.get<number>(key) : null;
  const revokedAt = Math.max(revokedSafeSessions.get(key) ?? 0, Number(redisRevokedAt ?? 0));
  const active = Boolean(session && session.issuedAt > revokedAt);
  return { ok: true, active, session: active ? session : null };
});

/** Live AgentRouter reachability (no secrets). */
app.get("/v1/ai/probe", async () => {
  if (!isAiConfigured(env)) {
    return { ok: false, configured: false, results: [] };
  }
  const results = await probeModels(
    (["generator", "quote", "judge", "acceptance"] as const)
      .map((role) => resolveModelForRole(role, env))
      .filter((v, i, a) => Boolean(v) && a.indexOf(v) === i),
    env,
  );
  return {
    ok: results.some((r) => r.works),
    configured: true,
    proxy: Boolean(env.AI_PROXY_URL && env.AI_PROXY_SECRET),
    host: (() => {
      try {
        return new URL(resolveAiBaseUrl(env)).host;
      } catch {
        return null;
      }
    })(),
    results: results.map((r) => ({
      model: r.model,
      ok: r.works,
      status: r.status,
      latencyMs: r.latencyMs,
      baseUrl: r.baseUrl,
      error: r.error ? String(r.error).slice(0, 160) : undefined,
    })),
  };
});

/** FCC honesty status — hardware claim only when lifecycle /info proves GCP_AMD_SEV. */
app.get("/v1/fcc/status", async () => {
  const mode = resolveFccMode(process.env, env.SIMULATED_TEE);
  const lifecycle = await getFccLifecycleStatus(env);
  const proxy = await probeExtProxy(env.EXT_PROXY_URL || undefined);
  const extensionId =
    proxy.extensionId ||
    lifecycle.extensionId ||
    (env.EXTENSION_ID ? String(env.EXTENSION_ID) : undefined);
  const reportedMode = env.SIMULATED_TEE
    ? "simulated"
    : lifecycle.hardwareClaim
      ? "verified"
      : mode;
  return {
    ok: true,
    mode: reportedMode,
    status:
      reportedMode === "simulated"
        ? "SIMULATED"
        : reportedMode === "verified"
          ? "REAL"
          : "NOT_AVAILABLE",
    simulatedTee: env.SIMULATED_TEE,
    localMode: env.LOCAL_MODE,
    proxyReachable: proxy.proxyReachable || lifecycle.extProxyReachable,
    extensionId: extensionId || undefined,
    extProxyConfigured: Boolean(env.EXT_PROXY_URL),
    teeId: lifecycle.teeId,
    teeProduction: lifecycle.teeProduction,
    teeMachineStatus: lifecycle.teeMachineStatus,
    platformAscii: lifecycle.platformAscii,
    codeHash: lifecycle.codeHash,
    attestationKind: lifecycle.attestationKind,
    canMoveFunds: false,
    shadowOnly: true,
    hardwareClaim: lifecycle.hardwareClaim,
    honesty: honestyMessage(env.SIMULATED_TEE, reportedMode),
    docs: ["https://dev.flare.network/fcc/overview", "https://dev.flare.network/fcc/guides"],
  };
});

app.post("/v1/debug/pipeline-smoke", async (req) => {
  if (process.env.ALLOW_PIPELINE_SMOKE !== "true") {
    throw new AppError("UNAUTHORIZED", { message: "Pipeline smoke disabled." });
  }
  try {
    const body = z
      .object({
        serviceId: z.string().default("image"),
        briefText: z.string().default("Beacon mint mark smoke test"),
      })
      .parse((req.body as object) ?? {});
    const { runPipeline } = await import("@beacon/pipeline");
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const outputDir = await mkdtemp(path.join(tmpdir(), "beacon-smoke-"));
    const result = await runPipeline({
      jobId: `smoke-${Date.now()}`,
      serviceId: body.serviceId,
      briefText: body.briefText,
      outputDir,
    });
    return {
      serviceId: body.serviceId,
      stages: result.stages,
      artifacts: result.artifacts.map((a) => ({ kind: a.kind, mimeType: a.mimeType })),
      caps: PIPELINE_CAPS,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack?.split("\n").slice(0, 8) : undefined,
      caps: PIPELINE_CAPS,
    };
  }
});

app.get("/ready", async (_req, reply) => {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  try {
    await pool.query("SELECT 1");
    checks.postgres = { ok: true };
  } catch (err) {
    checks.postgres = { ok: false, detail: err instanceof Error ? err.message : "failed" };
  }

  if (redis) {
    try {
      const pong = await redis.ping();
      checks.redis = { ok: pong === "PONG", detail: String(pong) };
    } catch (err) {
      checks.redis = { ok: false, detail: err instanceof Error ? err.message : "failed" };
    }
  } else {
    checks.redis = { ok: false, detail: "not configured" };
  }

  const registry = registryFromEnv();
  const missing = assertRegistryConfigured(registry);
  // Smart Account XRPL operator/core-vault are STUB rails — do not fail product readiness.
  const saOptional = new Set(["EXPECTED_OPERATOR_XRPL", "EXPECTED_CORE_VAULT_XRPL"]);
  const blocking = missing.filter((m) => !saOptional.has(m));
  checks.registry = {
    ok: blocking.length === 0,
    detail: missing.length
      ? `missing ${missing.join(", ")}${blocking.length === 0 ? " (Smart Account STUB — non-blocking)" : ""}`
      : "configured",
  };
  checks.smartAccounts = {
    ok: true,
    detail:
      missing.filter((m) => saOptional.has(m)).length > 0
        ? "STUB — XRPL PersonalAccount rail not required for Beacon Safe / Jobs readiness"
        : "registry optional fields present",
  };

  const ready = ["postgres", "redis", "registry"].every((k) => checks[k]?.ok);
  return reply.status(ready ? 200 : 503).send({ ready, checks, registry });
});

app.get("/v1/services", async () => ({ services: SERVICE_CATALOG }));

const createJobSchema = z.object({
  serviceId: z.enum([
    "video",
    "image",
    "presentations",
    "coding",
    "research",
    "documents",
    "marketing",
    "design",
    "ui",
    "branding",
    "analysis",
    "planning",
    "agents",
  ]),
  briefText: z.string().min(1).max(20_000),
  brandPackId: z.string().uuid().optional(),
});

app.post("/v1/jobs", async (req) => {
  const body = createJobSchema.parse(req.body);
  const userId = await ensureGuestUser();
  const jobId = newId();

  await pool.query(
    `INSERT INTO jobs (id, user_id, service_id, status, brief_text)
     VALUES ($1, $2, $3, $4, $5)`,
    [jobId, userId, body.serviceId, JobStatus.DRAFT, body.briefText],
  );

  const quoting = transition(JobStatus.DRAFT, "create_job");
  await updateJobStatus(jobId, quoting);

  return { jobId, status: quoting };
});

app.post("/v1/jobs/:id/quote", async (req) => {
  const jobId = (req.params as { id: string }).id;
  const job = await getJob(jobId);

  if (job.status !== JobStatus.QUOTING && job.status !== JobStatus.DRAFT) {
    throw new AppError("INVALID_TRANSITION");
  }

  if (job.status === JobStatus.DRAFT) {
    await updateJobStatus(jobId, JobStatus.QUOTING);
  }

  const fit = await evaluateSealedFit(
    {
      serviceId: job.service_id as ServiceId,
      briefText: job.brief_text ?? "",
    },
    {
      aiBaseUrl: env.AI_BASE_URL || undefined,
      aiApiKey: env.AI_API_KEY || undefined,
      aiModel: env.AI_MODEL_GENERATOR || undefined,
    },
  );

  if (fit.capability === "NO_FIT") {
    await updateJobStatus(jobId, JobStatus.FAILED);
    throw new AppError("NO_FIT", { message: fit.reason });
  }

  const offer = buildBoundOffer(
    { serviceId: job.service_id as ServiceId, briefText: job.brief_text ?? "" },
    "FIT",
  );
  const quote = toQuoteDto(offer);

  await pool.query(
    `INSERT INTO offers (id, job_id, price_usdt0, expires_at, brief_hash, rubric_hash, raw_offer_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      offer.offerId,
      jobId,
      offer.priceUsdt0.toString(),
      quote.expiresAt,
      offer.briefHash,
      offer.rubricHash,
      JSON.stringify({
        offer: { ...offer, priceUsdt0: offer.priceUsdt0.toString() },
        quote,
      }),
    ],
  );

  await updateJobStatus(jobId, JobStatus.QUOTED);
  await publishJobEvent(jobId, "stage", { stage: "quote", quote });

  return { jobId, quote, offerId: offer.offerId };
});

const eip3009AuthSchema = z.object({
  payer: z.string().min(1),
  payee: z.string().optional(),
  amount: z.string().min(1),
  validAfter: z.string().optional(),
  validBefore: z.string().optional(),
  nonce: z.string().optional(),
  signature: z.string().optional(),
  mode: z.string().optional(),
  lockTxHash: z.string().optional(),
  ownerWallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/i).optional(),
});

const approveSchema = z.object({
  offerId: z.string().uuid(),
  /** "safe" = server locks from Beacon Safe (no MetaMask). "wallet" = ERC-20 lockFrom. */
  mode: z.enum(["safe", "wallet"]).optional(),
  /** Owner wallet whose personal Safe pays (required for mode=safe when factory is live). */
  ownerWallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/i).optional(),
  /** @deprecated Per-job signatures were replaced by a wallet-bound Agent session. */
  payAuth: z
    .object({
      message: z.string().min(8),
      signature: z.string().min(8),
    })
    .optional(),
  authorization: eip3009AuthSchema.optional(),
  /** On-chain BeaconEscrow lock tx hash (Coston2). */
  lockTxHash: z.string().optional(),
  spendTxHash: z.string().optional(),
});

app.post("/v1/jobs/:id/approve", async (req) => {
  const jobId = (req.params as { id: string }).id;
  const body = approveSchema.parse(req.body);
  const job = await getJob(jobId);

  if (job.status !== JobStatus.QUOTED) {
    throw new AppError("INVALID_TRANSITION");
  }

  const offer = await pool.query(
    `SELECT id, expires_at, price_usdt0 FROM offers WHERE id = $1 AND job_id = $2`,
    [body.offerId, jobId],
  );
  if (offer.rowCount === 0) throw new AppError("VALIDATION", { message: "Quote not found for this job." });
  if (new Date(offer.rows[0].expires_at).getTime() < Date.now()) {
    await updateJobStatus(jobId, JobStatus.EXPIRED);
    throw new AppError("OFFER_EXPIRED");
  }

  const priceRaw = offer.rows[0].price_usdt0;
  const priceDisplay =
    typeof priceRaw === "bigint" || typeof priceRaw === "number" || /^\d+$/.test(String(priceRaw))
      ? (Number(priceRaw) / 1e6).toFixed(6)
      : String(priceRaw);

  const flareRequired = (env.FLARE_REQUIRED || "true").toLowerCase() !== "false";
  const mode = body.mode ?? (body.authorization?.signature ? "wallet" : undefined);

  let lockTxHash = body.lockTxHash ?? null;
  let spendTxHash = body.spendTxHash ?? null;
  let payer = body.authorization?.payer ?? null;
  let authPayload: Record<string, unknown> = { ...(body.authorization ?? {}) };

  const amountUsdt0 =
    typeof priceRaw === "bigint" || typeof priceRaw === "number" || /^\d+$/.test(String(priceRaw))
      ? Number(priceRaw) / 1e6
      : parseUsdt0Display(body.authorization?.amount ?? priceDisplay);

  if (mode === "safe") {
    if (!body.ownerWallet) {
      throw new AppError("VALIDATION", {
        message: "ownerWallet required to pay from your Beacon Safe.",
        details: { code: "SAFE_WALLET_REQUIRED" },
      });
    }
    await requireSafeSession(req, body.ownerWallet);
    // Policy MUST run before any irreversible Safe spend / escrow lock.
    const lock = await runAfterPolicyAllows(
      redis,
      {
        wallet: body.ownerWallet,
        serviceId: String(job.service_id ?? ""),
        amountUsdt0,
        agentId: "desk",
      },
      () =>
        executeSafeJobLock(
          {
            jobId,
            amountUsdt0Display: priceDisplay,
            ownerWallet: body.ownerWallet!,
          },
          env,
        ),
    );
    if (!lock.ok) {
      throw new AppError("VALIDATION", { message: lock.error, details: { code: lock.code } });
    }
    lockTxHash = lock.lockTxHash;
    spendTxHash = lock.spendTxHash;
    payer = lock.vault;
    authPayload = {
      mode: "beacon_safe",
      payer: lock.vault,
      ownerWallet: body.ownerWallet,
      amount: lock.amount,
      spendTxHash: lock.spendTxHash,
      lockTxHash: lock.lockTxHash,
      honesty: lock.honesty,
    };
  } else {
    if (flareRequired && !body.lockTxHash && !body.authorization?.lockTxHash && !body.authorization?.signature) {
      throw new AppError("VALIDATION", {
        message:
          "Fund Beacon Safe and use Pay from Safe, or approve Coston2 USDT0 and lock it in escrow (lockFrom).",
      });
    }
    if (payer) {
      await assertPolicyAllows(redis, {
        wallet: body.ownerWallet ?? payer,
        serviceId: String(job.service_id ?? ""),
        amountUsdt0,
        agentId: "desk",
      });
    }
  }

  const userId = job.user_id ?? (await ensureGuestUser());
  await pool.query(
    `INSERT INTO authorizations (offer_id, user_id, eip3009_payload, valid_before, status)
     VALUES ($1, $2, $3::jsonb, to_timestamp($4), 'active')`,
    [
      body.offerId,
      userId,
      JSON.stringify({
        ...authPayload,
        ownerWallet: body.ownerWallet ?? authPayload.ownerWallet,
        lockTxHash,
        spendTxHash,
        chainId: env.CHAIN_ID,
        network: env.NETWORK_NAME,
      }),
      body.authorization?.validBefore ?? Math.floor(Date.now() / 1000) + 3600,
    ],
  );

  const next = transition(JobStatus.QUOTED, "user_approve");
  await updateJobStatus(jobId, next);
  if (redis) await redis.lpush("q:pipeline", jobId);
  if (payer && amountUsdt0 > 0) {
    await recordSpendUsdt0(redis, body.ownerWallet ?? payer, amountUsdt0);
  }

  return {
    jobId,
    status: next,
    offerId: body.offerId,
    mode: mode ?? "wallet",
    lockTxHash,
    spendTxHash,
  };
});

/** Explicit Safe approve alias — same as approve with mode=safe. */
app.post("/v1/jobs/:id/approve-safe", async (req) => {
  const jobId = (req.params as { id: string }).id;
  const body = z
    .object({
      offerId: z.string().uuid(),
      ownerWallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/i),
    })
    .parse(req.body ?? {});
  await requireSafeSession(req, body.ownerWallet);
  const job = await getJob(jobId);
  if (job.status !== JobStatus.QUOTED) throw new AppError("INVALID_TRANSITION");
  const offer = await pool.query(
    `SELECT id, expires_at, price_usdt0 FROM offers WHERE id = $1 AND job_id = $2`,
    [body.offerId, jobId],
  );
  if (offer.rowCount === 0) throw new AppError("VALIDATION", { message: "Quote not found for this job." });
  if (new Date(offer.rows[0].expires_at).getTime() < Date.now()) {
    await updateJobStatus(jobId, JobStatus.EXPIRED);
    throw new AppError("OFFER_EXPIRED");
  }
  const priceRaw = offer.rows[0].price_usdt0;
  const priceDisplay =
    typeof priceRaw === "bigint" || typeof priceRaw === "number" || /^\d+$/.test(String(priceRaw))
      ? (Number(priceRaw) / 1e6).toFixed(6)
      : String(priceRaw);
  const amountUsdt0 = Number(priceRaw) / 1e6;
  // Policy MUST run before any irreversible Safe spend / escrow lock.
  const lock = await runAfterPolicyAllows(
    redis,
    {
      wallet: body.ownerWallet,
      serviceId: String(job.service_id ?? ""),
      amountUsdt0,
      agentId: "desk",
    },
    () =>
      executeSafeJobLock(
        { jobId, amountUsdt0Display: priceDisplay, ownerWallet: body.ownerWallet },
        env,
      ),
  );
  if (!lock.ok) throw new AppError("VALIDATION", { message: lock.error, details: { code: lock.code } });
  const userId = job.user_id ?? (await ensureGuestUser());
  await pool.query(
    `INSERT INTO authorizations (offer_id, user_id, eip3009_payload, valid_before, status)
     VALUES ($1, $2, $3::jsonb, to_timestamp($4), 'active')`,
    [
      body.offerId,
      userId,
      JSON.stringify({
        mode: "beacon_safe",
        payer: lock.vault,
        ownerWallet: body.ownerWallet,
        amount: lock.amount,
        spendTxHash: lock.spendTxHash,
        lockTxHash: lock.lockTxHash,
        honesty: lock.honesty,
        chainId: env.CHAIN_ID,
        network: env.NETWORK_NAME,
      }),
      Math.floor(Date.now() / 1000) + 3600,
    ],
  );
  const next = transition(JobStatus.QUOTED, "user_approve");
  await updateJobStatus(jobId, next);
  if (redis) await redis.lpush("q:pipeline", jobId);
  await recordSpendUsdt0(redis, body.ownerWallet, amountUsdt0);
  return {
    jobId,
    status: next,
    offerId: body.offerId,
    mode: "safe",
    vault: lock.vault,
    lockTxHash: lock.lockTxHash,
    spendTxHash: lock.spendTxHash,
    explorerLock: lock.explorerLock,
    explorerSpend: lock.explorerSpend,
  };
});

app.get("/v1/jobs/:id", async (req) => {
  const jobId = (req.params as { id: string }).id;
  const job = await getJob(jobId);
  const { rows: events } = await pool.query(
    `SELECT type, payload, ts FROM job_events WHERE job_id = $1 ORDER BY ts DESC LIMIT 20`,
    [jobId],
  );
  const { rows: accepts } = await pool.query(
    `SELECT result, confidence, report_json FROM accept_reports WHERE job_id = $1 ORDER BY id DESC LIMIT 1`,
    [jobId],
  );
  const { rows: authorizations } = await pool.query(
    `SELECT a.eip3009_payload
     FROM authorizations a
     JOIN offers o ON o.id = a.offer_id
     WHERE o.job_id = $1
     ORDER BY o.expires_at DESC
     LIMIT 1`,
    [jobId],
  );
  const paymentAuth = authorizations[0]?.eip3009_payload as
    | {
        mode?: string;
        lockTxHash?: string;
        spendTxHash?: string;
        payer?: string;
        ownerWallet?: string;
      }
    | undefined;
  return {
    job,
    recentEvents: events,
    paymentRail: paymentAuth
      ? {
          mode: paymentAuth.mode === "beacon_safe" ? "safe" : "wallet",
          lockTxHash: paymentAuth.lockTxHash ?? null,
          spendTxHash: paymentAuth.spendTxHash ?? null,
          payer: paymentAuth.payer ?? null,
          ownerWallet: paymentAuth.ownerWallet ?? null,
        }
      : null,
    acceptance: accepts[0]
      ? {
          result: accepts[0].result,
          confidence: accepts[0].confidence,
          summary: (accepts[0].report_json as { summary?: string })?.summary ?? null,
          notes: (accepts[0].report_json as { layers?: Array<{ notes?: string[] }> })?.layers?.flatMap(
            (l) => l.notes ?? [],
          ),
        }
      : null,
  };
});

app.get("/v1/jobs/:id/events", async (req, reply) => {
  const jobId = (req.params as { id: string }).id;
  await getJob(jobId);

  // Hijack so Fastify does not try to send a second response after SSE headers.
  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const send = (event: string, data: unknown) => {
    reply.raw.write(`event: ${event}\n`);
    reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const parseLogItem = (item: unknown): unknown => {
    if (item && typeof item === "object") return item;
    const raw = String(item ?? "");
    try {
      return JSON.parse(raw);
    } catch {
      return { type: "raw", payload: { raw } };
    }
  };

  send("connected", { jobId });

  if (redis) {
    try {
    const history = await redis.lrange(`sse:job:${jobId}:log`, 0, 49);
    for (const item of history.reverse()) {
        send("message", parseLogItem(item));
      }
    } catch (err) {
      send("error", { message: err instanceof Error ? err.message : String(err) });
    }
  }

  const heartbeat = setInterval(() => send("heartbeat", { ts: Date.now() }), 15_000);
  req.raw.on("close", () => clearInterval(heartbeat));
});

app.get("/v1/jobs/:id/artifacts", async (req) => {
  const jobId = (req.params as { id: string }).id;
  await getJob(jobId);
  const { rows } = await pool.query(
    `SELECT id, kind, uri, sha256, meta FROM artifacts WHERE job_id = $1 ORDER BY id ASC`,
    [jobId],
  );
  return { jobId, artifacts: rows };
});

app.get("/v1/jobs/:id/artifacts/:artifactId", async (req) => {
  const { id: jobId, artifactId } = req.params as { id: string; artifactId: string };
  await getJob(jobId);
  const { rows } = await pool.query(
    `SELECT id, kind, uri, sha256, meta FROM artifacts WHERE job_id = $1 AND id = $2`,
    [jobId, artifactId],
  );
  const row = rows[0];
  if (!row) throw new AppError("JOB_NOT_FOUND", { message: "Artifact not found." });

  const mimeType =
    (row.meta as { mimeType?: string } | null)?.mimeType ?? "application/octet-stream";
  const textReadable =
    mimeType.includes("text") ||
    mimeType.includes("json") ||
    mimeType.includes("markdown") ||
    mimeType.includes("svg") ||
    ["draft", "document", "captions", "plan", "index", "storyboard"].includes(row.kind);

  let content: string | null = null;
  let truncated = false;
  if (textReadable && row.uri) {
    try {
      const { readFile } = await import("node:fs/promises");
      const raw = await readFile(row.uri, "utf8");
      const max = 120_000;
      truncated = raw.length > max;
      content = truncated ? raw.slice(0, max) : raw;
    } catch {
      content = null;
    }
  }

  return {
    id: row.id,
    kind: row.kind,
    mimeType,
    sha256: row.sha256,
    meta: row.meta,
    content,
    truncated,
    available: content !== null || Boolean(row.uri),
    rawUrl: `/v1/jobs/${jobId}/artifacts/${artifactId}/raw`,
  };
});

app.get("/v1/jobs/:id/artifacts/:artifactId/raw", async (req, reply) => {
  const { id: jobId, artifactId } = req.params as { id: string; artifactId: string };
  await getJob(jobId);
  const { rows } = await pool.query(
    `SELECT id, kind, uri, meta FROM artifacts WHERE job_id = $1 AND id = $2`,
    [jobId, artifactId],
  );
  const row = rows[0];
  if (!row?.uri) throw new AppError("JOB_NOT_FOUND", { message: "Artifact not found." });
  const mimeType =
    (row.meta as { mimeType?: string } | null)?.mimeType ?? "application/octet-stream";
  try {
    const { createReadStream } = await import("node:fs");
    const { stat } = await import("node:fs/promises");
    await stat(row.uri);
    reply.header("Content-Type", mimeType);
    reply.header("Cache-Control", "private, max-age=60");
    return reply.send(createReadStream(row.uri));
  } catch {
    throw new AppError("JOB_NOT_FOUND", { message: "Artifact file missing on server." });
  }
});

app.get("/v1/jobs/:id/receipt", async (req) => {
  const jobId = (req.params as { id: string }).id;
  await getJob(jobId);
  const { rows } = await pool.query(
    `SELECT id, tx_hash, receipt_json, created_at FROM receipts WHERE job_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [jobId],
  );
  if (rows.length === 0) return { jobId, receipt: null };
  return {
    jobId,
    receipt: {
      id: rows[0].id,
      txHash: rows[0].tx_hash,
      createdAt: rows[0].created_at,
      ...(typeof rows[0].receipt_json === "object" && rows[0].receipt_json
        ? (rows[0].receipt_json as object)
        : {}),
    },
  };
});

const lookSchema = z.object({
  decision: z.enum(["accept", "reject"]),
});

app.post("/v1/jobs/:id/look", async (req) => {
  const jobId = (req.params as { id: string }).id;
  const body = lookSchema.parse(req.body);
  const job = await getJob(jobId);
  if (job.status !== JobStatus.NEEDS_LOOK) throw new AppError("INVALID_TRANSITION");

  const outcome = body.decision === "accept" ? ("PASS" as const) : ("FAIL" as const);
  const next = transition(JobStatus.NEEDS_LOOK, "user_look", outcome);
  await updateJobStatus(jobId, next);
  if (redis) {
    await redis.lpush("q:settle", outcome === "PASS" ? jobId : `refuse:${jobId}`);
  }
  return { jobId, status: next };
});

app.get("/v1/receipts/:id", async (req) => {
  const receiptId = (req.params as { id: string }).id;
  const { rows } = await pool.query(`SELECT receipt_json FROM receipts WHERE id = $1`, [receiptId]);
  if (rows.length === 0) throw new AppError("JOB_NOT_FOUND", { message: "Receipt not found." });
  return rows[0].receipt_json;
});

const creditSchema = z.object({
  amountXrp: z.string().default("10"),
  userId: z.string().uuid().optional(),
});

app.post("/v1/credit/prepare", async (req) => {
  const body = creditSchema.parse(req.body ?? {});
  const registry = registryFromEnv();
  const destination = registry.operatorXrpl ?? registry.coreVaultXrpl;
  if (!destination) throw new AppError("CREDIT_PREP_FAILED");

  const beaconRef = newId();
  const userId = body.userId ?? (await ensureGuestUser());
  const memo = encodeCreditDepositMemo({
    beaconRef,
    userId,
    amountDrops: xrpToDrops(body.amountXrp),
  });

  const basePayload = {
    kind: "xrpl_payment",
    destination,
    amountXrp: body.amountXrp,
    memo,
    beaconRef,
  };

  if (env.XUMM_API_KEY && env.XUMM_API_SECRET) {
    return {
      ...basePayload,
      xaman: {
        txjson: {
          TransactionType: "Payment",
          Destination: destination,
          Amount: xrpToDrops(body.amountXrp),
          Memos: [
            {
              Memo: {
                MemoType: Buffer.from(memo.type, "utf8").toString("hex").toUpperCase(),
                MemoData: memo.data,
              },
            },
          ],
        },
        options: {
          submit: false,
          expire: 5,
        },
      },
    };
  }

  return basePayload;
});

async function ensureGuestUser(): Promise<string> {
  const existing = await pool.query(`SELECT id FROM users ORDER BY created_at ASC LIMIT 1`);
  if (existing.rows[0]?.id) return existing.rows[0].id;
  const id = newId();
  await pool.query(`INSERT INTO users (id, display_name, primary_auth) VALUES ($1, $2, $3)`, [
    id,
    "Guest",
    "guest",
  ]);
  return id;
}

async function getJob(jobId: string) {
  const { rows } = await pool.query(
    `SELECT id, user_id, service_id, status, brief_text, created_at, updated_at FROM jobs WHERE id = $1`,
    [jobId],
  );
  if (rows.length === 0) throw new AppError("JOB_NOT_FOUND");
  return rows[0];
}

async function updateJobStatus(jobId: string, status: string) {
  await pool.query(`UPDATE jobs SET status = $2, updated_at = NOW() WHERE id = $1`, [jobId, status]);
  await pool.query(
    `INSERT INTO job_events (job_id, type, payload) VALUES ($1, 'status', $2::jsonb)`,
    [jobId, JSON.stringify({ status })],
  );
}

async function publishJobEvent(jobId: string, type: string, payload: Record<string, unknown>) {
  if (!redis) return;
  const message = JSON.stringify({ type, payload, ts: new Date().toISOString() });
  await redis.publish(`sse:job:${jobId}`, message);
  await redis.lpush(`sse:job:${jobId}:log`, message);
}

function xrpToDrops(xrp: string): string {
  const parts = xrp.split(".");
  const whole = parts[0] ?? "0";
  const frac = (parts[1] ?? "0").padEnd(6, "0").slice(0, 6);
  return (BigInt(whole) * 1_000_000n + BigInt(frac)).toString();
}

/** ——— Beacon Flow agents (Anvita-style rooms on Flare) ——— */
app.get("/v1/agents", async () => ({
  network: env.NETWORK_NAME,
  chainId: env.CHAIN_ID,
  agents: BEACON_AGENTS,
  rails: {
    usdt0: env.X402_TOKEN_ADDRESS,
    facilitator: env.X402_FACILITATOR_ADDRESS,
    escrow: env.BEACON_ESCROW,
    coston2Usdt0: "0xC1A5B41512496B80903D1f32d6dEa3a73212E71F",
    sparkdexRouter: "0x8a1E35F5c98C4E85B36B7B253222eE17773b2781",
    sparkdexNetwork: "flare-mainnet",
    sparkdexChainId: 14,
    honesty:
      "SparkDEX SwapRouter bytecode is on Flare Mainnet only. Coston2 powers FTSO, FAssets FXRP, LayerZero OFT, and x402 on official faucet USDT0.",
  },
}));

app.get("/v1/agents/signals", async () => {
  const snap = await readFtsoFeeds(env);
  return { ok: true, ...snap };
});

app.get("/v1/agents/swap/pairs", async (req) => {
  const force = String((req.query as { force?: string }).force ?? "") === "1";
  const discovered = await discoverSparkDexPools(env, { force });
  return { ok: true, ...discovered };
});

app.get("/v1/agents/fassets", async () => {
  const desk = await readFassetsDesk(env);
  return { ok: true, ...desk };
});

app.get("/v1/agents/yield", async (req) => {
  const walletRaw = (req.query as { wallet?: string }).wallet;
  const wallet =
    walletRaw && /^0x[a-fA-F0-9]{40}$/.test(walletRaw) ? walletRaw : undefined;
  const desk = await readYieldVaultDesk({ wallet, env });
  return { ok: true, ...desk };
});

app.post("/v1/agents/fassets/redeem/prepare", async (req) => {
  const body = z
    .object({
      lots: z.number().int().positive().optional(),
      amountUBA: z.string().regex(/^\d+$/).optional(),
      destinationTag: z.number().int().nonnegative().optional(),
      underlyingAddress: z.string().min(25).max(64),
      executor: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
      assetManager: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
      mode: z.enum(["lots", "amount", "tag", "withTag"]).optional(),
    })
    .parse(req.body ?? {});

  const mode =
    body.mode === "withTag"
      ? "tag"
      : (body.mode ??
        (body.destinationTag !== undefined
          ? "tag"
          : body.amountUBA
            ? "amount"
            : "lots"));

  if (mode === "tag" && (body.amountUBA == null || body.destinationTag == null)) {
    return { ok: false, error: "tag/withTag mode requires amountUBA and destinationTag" };
  }
  if (mode === "amount" && body.amountUBA == null) {
    return { ok: false, error: "amount mode requires amountUBA" };
  }
  if (mode === "lots" && body.lots == null) {
    return { ok: false, error: "lots mode requires lots" };
  }

  const prep =
    mode === "tag"
      ? await prepareFassetsRedeemWithTag(
          {
            amountUBA: body.amountUBA!,
            underlyingAddress: body.underlyingAddress,
            destinationTag: body.destinationTag!,
            executor: body.executor,
            assetManager: body.assetManager,
          },
          env,
        )
      : mode === "amount"
        ? await prepareFassetsRedeemAmount(
            {
              amountUBA: body.amountUBA!,
              underlyingAddress: body.underlyingAddress,
              executor: body.executor,
              assetManager: body.assetManager,
            },
            env,
          )
        : await prepareFassetsRedeemLots(
            {
              lots: body.lots!,
              underlyingAddress: body.underlyingAddress,
              executor: body.executor,
              assetManager: body.assetManager,
            },
            env,
          );

  if (!prep.ok) return { ok: false, error: prep.error };
  return {
    ok: true,
    prep,
    lifecycle: "PREPARED",
    honesty:
      "PREPARED calldata only. After wallet submit track requestId → PENDING until RedemptionPerformed XRPL evidence for COMPLETED.",
  };
});

app.get("/v1/agents/fassets/queue", async (req) => {
  const q = z
    .object({
      assetManager: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
      firstTicketId: z.string().regex(/^\d+$/).optional(),
      pageSize: z.coerce.number().int().positive().max(100).optional(),
    })
    .parse(req.query ?? {});
  const page = await readFassetsRedemptionQueue({ ...q, env });
  if (!page.ok) return { ok: false, error: page.error };
  return { ok: true, queue: page };
});

app.get("/v1/agents/fassets/redemption-queue", async (req) => {
  const q = z
    .object({
      assetManager: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
      firstTicketId: z.string().regex(/^\d+$/).optional(),
      pageSize: z.coerce.number().int().positive().max(100).optional(),
    })
    .parse(req.query ?? {});
  const page = await readFassetsRedemptionQueue({ ...q, env });
  if (!page.ok) return { ok: false, error: page.error };
  return { ok: true, queue: page };
});

app.get("/v1/agents/fassets/redeem/status", async (req) => {
  const q = z
    .object({
      requestId: z.string().regex(/^\d+$/),
      assetManager: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
      lookbackBlocks: z.coerce.number().int().positive().max(500_000).optional(),
      sourceTxHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
    })
    .parse(req.query ?? {});
  const track = await trackFassetsRedemption({ ...q, env });
  if (!track.ok) return { ok: false, error: track.error };
  return { ok: true, track };
});

app.post("/v1/agents/yield/prepare", async (req) => {
  const body = z
    .object({
      vault: z.enum(["firelight", "upshift"]),
      action: z.enum(["deposit"]),
      amountUnits: z.string().default("1"),
      recipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    })
    .parse(req.body ?? {});
  const prep =
    body.vault === "firelight"
      ? await prepareFirelightDeposit(
          { amountUnits: body.amountUnits, recipient: body.recipient },
          env,
        )
      : await prepareUpshiftDeposit(
          { amountUnits: body.amountUnits, recipient: body.recipient },
          env,
        );
  return { ok: true, prep };
});

app.get("/v1/agents/intel", async (req) => {
  const wallet = (req.query as { wallet?: string }).wallet;
  const intel = await buildMarketIntelligence({
    wallet: wallet && /^0x[a-fA-F0-9]{40}$/.test(wallet) ? wallet : undefined,
    env,
  });
  return { ok: true, ...intel };
});

app.get("/v1/agents/portfolio", async (req) => {
  const wallet = z.string().regex(/^0x[a-fA-F0-9]{40}$/).parse((req.query as { wallet?: string }).wallet);
  const desk = await readPortfolioDesk(wallet, env);
  return { ok: true, ...desk };
});

app.get("/v1/agents/bridge/routes", async (req) => {
  const force = String((req.query as { force?: string }).force ?? "") === "1";
  const discovered = await discoverFxrpOftRoutes(env, { force });
  return {
    ok: true,
    network: "coston2",
    chainId: 114,
    ...discovered,
    docs: [
      "https://dev.flare.network/fxrp/oft/fxrp-autoredeem#discovering-available-bridge-routes",
      "https://docs.layerzero.network/v2/deployments/chains/flare-testnet",
    ],
    // Prefer discoverFxrpOftRoutes honesty — never present fallback snapshot as live.
    honesty: discovered.honesty,
  };
});

app.get("/v1/agents/bridge/delivery", async (req) => {
  const q = z
    .object({
      tx: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
      dstEid: z.coerce.number().int().positive().optional(),
      peer: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
      guid: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
    })
    .parse(req.query ?? {});
  const status = await trackOftDelivery({
    sourceTxHash: q.tx,
    dstEid: q.dstEid,
    peer: q.peer,
    guid: q.guid,
    env,
  });
  return { ok: true, delivery: status };
});

app.get("/v1/agents/balances", async (req) => {
  const wallet = z.string().regex(/^0x[a-fA-F0-9]{40}$/).parse((req.query as { wallet?: string }).wallet);
  const fxrp = await resolveFxrpAddress(env);
  const [usdt0, fxrpBal, mock] = await Promise.all([
    readErc20Balance(COSTON2_USDT0, wallet, env),
    readErc20Balance(fxrp, wallet, env),
    env.X402_TOKEN_ADDRESS
      ? readErc20Balance(env.X402_TOKEN_ADDRESS, wallet, env).catch(() => null)
      : Promise.resolve(null),
  ]);
  const serializeBal = (address: string, bal: { raw: bigint; formatted: string; decimals: number; symbol: string }) => ({
    address,
    raw: bal.raw.toString(),
    formatted: bal.formatted,
    decimals: bal.decimals,
    symbol: bal.symbol,
  });
  return {
    ok: true,
    wallet,
    network: "coston2",
    chainId: 114,
    balances: {
      usdt0: serializeBal(COSTON2_USDT0, usdt0),
      fxrp: serializeBal(fxrp, fxrpBal),
      mockUsdt0:
        mock &&
        env.X402_TOKEN_ADDRESS &&
        env.X402_TOKEN_ADDRESS.toLowerCase() !== COSTON2_USDT0.toLowerCase()
          ? serializeBal(env.X402_TOKEN_ADDRESS, mock)
          : null,
    },
  };
});

app.post("/v1/agents/swap/prepare", async (req) => {
  const body = z
    .object({
      amountInUnits: z.string().default("1"),
      recipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      amountOutMinUnits: z.string().optional(),
    })
    .parse(req.body ?? {});
  const prep = await prepareUsdt0ToFxrpSwap(body, env);
  return { ok: true, prep };
});

app.post("/v1/agents/bridge/prepare", async (req) => {
  const body = z
    .object({
      amountFxrpUnits: z.string().default("1"),
      recipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      dstEid: z.number().int().positive(),
    })
    .parse(req.body ?? {});
  const prep = await prepareFxrpOftBridge(body, env);
  return { ok: true, prep };
});

app.get("/v1/agents/bridge/agent-ready", async () => {
  const status = await agentBridgeReadiness(env);
  return { ok: true, status };
});

app.post("/v1/agents/bridge/execute", async (req) => {
  const body = z
    .object({
      wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/i),
      amountFxrpUnits: z.string().min(1),
      recipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/i),
      destination: z.string().min(2),
      preferSafeFunding: z.boolean().optional(),
    })
    .parse(req.body ?? {});
  await requireSafeSession(req, body.wallet);
  if (body.recipient.toLowerCase() !== body.wallet.toLowerCase()) {
    throw new AppError("UNAUTHORIZED", {
      message: "Agent bridge recipient must match the unlocked wallet.",
    });
  }
  await assertPolicyAllows(redis, {
    wallet: body.wallet,
    agentId: "bridge",
  });
  const result = await executeBeaconAgentBridge(
    {
      amountFxrpUnits: body.amountFxrpUnits,
      recipient: body.recipient,
      destination: body.destination,
      preferSafeFunding: body.preferSafeFunding,
    },
    env,
  );
  if (!result.ok) {
    throw new AppError("VALIDATION", { message: result.error });
  }
  return result;
});

const agentChatSchema = z.object({
  agentId: z
    .enum([
      "general",
      "signals",
      "swap",
      "bridge",
      "pay",
      "trade",
      "desk",
      "image",
      "research",
      "portfolio",
      "fassets",
      "intel",
      "yield",
      "risk",
      "liquidity",
      "treasury",
      "crosschain",
      "xrpfi",
    ])
    .optional(),
  message: z.string().min(1).max(4000),
  wallet: z.string().optional(),
  conversationId: z.string().uuid().optional(),
  serviceId: z.string().optional(),
  resource: z.string().optional(),
  quoteId: z.string().optional(),
  state: z
    .object({
      intent: z.string(),
      phase: z.string(),
      amountInUnits: z.string().optional(),
      bridgeFrom: z.string().optional(),
      bridgeTo: z.string().optional(),
      serviceId: z.string().optional(),
      creativeBrief: z.string().optional(),
      quotePrice: z.string().optional(),
    })
    .optional()
    .nullable(),
  payment: z
    .object({
      from: z.string(),
      to: z.string(),
      token: z.string().optional(),
      value: z.string(),
      validAfter: z.string().optional(),
      validBefore: z.string().optional(),
      nonce: z.string(),
      v: z.number().optional(),
      r: z.string().optional(),
      s: z.string().optional(),
      mode: z.string().optional(),
      signature: z.string().optional(),
      serviceId: z.string().optional(),
      resource: z.string().optional(),
      quoteId: z.string().optional(),
    })
    .optional(),
});

await registerPaidResourceRoutes(app, redis, env);
await registerExecutionRoutes(app, pool, redis);
registerFlareNativeRoutes(app, redis);

app.post("/v1/agents/chat", async (req) => {
  const body = agentChatSchema.parse(req.body ?? {});
  let paidResource = false;
  let settlementTxHash: string | undefined;

  if (body.wallet) {
    await assertPolicyAllows(redis, {
      wallet: body.wallet,
      agentId: body.agentId,
    });
  }

  if (
    body.payment &&
    (body.payment.mode === "erc20-pull" ||
      body.payment.signature ||
      (body.payment.r && body.payment.s))
  ) {
    if (!env.X402_TOKEN_ADDRESS || !env.X402_FACILITATOR_ADDRESS || !env.X402_PAYEE_ADDRESS) {
      throw new AppError("SETTLE_FAILED", {
        message: "x402 rails not configured (Coston2 USDT0 / facilitator / payee).",
        statusCode: 503,
      });
    }
    const spendUnits = Number(BigInt(body.payment.value)) / 1e6;
    if (body.wallet || body.payment.from) {
      await assertPolicyAllows(redis, {
        wallet: body.wallet || body.payment.from,
        agentId: body.agentId ?? "pay",
        amountUsdt0: spendUnits,
      });
    }

    let fields;
    try {
      fields = assertX402PaymentFields(body.payment, {
        chainId: env.CHAIN_ID || 114,
        network: env.NETWORK_NAME || "coston2",
        tokenAddress: env.X402_TOKEN_ADDRESS,
        payeeAddress: env.X402_PAYEE_ADDRESS,
        exactAmount: BigInt(body.payment.value),
      });
    } catch (err) {
      throw new AppError("PAYMENT_REQUIRED", {
        message:
          (err instanceof Error ? err.message : "x402 payment invalid") +
          ` (${COSTON2_USDT0_LABEL})`,
      });
    }

    const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
    const client = new FacilitatorClient({
      facilitatorAddress: env.X402_FACILITATOR_ADDRESS,
      tokenAddress: env.X402_TOKEN_ADDRESS,
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
    const erc20Pull = body.payment.mode === "erc20-pull";

    if (erc20Pull) {
      const [allowance, balance] = await Promise.all([
        client.readAllowance(body.payment.from),
        client.readBalance(body.payment.from),
      ]);
      if (allowance < fields.value) {
        throw new AppError("PAYMENT_REQUIRED", {
          message: "Approve the x402 facilitator to spend Coston2 USDT0 first.",
        });
      }
      if (balance < fields.value) {
        throw new AppError("PAYMENT_REQUIRED", {
          message: "Insufficient Coston2 USDT0. Get testnet tokens from https://faucet.flare.network/coston2",
        });
      }
      const settled = await client.settleTransferFrom(
        wallet,
        body.payment.from,
        body.payment.to,
        fields.value,
      );
      if (!settled.success || !settled.txHash) {
        throw new AppError("SETTLE_FAILED", { message: "x402 ERC-20 settlement failed on-chain." });
      }
      settlementTxHash = settled.txHash;
    } else {
      let signature = body.payment.signature ?? "";
      if (!signature && body.payment.r && body.payment.s && body.payment.v != null) {
        signature = Signature.from({
          r: body.payment.r,
          s: body.payment.s,
          v: body.payment.v,
        }).serialized;
      }
      const alreadyUsed = await client.isAuthorizationUsed(body.payment.from, fields.nonce);
      if (alreadyUsed) {
        throw new AppError("VALIDATION", {
          message: "x402 nonce already settled on-chain — refuse double charge.",
        });
      }
      const ok = await client.verifyPayment(
        body.payment.from,
        body.payment.to,
        fields.value,
        fields.validAfter,
        fields.validBefore,
        fields.nonce,
        signature,
      );
      if (!ok) {
        throw new AppError("VALIDATION", {
          message: "x402 payment authorization invalid.",
        });
      }
      const settled = await client.settlePayment(
        wallet,
        body.payment.from,
        body.payment.to,
        fields.value,
        fields.validAfter,
        fields.validBefore,
        fields.nonce,
        signature,
      );
      if (!settled.success || !settled.txHash) {
        throw new AppError("SETTLE_FAILED", { message: "x402 settlement failed on-chain." });
      }
      settlementTxHash = settled.txHash;
    }
    paidResource = true;
    await recordSpendUsdt0(redis, body.payment.from, spendUnits);
  }

  const serviceId =
    body.serviceId ?? body.payment?.serviceId ?? undefined;

  const result = await runBeaconAgentChat({
    agentId: body.agentId as BeaconAgentId | undefined,
    message: body.message,
    wallet: body.wallet,
    paidResource,
    serviceId,
    settlementTxHash,
    state: (body.state as ConversationState | null | undefined) ?? null,
    env,
  });

  if (body.wallet) {
    try {
      await attachHardwareCapFcc(result, body.wallet, env);
    } catch (err) {
      app.log.warn({ err }, "hardware FCC attach skipped");
    }
  }

  try {
    await attachFdcFlow(result, env, redis);
  } catch (err) {
    app.log.warn({ err }, "FDC Flow attach skipped");
  }

  let conversationId = body.conversationId ?? null;
  if (body.wallet) {
    try {
      if (!conversationId) {
        const title =
          body.message.length > 48 ? `${body.message.slice(0, 48)}…` : body.message;
        const conv = await createConversation(pool, body.wallet, title, result.agentId);
        conversationId = conv.id as string;
      }
      await appendMessage(pool, conversationId, {
        role: "user",
        agentId: body.agentId,
        text: body.message,
      });
      await appendMessage(pool, conversationId, {
        role: "assistant",
        agentId: result.agentId,
        text: result.text,
        cards: result.cards,
        displayModel: result.displayModel,
      });
      await updateConversationState(pool, conversationId, result.state, result.agentId);
      if (paidResource) {
        await recordActivity(pool, body.wallet, "payment", `x402 · ${result.agentId}`, {
          agentId: result.agentId,
          serviceId,
          resource: body.resource ?? body.payment?.resource,
          quoteId: body.quoteId ?? body.payment?.quoteId,
          settlementTxHash,
        });
      }
      if (result.cards.some((c) => c.type === "swap_prepare" || c.type === "bridge_prepare" || c.type === "media_result")) {
        await recordActivity(
          pool,
          body.wallet,
          result.cards.some((c) => c.type === "media_result")
            ? "media"
            : result.cards.some((c) => c.type === "bridge_prepare")
              ? "bridge"
              : "swap",
          result.cards.find(
            (c) => c.type === "media_result" || c.type === "swap_prepare" || c.type === "bridge_prepare",
          )?.title ?? result.agentId,
          { agentId: result.agentId },
        );
      }
    } catch (err) {
      app.log.warn({ err }, "flow persistence skipped");
    }
  }

  return { ok: true, conversationId, ...result };
});

/** Flow conversations — wallet identity */
app.get("/v1/flow/conversations", async (req) => {
  const wallet = z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/i)
    .parse((req.query as { wallet?: string }).wallet);
  const conversations = await listConversations(pool, wallet);
  return { ok: true, conversations };
});

app.post("/v1/flow/conversations", async (req) => {
  const body = z
    .object({
      wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/i),
      title: z.string().min(1).max(120).optional(),
      agentId: z.string().optional(),
    })
    .parse(req.body ?? {});
  const conversation = await createConversation(
    pool,
    body.wallet,
    body.title ?? "New chat",
    body.agentId ?? "general",
  );
  return { ok: true, conversation };
});

app.get("/v1/flow/conversations/:id", async (req) => {
  const id = (req.params as { id: string }).id;
  const wallet = z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/i)
    .parse((req.query as { wallet?: string }).wallet);
  const conversation = await getConversation(pool, id, wallet);
  if (!conversation) throw new AppError("JOB_NOT_FOUND", { message: "Conversation not found." });
  const messages = await listMessages(pool, id);
  return {
    ok: true,
    conversation,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      agentId: m.agent_id,
      text: m.text,
      cards: m.cards_json,
      displayModel: m.display_model,
      createdAt: m.created_at,
    })),
  };
});

app.patch("/v1/flow/conversations/:id", async (req) => {
  const id = (req.params as { id: string }).id;
  const body = z
    .object({
      wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/i),
      title: z.string().min(1).max(120).optional(),
      pinned: z.boolean().optional(),
      archive: z.boolean().optional(),
    })
    .parse(req.body ?? {});
  if (body.title) await renameConversation(pool, id, body.wallet, body.title);
  if (body.pinned != null) await pinConversation(pool, id, body.wallet, body.pinned);
  if (body.archive) await archiveConversation(pool, id, body.wallet);
  return { ok: true };
});

app.get("/v1/flow/activity", async (req) => {
  const wallet = z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/i)
    .parse((req.query as { wallet?: string }).wallet);
  const activity = await listActivity(pool, wallet);
  return { ok: true, activity };
});

app.post("/v1/flow/activity", async (req) => {
  const body = z
    .object({
      wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/i),
      kind: z.enum(["swap", "bridge", "payment", "media", "execution"]),
      title: z.string().min(1).max(160),
      explorerUrl: z.string().url().optional(),
      refId: z.string().max(120).optional(),
      meta: z.record(z.string(), z.unknown()).optional(),
    })
    .parse(req.body ?? {});
  await recordActivity(
    pool,
    body.wallet,
    body.kind,
    body.title,
    body.meta ?? {},
    body.explorerUrl,
    body.refId,
  );
  return { ok: true };
});

/**
 * Personal Beacon Safe status — resolves wallet → factory Safe (never invents balances).
 * Legacy shared vault only when no wallet is provided and factory is unset.
 */
app.get("/v1/vault/status", async (req) => {
  const q = req.query as { address?: string; wallet?: string };
  const address =
    q.address && /^0x[a-fA-F0-9]{40}$/i.test(q.address) ? q.address : undefined;
  const wallet =
    q.wallet && /^0x[a-fA-F0-9]{40}$/i.test(q.wallet) ? q.wallet : undefined;
  const status = await readAgentVaultStatus({
    address,
    wallet,
    personalOnly: Boolean(wallet),
    env,
  });
  return { ok: true, status };
});

app.post("/v1/vault/prepare", async (req) => {
  const body = z
    .object({
      action: z.enum(["deposit", "withdraw", "setPolicy", "setPaused", "setExecutor", "createSafe"]),
      address: z.string().regex(/^0x[a-fA-F0-9]{40}$/i).optional(),
      wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/i).optional(),
      amountUsdt0: z.string().optional(),
      maxSpendPerTxUsdt0: z.string().optional(),
      rollingWindowBudgetUsdt0: z.string().optional(),
      rollingWindowSeconds: z.number().int().positive().optional(),
      sessionExpiresAt: z.number().int().min(0).optional(),
      paused: z.boolean().optional(),
      executor: z.string().regex(/^0x[a-fA-F0-9]{40}$/i).optional(),
      revoke: z.boolean().optional(),
    })
    .parse(req.body ?? {});

  if (body.action === "createSafe") {
    if (!body.wallet) {
      throw new AppError("VALIDATION", { message: "wallet required to create Beacon Safe." });
    }
    const prep = await prepareCreateSafe({ wallet: body.wallet }, env);
    return { ok: true, prep };
  }

  let addr = body.address;
  if (!addr && body.wallet) {
    const status = await readAgentVaultStatus({
      wallet: body.wallet,
      personalOnly: true,
      env,
    });
    if (!status.configured || !status.address) {
      throw new AppError("VALIDATION", {
        message: "SAFE_NOT_CREATED: Create your Beacon Safe first.",
        details: { code: "SAFE_NOT_CREATED" },
      });
    }
    addr = status.address;
  }

  let prep;
  switch (body.action) {
    case "deposit": {
      const amountUsdt0 = body.amountUsdt0 ?? "0";
      if (!(Number(amountUsdt0) > 0)) {
        throw new AppError("VALIDATION", {
          message: "Deposit amount must be greater than 0.",
        });
      }
      prep = await prepareAgentVaultDeposit({ amountUsdt0, address: addr }, env);
      break;
    }
    case "withdraw": {
      const amountUsdt0 = body.amountUsdt0 ?? "0";
      if (!(Number(amountUsdt0) > 0)) {
        throw new AppError("VALIDATION", {
          message: "Withdraw amount must be greater than 0.",
        });
      }
      prep = await prepareAgentVaultWithdraw({ amountUsdt0, address: addr }, env);
      break;
    }
    case "setPolicy":
      prep = await prepareAgentVaultSetPolicy(
        {
          maxSpendPerTxUsdt0: body.maxSpendPerTxUsdt0 ?? "0",
          rollingWindowBudgetUsdt0: body.rollingWindowBudgetUsdt0 ?? "0",
          rollingWindowSeconds: body.rollingWindowSeconds ?? 86400,
          sessionExpiresAt: body.sessionExpiresAt ?? 0,
          address: addr,
        },
        env,
      );
      if (body.wallet) {
        try {
          await refreshSecuritySession(redis, body.wallet);
        } catch {
          /* Redis session refresh is best-effort; on-chain policy still applies. */
        }
      }
      break;
    case "setPaused":
      prep = await prepareAgentVaultSetPaused(
        { paused: body.paused ?? true, address: addr },
        env,
      );
      break;
    case "setExecutor":
      prep = await prepareAgentVaultSetExecutor(
        { executor: body.executor, revoke: body.revoke, address: addr },
        env,
      );
      break;
    default:
      throw new AppError("VALIDATION", { message: "Unknown vault action." });
  }
  return { ok: true, prep };
});

app.get("/v1/vault/swap-desk", async () => {
  const status = await readSwapDeskStatus(env);
  return { ok: true, status };
});

app.post("/v1/vault/safe-swap/prepare", async (req) => {
  const body = z
    .object({
      amountInUnits: z.string().min(1),
      recipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/i),
      slippageBps: z.number().int().min(0).max(1000).optional(),
      address: z.string().regex(/^0x[a-fA-F0-9]{40}$/i).optional(),
      wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/i).optional(),
    })
    .parse(req.body ?? {});
  let address = body.address;
  if (!address && body.wallet) {
    const st = await readAgentVaultStatus({ wallet: body.wallet, personalOnly: true, env });
    if (!st.configured || !st.address) {
      throw new AppError("VALIDATION", {
        message: "SAFE_NOT_CREATED: Create your Beacon Safe before Safe swap.",
        details: { code: "SAFE_NOT_CREATED" },
      });
    }
    address = st.address;
  }
  const quote = await prepareBeaconSafeSwap({ ...body, address }, env);
  if (!quote.ok) {
    throw new AppError("VALIDATION", { message: quote.error });
  }
  return { ok: true, quote };
});

app.post("/v1/vault/safe-swap/execute", async (req) => {
  const body = z
    .object({
      wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/i),
      amountInUnits: z.string().min(1),
      recipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/i),
      slippageBps: z.number().int().min(0).max(1000).optional(),
      syncPolicy: z.boolean().optional(),
    })
    .parse(req.body ?? {});
  await requireSafeSession(req, body.wallet);
  if (body.recipient.toLowerCase() !== body.wallet.toLowerCase()) {
    throw new AppError("UNAUTHORIZED", {
      message: "Safe swap recipient must match the unlocked Safe owner wallet.",
    });
  }
  await assertPolicyAllows(redis, {
    wallet: body.wallet,
    agentId: "swap",
    amountUsdt0: Number(body.amountInUnits),
  });
  const st = await readAgentVaultStatus({ wallet: body.wallet, personalOnly: true, env });
  if (!st.configured || !st.address) {
    throw new AppError("VALIDATION", {
      message: "SAFE_NOT_CREATED: Create your Beacon Safe before Safe swap.",
      details: { code: "SAFE_NOT_CREATED" },
    });
  }
  const address = st.address;
  // Personal Safes are seeded by the factory — only sync policy on explicit legacy vault.
  if (body.syncPolicy === true) {
    await ensureSafeSwapPolicy(env, address);
  }
  const result = await executeBeaconSafeSwap(
    {
      amountInUnits: body.amountInUnits,
      recipient: body.recipient,
      slippageBps: body.slippageBps,
      address,
    },
    env,
  );
  if (!result.ok) {
    throw new AppError("VALIDATION", { message: result.error });
  }
  await recordSpendUsdt0(redis, body.wallet, Number(body.amountInUnits));
  return result;
});

/** Security Center policies — persisted in Redis when available. */
app.get("/v1/security/policy", async (req) => {
  const wallet = z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/i)
    .parse((req.query as { wallet?: string }).wallet);
  const { policy, source } = await loadPolicy(redis, wallet);
  const spentToday = await getDailySpendUsdt0(redis, wallet);
  const remaining = Math.max(0, policy.dailySpendUsdt0 - spentToday);
  return {
    ok: true,
    policy,
    source,
    receipt: {
      title: "Authorization receipt",
      network: "Flare Testnet Coston2",
      chainId: 114,
      spentTodayUsdt0: Number(spentToday.toFixed(4)),
      remainingUsdt0: Number(remaining.toFixed(4)),
      dailyBudgetUsdt0: policy.dailySpendUsdt0,
      perJobLimitUsdt0: policy.perJobLimitUsdt0,
      emergencyPause: policy.emergencyPause,
      sessionExpiryHours: policy.sessionExpiryHours,
      sessionStartedAt: policy.sessionStartedAt ?? policy.updatedAt ?? null,
      allowedAgents: policy.allowedAgents,
      note:
        source === "unavailable"
          ? "Redis unavailable — spend denied (fail closed). Free agent chat may still work; paid paths require Redis."
          : "Server-enforced policy on Beacon API. Session expiry is enforced from last policy save. Pause or revoke anytime.",
    },
  };
});

app.put("/v1/security/policy", async (req) => {
  const body = z
    .object({
      wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/i),
      policy: z.object({
        dailySpendUsdt0: z.number().min(0).max(1_000_000),
        perJobLimitUsdt0: z.number().min(0).max(1_000_000),
        allowedAgents: z.array(z.string()),
        allowedChains: z.array(z.number()),
        maxImageCostUsdt0: z.number().min(0),
        maxVideoSeconds: z.number().min(0),
        emergencyPause: z.boolean(),
    sessionExpiryHours: z.number().min(0).max(720),
      }),
    })
    .parse(req.body ?? {});
  await requireSafeSession(req, body.wallet);
  const nowIso = new Date().toISOString();
  const stored: BeaconSecurityPolicy = {
    ...body.policy,
    updatedAt: nowIso,
    sessionStartedAt: nowIso,
  };
  if (!redis) {
    return {
      ok: false,
      policy: stored,
      source: "unavailable",
      error: "Redis required to persist security policy (fail closed for spend accounting).",
    };
  }
  await redis.set(policyKey(body.wallet), stored);
  return { ok: true, policy: stored, source: "redis" };
});

app.post("/v1/security/revoke", async (req) => {
  const body = z.object({ wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/i) }).parse(req.body ?? {});
  await requireSafeSession(req, body.wallet);
  const nowIso = new Date().toISOString();
  const paused: BeaconSecurityPolicy = {
    ...DEFAULT_SECURITY_POLICY,
    dailySpendUsdt0: 0,
    perJobLimitUsdt0: 0,
    allowedAgents: [],
    maxImageCostUsdt0: 0,
    maxVideoSeconds: 0,
    emergencyPause: true,
    sessionExpiryHours: 1,
    updatedAt: nowIso,
    sessionStartedAt: nowIso,
  };
  const revokedAt = Math.floor(Date.now() / 1000);
  const sessionKey = `safe-session-revoked-after:${body.wallet.toLowerCase()}`;
  revokedSafeSessions.set(sessionKey, revokedAt);
  const mcpRevoked = await revokeMcpGrantsForWallet(redis, body.wallet);
  if (redis) {
    await Promise.all([
      redis.set(policyKey(body.wallet), paused),
      redis.set(sessionKey, revokedAt, { ex: 30 * 24 * 60 * 60 }),
    ]);
  }
  return {
    ok: true,
    message: "Emergency pause on. Clear allowances for SparkDEX router in your wallet if you approved spending.",
    mcpGrantsRevoked: mcpRevoked,
  };
});

await registerMcpRoutes(app, {
  env,
  redis,
  requireSafeSession,
  bearerToken,
  createJob: async ({ serviceId, briefText }) => {
    const body = createJobSchema.parse({ serviceId, briefText });
    const userId = await ensureGuestUser();
    const jobId = newId();
    await pool.query(
      `INSERT INTO jobs (id, user_id, service_id, status, brief_text)
       VALUES ($1, $2, $3, $4, $5)`,
      [jobId, userId, body.serviceId, JobStatus.DRAFT, body.briefText],
    );
    const quoting = transition(JobStatus.DRAFT, "create_job");
    await updateJobStatus(jobId, quoting);
    return { jobId, status: quoting };
  },
});

const port = Number(process.env.PORT || env.API_PORT || 3001);

/** Answer-token stream — conversation only; never advances execution money state. */
app.post("/v1/chat/stream", async (req, reply) => {
  const body = z
    .object({
      message: z.string().min(1).max(4000),
      role: z.enum(["generator", "quote", "judge", "acceptance"]).default("quote"),
      system: z.string().max(4000).optional(),
    })
    .parse(req.body ?? {});

  if (!isAiConfigured(env)) {
    throw new AppError("VALIDATION", { message: "AI provider is not configured." });
  }

  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  const model = resolveModelForRole(body.role, env);
  reply.raw.write(`event: meta\ndata: ${JSON.stringify({ model, role: body.role })}\n\n`);

  try {
    const messages = [
      ...(body.system ? [{ role: "system" as const, content: body.system }] : []),
      { role: "user" as const, content: body.message },
    ];
    for await (const delta of chatCompletionStream({ model, messages }, env)) {
      reply.raw.write(`event: token\ndata: ${JSON.stringify({ delta })}\n\n`);
    }
    reply.raw.write(`event: done\ndata: ${JSON.stringify({ ok: true })}\n\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "stream failed";
    reply.raw.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
  } finally {
    reply.raw.end();
  }
});

try {
  await ensureFlowSchema(pool);
  console.log("Flow persistence schema ready");
} catch (err) {
  console.warn("Flow schema ensure failed", err instanceof Error ? err.message : err);
}
await app.listen({ port, host: "0.0.0.0" });
console.log(`Beacon API listening on ${port}`);

if (redis) {
  startEmbeddedWorkers(pool, redis);
} else {
  console.warn("[workers] Redis unavailable — pipeline/settler not started");
}

// expose typed data helper for clients that need approve payloads — domain name FROM token.name()
export async function buildApproveTypedData(
  tokenAddress: string,
  chainId: number,
  fields: Record<string, unknown>,
  provider?: import("ethers").Provider,
) {
  if (!provider) {
    throw new Error("Provider required to resolve EIP-712 domain from token.name().");
  }
  const resolved = await resolveEip3009Domain(provider, tokenAddress, chainId);
  return {
    domain: buildEip3009Domain(chainId, tokenAddress, {
      name: resolved.name,
      version: resolved.version,
    }),
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: fields,
    nonce: randomAuthNonce(),
    assetLabel: COSTON2_USDT0_LABEL,
  };
}
