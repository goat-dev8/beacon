import path from "node:path";
import os from "node:os";
import type pg from "pg";
import type { Redis } from "@upstash/redis";
import {
  JobStatus,
  transition,
  loadEnv,
  jobIdToBytes32,
  newId,
  type JobStatusValue,
} from "@beacon/shared";
import { runPipeline } from "@beacon/pipeline";
import { runAcceptance } from "@beacon/acceptance";
import { buildReceipt } from "@beacon/receipts";
import { JsonRpcProvider, Wallet, Contract } from "ethers";
import { FacilitatorClient } from "@beacon/x402";
import { reverseSpendUsdt0 } from "./securityPolicy.js";

interface JobRow {
  id: string;
  service_id: string;
  status: JobStatusValue;
  brief_text: string | null;
}

/** Run orchestrator + settler loops inside the API process (Render free tier). */
export function startEmbeddedWorkers(db: pg.Pool, redis: Redis): void {
  // Default ON unless explicitly disabled — single-service deploys need this.
  const enablePipeline = process.env.ENABLE_PIPELINE !== "false";
  const enableSettler = process.env.ENABLE_SETTLER !== "false";
  if (enablePipeline) {
    console.log("[workers] pipeline orchestrator embedded");
    void loop(async () => tickPipeline(db, redis), 3000);
  }
  if (enableSettler) {
    console.log("[workers] settler embedded");
    void loop(async () => tickSettler(db, redis), 4000);
  }
}

async function loop(fn: () => Promise<void>, ms: number): Promise<void> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await fn();
    } catch (err) {
      console.error("[workers] tick error", err);
    }
    await sleep(ms);
  }
}

async function tickPipeline(db: pg.Pool, redis: Redis): Promise<void> {
  // One job at a time — video ffmpeg must not stack on Render free tier.
  const { rows } = await db.query<JobRow>(
    `SELECT id, service_id, status, brief_text
     FROM jobs
     WHERE status IN ('AUTHORIZED', 'PREPARING', 'GENERATING', 'COMPOSING', 'ACCEPTING')
     ORDER BY updated_at ASC
     LIMIT 1`,
  );
  for (const job of rows) {
    await processPipelineJob(db, redis, job);
  }
}

