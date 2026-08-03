import "dotenv/config";
import path from "node:path";
import os from "node:os";
import pg from "pg";
import { Redis } from "@upstash/redis";
import {
  JobStatus,
  transition,
  loadEnv,
  requireEnv,
  type JobStatusValue,
} from "@beacon/shared";
import { runPipeline } from "@beacon/pipeline";
import { runAcceptance } from "@beacon/acceptance";

const POLL_MS = 3000;

interface JobRow {
  id: string;
  service_id: string;
  status: JobStatusValue;
  brief_text: string | null;
}

async function main(): Promise<void> {
  const env = loadEnv();
  const db = new pg.Pool({
    connectionString: requireEnv(env, "DATABASE_URL"),
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
  });
  const redis = new Redis({
    url: requireEnv(env, "UPSTASH_REDIS_REST_URL"),
    token: requireEnv(env, "UPSTASH_REDIS_REST_TOKEN"),
  });

  console.log("Beacon orchestrator started");
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await tick(db, redis);
    } catch (err) {
      console.error("orchestrator tick error", err);
    }
    await sleep(POLL_MS);
  }
}

async function tick(db: pg.Pool, redis: Redis): Promise<void> {
  const { rows } = await db.query<JobRow>(
    `SELECT id, service_id, status, brief_text
     FROM jobs
     WHERE status IN ('AUTHORIZED', 'PREPARING', 'GENERATING', 'COMPOSING', 'ACCEPTING')
     ORDER BY updated_at ASC
     LIMIT 5`,
  );

  for (const job of rows) {
    await processJob(db, redis, job);
  }
}

async function processJob(db: pg.Pool, redis: Redis, job: JobRow): Promise<void> {
  const lockKey = `lock:job:${job.id}`;
  const locked = await redis.set(lockKey, "1", { nx: true, ex: 120 });
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
      const result = await runPipeline({
        jobId: job.id,
        serviceId: job.service_id,
        briefText: job.brief_text ?? "",
        outputDir,
      });
      for (const artifact of result.artifacts) {
        await db.query(
          `INSERT INTO artifacts (job_id, kind, uri, meta) VALUES ($1, $2, $3, $4::jsonb)`,
          [
            job.id,
            artifact.kind,
            artifact.uri,
            JSON.stringify({
              ...(artifact.meta ?? {}),
              mimeType: artifact.mimeType,
            }),
          ],
        );
      }
      await publishEvent(redis, job.id, "artifact", { count: result.artifacts.length });
      status = await advance(db, redis, job.id, status, "generation_done");
    }
    if (status === JobStatus.COMPOSING) {
      status = await advance(db, redis, job.id, status, "artifacts_ready");
    }
    if (status === JobStatus.ACCEPTING) {
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
      if (report.result === "PASS") {
        await redis.lpush("q:settle", job.id);
      } else if (report.result === "FAIL") {
        await redis.lpush("q:settle", `refuse:${job.id}`);
      }
    }
  } finally {
    await redis.del(lockKey);
  }
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
  await publishEvent(redis, jobId, "status", { status: next });
  return next;
}

async function publishEvent(
  redis: Redis,
  jobId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const channel = `sse:job:${jobId}`;
  const message = JSON.stringify({ type, payload, ts: new Date().toISOString() });
  await redis.publish(channel, message);
  await redis.lpush(`sse:job:${jobId}:log`, message);
  await redis.ltrim(`sse:job:${jobId}:log`, 0, 499);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
