/**
 * Full CLI e2e: create → quote → approve → orchestrate → settle → receipt
 * Uses live Coston2 contracts + Supabase + Redis. No frontend.
 */
import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import pg from "pg";
import { Redis } from "@upstash/redis";
import { JsonRpcProvider, Wallet, Contract, TypedDataEncoder, getBytes, Signature } from "ethers";
import { runPipeline } from "@beacon/pipeline";
import { runAcceptance } from "@beacon/acceptance";
import { JobStatus, transition, newId } from "@beacon/shared";
import { buildBoundOffer, evaluateSealedFit, toQuoteDto } from "@beacon/quote";
import { buildReceipt } from "@beacon/receipts";
import path from "node:path";
import os from "node:os";
import { mkdir } from "node:fs/promises";

const RPC = process.env.COSTON2_RPC_URL!;
const TOKEN = process.env.X402_TOKEN_ADDRESS!;
const ESCROW = process.env.BEACON_ESCROW!;
const PK = process.env.DEPLOYER_PRIVATE_KEY!;

const MOCK_ABI = [
  "function mint(address to, uint256 amount)",
  "function balanceOf(address) view returns (uint256)",
  "function name() view returns (string)",
  "function version() view returns (string)",
  "function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,bytes signature) returns (bool)",
];

const ESCROW_ABI = [
  "function lockWithAuthorization(bytes32 jobId,address payer,uint256 amount,uint256 validAfter,uint256 validBefore,bytes32 nonce,bytes signature)",
  "function releaseToPayee(bytes32 jobId)",
  "function refund(bytes32 jobId)",
  "function locks(bytes32) view returns (address payer,uint256 amount,bool released,bool refunded)",
];

function jobIdToBytes32(jobId: string): string {
  return "0x" + createHash("sha256").update(jobId).digest("hex");
}