async function processPipelineJob(db: pg.Pool, redis: Redis, job: JobRow): Promise<void> {
  const lockKey = `lock:job:${job.id}`;
  const isVideo = String(job.service_id).toLowerCase() === "video";
  // Video needs CF + ffmpeg headroom; text/coding need AgentRouter time (gpt-5.6-sol).
  const isTextJob = !["image", "video", "voice"].includes(String(job.service_id || "").toLowerCase());
  const lockTtl = isVideo ? 240 : isTextJob ? 360 : 180;
  // gpt-5.6-sol coding via Pollinations needs headroom for retries.
  const pipelineMs = isVideo ? 150_000 : isTextJob ? 240_000 : 90_000;
  const locked = await redis.set(lockKey, "1", { nx: true, ex: lockTtl });
  if (!locked) return;

  try {
    let status = job.status;
    if (status === JobStatus.AUTHORIZED) {
      status = await advance(db, redis, job.id, status, "orchestrator_prepare");
    }
    if (status === JobStatus.PREPARING) {
      status = await advance(db, redis, job.id, status, "stages_start");
    }
    if (status === JobStatus.GENERATING) {
      const outputDir = path.join(os.tmpdir(), "beacon", job.id);
      try {
        const result = await Promise.race([
          runPipeline({
            jobId: job.id,
            serviceId: job.service_id,
            briefText: job.brief_text ?? "",
            outputDir,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`pipeline timeout after ${pipelineMs / 1000}s`)),
              pipelineMs,
            ),
          ),
        ]);
        console.log(
          "[workers] pipeline artifacts",
          job.id,
          job.service_id,
          result.artifacts.map((a) => `${a.kind}:${a.mimeType}`).join(","),
        );
        for (const artifact of result.artifacts) {
          await db.query(
            `INSERT INTO artifacts (job_id, kind, uri, meta) VALUES ($1, $2, $3, $4::jsonb)`,
            [
              job.id,
              artifact.kind,
              artifact.uri,
              JSON.stringify({ ...(artifact.meta ?? {}), mimeType: artifact.mimeType }),
            ],
          );
        }
        await publish(redis, job.id, "artifact", { count: result.artifacts.length });
        status = await advance(db, redis, job.id, status, "generation_done");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[workers] pipeline failed", job.id, message);
        await publish(redis, job.id, "error", { stage: "generation", message: message.slice(0, 400) });
        status = await advance(db, redis, job.id, status, "generation_failed");
        await redis.lpush("q:settle", `refuse:${job.id}`);
        return;
      }
    }
    if (status === JobStatus.COMPOSING) {
      status = await advance(db, redis, job.id, status, "artifacts_ready");
    }
    if (status === JobStatus.ACCEPTING) {
      try {
        const { rows: artifacts } = await db.query(
          `SELECT kind, uri, meta FROM artifacts WHERE job_id = $1`,
          [job.id],
        );
        const report = await runAcceptance({
          jobId: job.id,
          serviceId: job.service_id,
          rubricVersion: "v1",
          artifacts: artifacts.map((a) => ({
            kind: a.kind,
            uri: a.uri,
            mimeType: (a.meta as { mimeType?: string })?.mimeType,
            payload: a.meta,
          })),
        });
        await db.query(
          `INSERT INTO accept_reports (job_id, result, report_json, confidence)
           VALUES ($1, $2, $3::jsonb, $4)`,
          [job.id, report.result, JSON.stringify(report), report.confidence],
        );
        status = await advance(db, redis, job.id, status, "accept_report", report.result);
        if (report.result === "PASS") await redis.lpush("q:settle", job.id);
        else if (report.result === "FAIL") await redis.lpush("q:settle", `refuse:${job.id}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[workers] acceptance failed", job.id, message);
        await publish(redis, job.id, "error", { stage: "acceptance", message: message.slice(0, 400) });
        // Soft path: L1/L3 already preferred; judge/infra throws must not silent-FAILED without report.
        // Record NEEDS_LOOK so the user can accept (pay) or reject (refund) with a visible deliverable.
        await db.query(
          `INSERT INTO accept_reports (job_id, result, report_json, confidence)
           VALUES ($1, 'NEEDS_LOOK', $2::jsonb, 0.55)`,
          [
            job.id,
            JSON.stringify({
              jobId: job.id,
              result: "NEEDS_LOOK",
              confidence: 0.55,
              summary: "Acceptance judge unavailable — please confirm the deliverable.",
              notes: [message.slice(0, 240)],
              checkedAt: new Date().toISOString(),
            }),
          ],
        );
        try {
          status = await advance(db, redis, job.id, status, "accept_report", "NEEDS_LOOK");
        } catch {
          await db.query(`UPDATE jobs SET status = 'NEEDS_LOOK', updated_at = NOW() WHERE id = $1`, [
            job.id,
          ]);
          await publish(redis, job.id, "status", { status: "NEEDS_LOOK" });
        }
      }
    }
  } finally {
    await redis.del(lockKey);
  }
}

async function tickSettler(db: pg.Pool, redis: Redis): Promise<void> {
  const item = await redis.rpop<string>("q:settle");
  if (!item) return;
  if (item.startsWith("refuse:")) {
    await refuseJob(db, redis, item.slice("refuse:".length));
  } else {
    await settleJob(db, redis, item);
  }
}

async function settleJob(db: pg.Pool, redis: Redis, jobId: string): Promise<void> {
  const env = loadEnv();
  const { rows } = await db.query(
    `SELECT j.id, j.service_id, j.status, o.id AS offer_id, o.price_usdt0, o.brief_hash, o.rubric_hash,
            a.eip3009_payload
     FROM jobs j
     JOIN offers o ON o.job_id = j.id
     LEFT JOIN authorizations a ON a.offer_id = o.id AND a.status = 'active'
     WHERE j.id = $1
     ORDER BY o.created_at DESC NULLS LAST
     LIMIT 1`,
    [jobId],
  );
  const row = rows[0];
  if (!row) return;

  let txHash: string | undefined;
  let settled = false;

  if (env.X402_FACILITATOR_ADDRESS && env.X402_TOKEN_ADDRESS && (env.SETTLER_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY)) {
    try {
      const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
      const signer = new Wallet(env.SETTLER_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY!, provider);
      const auth = row.eip3009_payload as {
        payer?: string;
        payee?: string;
        amount?: string;
        validAfter?: string;
        validBefore?: string;
        nonce?: string;
        signature?: string;
        mode?: string;
        lockTxHash?: string;
      };
      const escrowLocked =
        Boolean(auth?.lockTxHash) ||
        auth?.mode === "beacon_safe" ||
        Boolean(auth?.signature && auth?.nonce);
      if (escrowLocked && env.BEACON_ESCROW) {
        const escrow = new Contract(
          env.BEACON_ESCROW,
          ["function releaseToPayee(bytes32 jobId)"],
          signer,
        );
        const tx = await escrow.releaseToPayee(jobIdToBytes32(jobId));
        const receipt = await tx.wait();
        settled = true;
        txHash = receipt?.hash;
      } else if (auth?.payer && auth?.signature && auth?.nonce) {
        const client = new FacilitatorClient({
          facilitatorAddress: env.X402_FACILITATOR_ADDRESS,
          tokenAddress: env.X402_TOKEN_ADDRESS,
          provider,
        });
        const result = await client.settlePayment(
          signer,
          auth.payer,
          auth.payee ?? env.X402_PAYEE_ADDRESS ?? auth.payer,
          BigInt(auth.amount ?? row.price_usdt0),
          BigInt(auth.validAfter ?? 0),
          BigInt(auth.validBefore ?? Math.floor(Date.now() / 1000) + 3600),
          auth.nonce as `0x${string}`,
          auth.signature,
        );
        settled = result.success;
        txHash = result.txHash;
      } else {
        settled = true;
      }
    } catch (err) {
      console.error("[workers] settle error", err);
    }
  } else {
    settled = true;
  }

  const next = transition(row.status, settled ? "settler_pass" : "settler_fail");
  const closed = transition(next, "terminal_close");
  await db.query(`UPDATE jobs SET status = $2, updated_at = NOW() WHERE id = $1`, [jobId, closed]);

  const accept = await db.query(
    `SELECT id, result, confidence, report_json FROM accept_reports WHERE job_id = $1 ORDER BY id DESC LIMIT 1`,
    [jobId],
  );
  const acceptRow = accept.rows[0];
  const receipt = buildReceipt({
    jobId,
    serviceId: row.service_id,
    offer: {
      offerId: row.offer_id,
      briefHash: row.brief_hash,
      rubricHash: row.rubric_hash,
      priceUsdt0: String(row.price_usdt0),
    },
    accept: {
      acceptId: acceptRow?.id ?? newId(),
      result: acceptRow?.result ?? "PASS",
      confidence: acceptRow?.confidence ?? 1,
      summary: (acceptRow?.report_json as { summary?: string })?.summary ?? "Completed",
    },
    payment: {
      paymentId: newId(),
      txHash,
      settled,
      amountUsdt0: String(row.price_usdt0),
    },
  });

  await db.query(
    `INSERT INTO receipts (id, job_id, payment_id, tx_hash, offer_id, accept_id, receipt_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT DO NOTHING`,
    [
      receipt.id,
      jobId,
      receipt.payment.paymentId,
      txHash ?? null,
      row.offer_id,
      acceptRow?.id ?? null,
      JSON.stringify(receipt),
    ],
  );
  await publish(redis, jobId, "status", { status: closed });
}

async function refuseJob(db: pg.Pool, redis: Redis, jobId: string): Promise<void> {
  const env = loadEnv();
  const { rows } = await db.query(
    `SELECT j.status, j.service_id, o.id AS offer_id, o.price_usdt0, o.brief_hash, o.rubric_hash
     FROM jobs j
     LEFT JOIN LATERAL (
       SELECT id, price_usdt0, brief_hash, rubric_hash FROM offers WHERE job_id = j.id ORDER BY created_at DESC LIMIT 1
     ) o ON true
     WHERE j.id = $1`,
    [jobId],
  );
  const row = rows[0];
  const status = row?.status ?? JobStatus.FAILED;

  let refundTx: string | undefined;
  if (env.BEACON_ESCROW && (env.SETTLER_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY) && env.COSTON2_RPC_URL) {
    try {
      const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
      const signer = new Wallet(env.SETTLER_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY!, provider);
      const escrow = new Contract(
        env.BEACON_ESCROW,
        [
          "function refund(bytes32 jobId)",
          "function locks(bytes32) view returns (address,uint256,bool,bool)",
        ],
        signer,
      );
      const jobHash = jobIdToBytes32(jobId);
      const lock = await escrow.locks(jobHash);
      const payer = lock[0] as string;
      if (
        payer &&
        payer !== "0x0000000000000000000000000000000000000000" &&
        !lock[2] &&
        !lock[3]
      ) {
        const tx = await escrow.refund(jobHash);
        const receipt = await tx.wait();
        refundTx = receipt?.hash ?? tx.hash;
        console.log("[workers] escrow refunded", jobId, refundTx);
        try {
          const auth = await db.query(
            `SELECT a.eip3009_payload
             FROM authorizations a
             JOIN offers o ON o.id = a.offer_id
             WHERE o.job_id = $1
             ORDER BY a.id DESC
             LIMIT 1`,
            [jobId],
          );
          const payload = auth.rows[0]?.eip3009_payload as
            | { ownerWallet?: string; payer?: string }
            | undefined;
          const wallet = payload?.ownerWallet || payload?.payer;
          const priceRaw = row?.price_usdt0;
          const amountUsdt0 =
            typeof priceRaw === "bigint" || typeof priceRaw === "number" || /^\d+$/.test(String(priceRaw ?? ""))
              ? Number(priceRaw) / 1e6
              : Number(String(priceRaw ?? "0").replace(/[^0-9.]/g, "")) || 0;
          if (wallet && amountUsdt0 > 0) {
            await reverseSpendUsdt0(redis, wallet, amountUsdt0);
            console.log("[workers] reversed Redis spend window", jobId, wallet, amountUsdt0);
          }
        } catch (revErr) {
          console.error("[workers] spend reverse error", jobId, revErr);
        }
      }
    } catch (err) {
      console.error("[workers] escrow refund error", jobId, err);
    }
  }

  let next: JobStatusValue = JobStatus.CLOSED;
  try {
    next = transition(status, "settler_fail");
    next = transition(next, "terminal_close");
  } catch {
    next = JobStatus.CLOSED;
  }
  await db.query(`UPDATE jobs SET status = $2, updated_at = NOW() WHERE id = $1`, [jobId, next]);

  // Seal a refund receipt so the Jobs timeline completes (Receipt sealed).
  try {
    const accept = await db.query(
      `SELECT id, result, confidence, report_json FROM accept_reports WHERE job_id = $1 ORDER BY id DESC LIMIT 1`,
      [jobId],
    );
    const acceptRow = accept.rows[0];
    const receipt = buildReceipt({
      jobId,
      serviceId: row?.service_id ?? "unknown",
      offer: {
        offerId: row?.offer_id ?? newId(),
        briefHash: row?.brief_hash ?? "0x0",
        rubricHash: row?.rubric_hash ?? "0x0",
        priceUsdt0: String(row?.price_usdt0 ?? "0"),
      },
      accept: {
        acceptId: acceptRow?.id ?? newId(),
        result: acceptRow?.result ?? "FAIL",
        confidence: acceptRow?.confidence ?? 0,
        summary:
          (acceptRow?.report_json as { summary?: string })?.summary ??
          "Job did not pass — escrow refunded.",
      },
      payment: {
        paymentId: newId(),
        txHash: refundTx,
        settled: false,
        amountUsdt0: "0",
      },
    });
    await db.query(
      `INSERT INTO receipts (id, job_id, payment_id, tx_hash, offer_id, accept_id, receipt_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT DO NOTHING`,
      [
        receipt.id,
        jobId,
        receipt.payment.paymentId,
        refundTx ?? null,
        row?.offer_id ?? null,
        acceptRow?.id ?? null,
        JSON.stringify(receipt),
      ],
    );
  } catch (err) {
    console.error("[workers] refund receipt error", jobId, err);
  }

  await publish(redis, jobId, "status", { status: next, refundTx });
}

async function advance(
  db: pg.Pool,
  redis: Redis,
  jobId: string,
  from: JobStatusValue,
  trigger: Parameters<typeof transition>[1],
  acceptOutcome?: "PASS" | "FAIL" | "NEEDS_LOOK",
): Promise<JobStatusValue> {
  const next = transition(from, trigger, acceptOutcome);
  await db.query(`UPDATE jobs SET status = $2, updated_at = NOW() WHERE id = $1`, [jobId, next]);
  await db.query(
    `INSERT INTO job_events (job_id, type, payload) VALUES ($1, 'status', $2::jsonb)`,
    [jobId, JSON.stringify({ from, to: next, trigger })],
  );
  await publish(redis, jobId, "status", { status: next });
  return next;
}

async function publish(
  redis: Redis,
  jobId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const message = JSON.stringify({ type, payload, ts: new Date().toISOString() });
  await redis.publish(`sse:job:${jobId}`, message);
  await redis.lpush(`sse:job:${jobId}:log`, message);
  await redis.ltrim(`sse:job:${jobId}:log`, 0, 499);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
