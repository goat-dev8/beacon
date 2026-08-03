import "dotenv/config";
import pg from "pg";
import { Redis } from "@upstash/redis";
import { JsonRpcProvider, Wallet } from "ethers";
import {
  JobStatus,
  transition,
  loadEnv,
  requireEnv,
  newId,
} from "@beacon/shared";
import { FacilitatorClient } from "@beacon/x402";
import { buildReceipt } from "@beacon/receipts";

const POLL_MS = 4000;

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

  console.log("Beacon settler started");

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const item = await redis.rpop<string>("q:settle");
    if (item) {
      if (item.startsWith("refuse:")) {
        await refuseJob(db, redis, item.slice("refuse:".length));
      } else {
        await settleJob(db, redis, item, env);
      }
    }
    await sleep(POLL_MS);
  }
}

async function settleJob(
  db: pg.Pool,
  redis: Redis,
  jobId: string,
  env: ReturnType<typeof loadEnv>,
): Promise<void> {
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

  if (env.X402_FACILITATOR_ADDRESS && env.X402_TOKEN_ADDRESS && env.SETTLER_PRIVATE_KEY) {
    try {
      const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
      const signer = new Wallet(env.SETTLER_PRIVATE_KEY, provider);
      const client = new FacilitatorClient({
        facilitatorAddress: env.X402_FACILITATOR_ADDRESS,
        tokenAddress: env.X402_TOKEN_ADDRESS,
        provider,
      });
      const auth = row.eip3009_payload as {
        payer?: string;
        payee?: string;
        amount?: string;
        validAfter?: string;
        validBefore?: string;
        nonce?: string;
        signature?: string;
      };
      if (auth?.payer && auth?.signature && auth?.nonce) {
        // Prefer escrow release when configured; else facilitator settle.
        if (env.BEACON_ESCROW) {
          const { Contract } = await import("ethers");
          const escrow = new Contract(
            env.BEACON_ESCROW,
            [
              "function releaseToPayee(bytes32 jobId)",
              "function refund(bytes32 jobId)",
            ],
            signer,
          );
          const jobBytes = jobId.replace(/-/g, "").slice(0, 64).padEnd(64, "0");
          const jobHash = `0x${jobBytes}`;
          const tx = await escrow.releaseToPayee(jobHash);
          const receipt = await tx.wait();
          settled = true;
          txHash = receipt?.hash;
        } else {
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
        }
      } else {
        // Work-credit ledger settle (no on-chain auth attached to this approve).
        await db.query(
          `INSERT INTO credits_ledger (user_id, amount_usdt0, reason, ref_type, ref_id)
           SELECT user_id, -$2::numeric, 'job_settle', 'job', $1
           FROM jobs WHERE id = $1`,
          [jobId, row.price_usdt0],
        );
        settled = true;
      }
    } catch (err) {
      console.error("settle error", err);
    }
  } else {
    await db.query(
      `INSERT INTO credits_ledger (user_id, amount_usdt0, reason, ref_type, ref_id)
       SELECT user_id, -$2::numeric, 'job_settle', 'job', $1
       FROM jobs WHERE id = $1`,
      [jobId, row.price_usdt0],
    );
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
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
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

  await redis.publish(`sse:job:${jobId}`, JSON.stringify({ type: "status", payload: { status: closed } }));
}

async function refuseJob(db: pg.Pool, redis: Redis, jobId: string): Promise<void> {
  const { rows } = await db.query(`SELECT status FROM jobs WHERE id = $1`, [jobId]);
  const status = rows[0]?.status ?? JobStatus.FAILED;
  const next = transition(status, "settler_fail");
  const closed = transition(next, "terminal_close");
  await db.query(`UPDATE jobs SET status = $2, updated_at = NOW() WHERE id = $1`, [jobId, closed]);
  await redis.publish(`sse:job:${jobId}`, JSON.stringify({ type: "status", payload: { status: closed } }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