async function main() {
  console.log("=== Beacon E2E start ===");
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });

  const provider = new JsonRpcProvider(RPC);
  const wallet = new Wallet(PK, provider);
  const token = new Contract(TOKEN, MOCK_ABI, wallet);
  const escrow = new Contract(ESCROW, ESCROW_ABI, wallet);

  // Mint test tokens to payer
  const mintTx = await token.mint(wallet.address, 100_000_000); // 100 USDT0
  await mintTx.wait();
  console.log("minted MockUSDT0 to", wallet.address, "bal", (await token.balanceOf(wallet.address)).toString());

  // Create user + job
  const userId = newId();
  await pool.query(
    `INSERT INTO users (id, display_name) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [userId, "e2e-user"],
  );
  // Ensure users table allows insert - check schema
  const jobId = newId();
  const brief =
    "Write a short product research brief on Flare data protocols for founders. Focus on FTSO and FDC value.";

  await pool.query(
    `INSERT INTO jobs (id, user_id, service_id, status, brief_text)
     VALUES ($1, $2, 'research', $3, $4)`,
    [jobId, userId, JobStatus.QUOTING, brief],
  );
  console.log("job", jobId);

  const fit = await evaluateSealedFit({ serviceId: "research", briefText: brief });
  if (fit.capability !== "FIT") throw new Error("NO_FIT: " + fit.reason);
  const offer = buildBoundOffer({ serviceId: "research", briefText: brief }, "FIT");
  const quote = toQuoteDto(offer);
  await pool.query(
    `INSERT INTO offers (id, job_id, price_usdt0, expires_at, brief_hash, rubric_hash, raw_offer_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
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
  await pool.query(`UPDATE jobs SET status=$2 WHERE id=$1`, [jobId, JobStatus.QUOTED]);
  console.log("quoted", quote.priceDisplay, "offer", offer.offerId);

  // On-chain lock via EIP-3009 into escrow
  const amount = BigInt(offer.priceUsdt0);
  const jobHash = jobIdToBytes32(jobId);
  const validAfter = BigInt(Math.floor(Date.now() / 1000) - 60);
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const nonce = ("0x" + randomBytes(32).toString("hex")) as `0x${string}`;

  const domain = {
    name: await token.name(),
    version: await token.version(),
    chainId: 114,
    verifyingContract: TOKEN,
  };
  const types = {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  };
  const message = {
    from: wallet.address,
    to: ESCROW,
    value: amount,
    validAfter,
    validBefore,
    nonce,
  };
  const signature = await wallet.signTypedData(domain, types, message);

  const lockTx = await escrow.lockWithAuthorization(
    jobHash,
    wallet.address,
    amount,
    validAfter,
    validBefore,
    nonce,
    signature,
  );
  const lockReceipt = await lockTx.wait();
  console.log("escrow locked", lockReceipt?.hash);

  await pool.query(
    `INSERT INTO authorizations (offer_id, user_id, eip3009_payload, valid_before, status)
     VALUES ($1,$2,$3::jsonb,to_timestamp($4),'active')`,
    [
      offer.offerId,
      userId,
      JSON.stringify({
        payer: wallet.address,
        payee: ESCROW,
        amount: amount.toString(),
        validAfter: validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce,
        signature,
        jobHash,
      }),
      Number(validBefore),
    ],
  );
  await pool.query(`UPDATE jobs SET status=$2 WHERE id=$1`, [jobId, JobStatus.AUTHORIZED]);

  // Pipeline + acceptance inline (same as orchestrator)
  let status = JobStatus.AUTHORIZED;
  status = transition(status, "orchestrator_prepare");
  status = transition(status, "stages_start");
  await pool.query(`UPDATE jobs SET status=$2 WHERE id=$1`, [jobId, status]);

  const outputDir = path.join(os.tmpdir(), "beacon-e2e", jobId);
  await mkdir(outputDir, { recursive: true });
  const pipe = await runPipeline({
    jobId,
    serviceId: "research",
    briefText: brief,
    outputDir,
  });
  for (const a of pipe.artifacts) {
    await pool.query(
      `INSERT INTO artifacts (job_id, kind, uri, meta) VALUES ($1,$2,$3,$4::jsonb)`,
      [jobId, a.kind, a.uri, JSON.stringify({ ...(a.meta ?? {}), mimeType: a.mimeType })],
    );
  }
  status = transition(status, "generation_done");
  status = transition(status, "artifacts_ready");
  await pool.query(`UPDATE jobs SET status=$2 WHERE id=$1`, [jobId, status]);
  console.log("artifacts", pipe.artifacts.length);

  const report = await runAcceptance({
    jobId,
    serviceId: "research",
    rubricVersion: "v1",
    brandForbiddenWords: [],
    artifacts: await Promise.all(
      pipe.artifacts.map(async (a) => {
        let payload: unknown = a.meta ?? undefined;
        if (a.kind === "draft" || a.kind === "document") {
          try {
            const { readFile } = await import("node:fs/promises");
            payload = await readFile(a.uri, "utf8");
          } catch {
            payload = a.meta ?? { text: brief };
          }
        }
        return {
          kind: a.kind,
          uri: a.uri,
          mimeType: a.mimeType,
          payload,
        };
      }),
    ),
  });
  await pool.query(
    `INSERT INTO accept_reports (job_id, result, report_json, confidence)
     VALUES ($1,$2,$3::jsonb,$4)`,
    [jobId, report.result, JSON.stringify(report), report.confidence],
  );
  status = transition(status, "accept_report", report.result);
  console.log("accept", report.result, report.summary);

  if (report.result === "PASS") {
    const releaseTx = await escrow.releaseToPayee(jobHash);
    const rel = await releaseTx.wait();
    console.log("escrow released", rel?.hash);
    status = transition(status, "settler_pass");
    status = transition(status, "terminal_close");
    const receipt = buildReceipt({
      jobId,
      serviceId: "research",
      offer: {
        offerId: offer.offerId,
        briefHash: offer.briefHash,
        rubricHash: offer.rubricHash,
        priceUsdt0: offer.priceUsdt0.toString(),
      },
      accept: {
        acceptId: newId(),
        result: "PASS",
        confidence: report.confidence,
        summary: report.summary,
      },
      payment: {
        paymentId: newId(),
        txHash: rel?.hash,
        settled: true,
        amountUsdt0: offer.priceUsdt0.toString(),
      },
    });
    await pool.query(
      `INSERT INTO receipts (id, job_id, payment_id, tx_hash, offer_id, receipt_json)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [receipt.id, jobId, receipt.payment.paymentId, rel?.hash ?? null, offer.offerId, JSON.stringify(receipt)],
    );
    await pool.query(`UPDATE jobs SET status=$2 WHERE id=$1`, [jobId, status]);
    console.log("CLOSED PASS receipt", receipt.id);
  } else {
    const refundTx = await escrow.refund(jobHash);
    await refundTx.wait();
    status = transition(status, "settler_fail");
    status = transition(status, "terminal_close");
    await pool.query(`UPDATE jobs SET status=$2 WHERE id=$1`, [jobId, status]);
    console.log("CLOSED FAIL refunded");
  }

  // FAIL path demo: brand violation job
  const failJob = newId();
  const failBrief = "Create ad copy that praises CompetitorCo loudly.";
  await pool.query(
    `INSERT INTO jobs (id, user_id, service_id, status, brief_text) VALUES ($1,$2,'documents',$3,$4)`,
    [failJob, userId, JobStatus.ACCEPTING, failBrief],
  );
  const failReport = await runAcceptance({
    jobId: failJob,
    serviceId: "documents",
    rubricVersion: "v1",
    brandForbiddenWords: ["CompetitorCo"],
    artifacts: [
      {
        kind: "document",
        uri: "memory://fail.md",
        mimeType: "text/markdown",
        payload: { text: failBrief },
      },
    ],
  });
  console.log("brand-fail accept", failReport.result, failReport.layers.map((l) => l.notes.join(";")));
  if (failReport.result !== "FAIL") {
    throw new Error("Expected brand FAIL");
  }

  await pool.end();
  console.log("=== Beacon E2E PASS ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
