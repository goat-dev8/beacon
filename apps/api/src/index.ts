import "dotenv/config";
import Fastify from "fastify";
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
  isAppError,
  newId,
  assertFlareRequired,
  BEACON_AGENTS,
  runBeaconAgentChat,
  readFtsoFeeds,
  prepareUsdt0ToFxrpSwap,
  readErc20Balance,
  resolveFxrpAddress,
  COSTON2_USDT0,
  type BeaconAgentId,
  type ConversationState,
} from "@beacon/shared";
import { FacilitatorClient } from "@beacon/x402";
import { JsonRpcProvider, Wallet, Signature } from "ethers";
import {
  buildBoundOffer,
  evaluateSealedFit,
  toQuoteDto,
  SERVICE_CATALOG,
  type ServiceId,
} from "@beacon/quote";
import { registryFromEnv, assertRegistryConfigured, encodeCreditDepositMemo } from "@beacon/smart-accounts";
import { buildEip3009Domain, TRANSFER_WITH_AUTHORIZATION_TYPES, randomAuthNonce } from "@beacon/x402";
import { startEmbeddedWorkers } from "./workers.js";
import { PIPELINE_CAPS } from "@beacon/pipeline";
import {
  assertPolicyAllows,
  DEFAULT_SECURITY_POLICY,
  getDailySpendUsdt0,
  loadPolicy,
  parseUsdt0Display,
  policyKey,
  recordSpendUsdt0,
  type BeaconSecurityPolicy,
} from "./securityPolicy.js";

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

await app.register(cors, { origin: true });
await app.register(sensible);

app.setErrorHandler((error, _req, reply) => {
  if (isAppError(error)) {
    return reply.status(error.statusCode).send(error.toJSON());
  }
  app.log.error(error);
  return reply.status(500).send({
    error: { code: "INTERNAL", message: "Something went wrong on our side. Please try again." },
  });
});

app.get("/health", async () => ({
  ok: true,
  chainId: env.CHAIN_ID,
  network: env.NETWORK_NAME,
  flareRequired: (env.FLARE_REQUIRED || "true").toLowerCase() !== "false",
  flareRails: {
    escrow: env.BEACON_ESCROW,
    x402Token: env.X402_TOKEN_ADDRESS,
    facilitator: env.X402_FACILITATOR_ADDRESS,
    jobRegistry: env.BEACON_JOB_REGISTRY,
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
  honesty: honestyMessage(env.SIMULATED_TEE),
  service: "beacon-api",
  version: "0.1.0",
  pipeline: PIPELINE_CAPS,
}));

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
  checks.registry = {
    ok: missing.length === 0,
    detail: missing.length ? `missing ${missing.join(", ")}` : "configured",
  };

  const ready = Object.values(checks).every((c) => c.ok);
  return reply.status(ready ? 200 : 503).send({ ready, checks, registry });
});

app.get("/v1/services", async () => ({ services: SERVICE_CATALOG }));

const createJobSchema = z.object({
  serviceId: z.enum([
    "video",
    "image",
    "voice",
    "presentations",
    "coding",
    "research",
    "documents",
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
  validBefore: z.string().min(1),
  nonce: z.string().min(1),
  signature: z.string().min(1),
});

const approveSchema = z.object({
  offerId: z.string().uuid(),
  authorization: eip3009AuthSchema.optional(),
  /** On-chain BeaconEscrow.lockWithAuthorization tx hash (Coston2). */
  lockTxHash: z.string().optional(),
});

app.post("/v1/jobs/:id/approve", async (req) => {
  const jobId = (req.params as { id: string }).id;
  const body = approveSchema.parse(req.body);
  const job = await getJob(jobId);

  if (job.status !== JobStatus.QUOTED) {
    throw new AppError("INVALID_TRANSITION");
  }

  // Flare rails are the product: paid jobs must carry EIP-3009 auth from Coston2 lock.
  const flareRequired = (env.FLARE_REQUIRED || "true").toLowerCase() !== "false";
  if (flareRequired && !body.authorization?.signature) {
    throw new AppError("VALIDATION", {
      message:
        "Flare Coston2 EIP-3009 authorization required. Sign TransferWithAuthorization and lock via BeaconEscrow before approve.",
    });
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

  const payer = body.authorization?.payer;
  const priceRaw = offer.rows[0].price_usdt0;
  // price_usdt0 is stored as 6-decimal integer units
  const amountUsdt0 =
    typeof priceRaw === "bigint" || typeof priceRaw === "number" || /^\d+$/.test(String(priceRaw))
      ? Number(priceRaw) / 1e6
      : parseUsdt0Display(body.authorization?.amount ?? "0");

  if (payer) {
    await assertPolicyAllows(redis, {
      wallet: payer,
      serviceId: String(job.service_id ?? ""),
      amountUsdt0,
      agentId: "desk",
    });
  }

  const userId = job.user_id ?? (await ensureGuestUser());
  await pool.query(
    `INSERT INTO authorizations (offer_id, user_id, eip3009_payload, valid_before, status)
     VALUES ($1, $2, $3::jsonb, to_timestamp($4), 'active')`,
    [
      body.offerId,
      userId,
      JSON.stringify({
        ...(body.authorization ?? {}),
        lockTxHash: body.lockTxHash ?? null,
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
    await recordSpendUsdt0(redis, payer, amountUsdt0);
  }

  return { jobId, status: next, offerId: body.offerId };
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
  return {
    job,
    recentEvents: events,
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
    mockUsdt0: env.X402_TOKEN_ADDRESS,
    facilitator: env.X402_FACILITATOR_ADDRESS,
    escrow: env.BEACON_ESCROW,
    coston2Usdt0: "0xC1A5B41512496B80903D1f32d6dEa3a73212E71F",
    sparkdexRouter: "0x8a1E35F5c98C4E85B36B7B253222eE17773b2781",
  },
}));

app.get("/v1/agents/signals", async () => {
  const snap = await readFtsoFeeds(env);
  return { ok: true, ...snap };
});

app.get("/v1/agents/balances", async (req) => {
  const wallet = z.string().regex(/^0x[a-fA-F0-9]{40}$/).parse((req.query as { wallet?: string }).wallet);
  const fxrp = await resolveFxrpAddress(env);
  const [usdt0, fxrpBal, mock] = await Promise.all([
    readErc20Balance(COSTON2_USDT0, wallet, env),
    readErc20Balance(fxrp, wallet, env),
    env.X402_TOKEN_ADDRESS
      ? readErc20Balance(env.X402_TOKEN_ADDRESS, wallet, env)
      : Promise.resolve(null),
  ]);
  return {
    ok: true,
    wallet,
    network: "coston2",
    chainId: 114,
    balances: {
      usdt0: { address: COSTON2_USDT0, ...usdt0 },
      fxrp: { address: fxrp, ...fxrpBal },
      mockUsdt0: mock && env.X402_TOKEN_ADDRESS ? { address: env.X402_TOKEN_ADDRESS, ...mock } : null,
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
      "video",
      "research",
    ])
    .optional(),
  message: z.string().min(1).max(4000),
  wallet: z.string().optional(),
  state: z
    .object({
      intent: z.string(),
      phase: z.string(),
      amountInUnits: z.string().optional(),
      bridgeFrom: z.string().optional(),
      bridgeTo: z.string().optional(),
    })
    .optional()
    .nullable(),
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
});

app.post("/v1/agents/chat", async (req) => {
  const body = agentChatSchema.parse(req.body ?? {});
  let paidResource = false;

  if (body.wallet) {
    await assertPolicyAllows(redis, {
      wallet: body.wallet,
      agentId: body.agentId,
    });
  }

  if (body.payment?.signature || (body.payment?.r && body.payment?.s)) {
    const spendUnits = Number(BigInt(body.payment.value)) / 1e6;
    if (body.wallet || body.payment.from) {
      await assertPolicyAllows(redis, {
        wallet: body.wallet || body.payment.from,
        agentId: body.agentId ?? "pay",
        amountUsdt0: spendUnits,
      });
    }
    const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
    const client = new FacilitatorClient({
      facilitatorAddress: env.X402_FACILITATOR_ADDRESS!,
      tokenAddress: env.X402_TOKEN_ADDRESS!,
      provider,
    });
    let signature = body.payment.signature ?? "";
    if (!signature && body.payment.r && body.payment.s && body.payment.v != null) {
      signature = Signature.from({
        r: body.payment.r,
        s: body.payment.s,
        v: body.payment.v,
      }).serialized;
    }
    const ok = await client.verifyPayment(
      body.payment.from,
      body.payment.to,
      BigInt(body.payment.value),
      BigInt(body.payment.validAfter),
      BigInt(body.payment.validBefore),
      body.payment.nonce as `0x${string}`,
      signature,
    );
    if (!ok) {
      throw new AppError("VALIDATION", { message: "x402 payment authorization invalid." });
    }
    if (env.DEPLOYER_PRIVATE_KEY) {
      const wallet = new Wallet(env.DEPLOYER_PRIVATE_KEY, provider);
      await client.settlePayment(
        wallet,
        body.payment.from,
        body.payment.to,
        BigInt(body.payment.value),
        BigInt(body.payment.validAfter),
        BigInt(body.payment.validBefore),
        body.payment.nonce as `0x${string}`,
        signature,
      );
    }
    paidResource = true;
    await recordSpendUsdt0(redis, body.payment.from, spendUnits);
  }

  const result = await runBeaconAgentChat({
    agentId: body.agentId as BeaconAgentId | undefined,
    message: body.message,
    wallet: body.wallet,
    paidResource,
    state: (body.state as ConversationState | null | undefined) ?? null,
    env,
  });
  return { ok: true, ...result };
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
      allowedAgents: policy.allowedAgents,
      note: "Your agent spends only within this budget. Pause or revoke anytime.",
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
        sessionExpiryHours: z.number().min(1).max(720),
      }),
    })
    .parse(req.body ?? {});
  if (!redis) {
    return { ok: true, policy: body.policy, source: "ephemeral" };
  }
  await redis.set(policyKey(body.wallet), body.policy as BeaconSecurityPolicy);
  return { ok: true, policy: body.policy, source: "redis" };
});

app.post("/v1/security/revoke", async (req) => {
  const body = z.object({ wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/i) }).parse(req.body ?? {});
  const paused: BeaconSecurityPolicy = {
    ...DEFAULT_SECURITY_POLICY,
    dailySpendUsdt0: 0,
    perJobLimitUsdt0: 0,
    allowedAgents: [],
    maxImageCostUsdt0: 0,
    maxVideoSeconds: 0,
    emergencyPause: true,
    sessionExpiryHours: 1,
  };
  if (redis) {
    await redis.set(policyKey(body.wallet), paused);
  }
  return {
    ok: true,
    message: "Emergency pause on. Clear allowances for SparkDEX router in your wallet if you approved spending.",
  };
});

const port = Number(process.env.PORT || env.API_PORT || 3001);
await app.listen({ port, host: "0.0.0.0" });
console.log(`Beacon API listening on ${port}`);

if (redis) {
  startEmbeddedWorkers(pool, redis);
} else {
  console.warn("[workers] Redis unavailable — pipeline/settler not started");
}

// expose typed data helper for clients that need approve payloads
export function buildApproveTypedData(tokenAddress: string, chainId: number, fields: Record<string, unknown>) {
  return {
    domain: buildEip3009Domain(chainId, tokenAddress),
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: fields,
    nonce: randomAuthNonce(),
  };
}
