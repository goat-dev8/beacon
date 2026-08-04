import "dotenv/config";
import pg from "pg";
import { createHash } from "node:crypto";
import { JsonRpcProvider, Contract } from "ethers";

const jobId = process.argv[2] ?? "bd318f92-0dde-4a86-8775-00a9d3bf6402";
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const { rows: reports } = await pool.query(
  `SELECT result, confidence, report_json FROM accept_reports WHERE job_id = $1 ORDER BY id DESC`,
  [jobId],
);
console.log("accept_reports", JSON.stringify(reports, null, 2));

const { rows: arts } = await pool.query(
  `SELECT kind, uri, meta FROM artifacts WHERE job_id = $1`,
  [jobId],
);
console.log("artifacts", JSON.stringify(arts, null, 2));

const { rows: auths } = await pool.query(
  `SELECT a.eip3009_payload, a.status FROM authorizations a
   JOIN offers o ON o.id = a.offer_id WHERE o.job_id = $1`,
  [jobId],
);
console.log("auth", JSON.stringify(auths, null, 2));

const sha = "0x" + createHash("sha256").update(jobId).digest("hex");
const broken = "0x" + jobId.replace(/-/g, "").slice(0, 64).padEnd(64, "0");
console.log("jobHash sha256", sha);
console.log("jobHash broken", broken);

const provider = new JsonRpcProvider(process.env.COSTON2_RPC_URL);
const escrow = new Contract(
  process.env.BEACON_ESCROW!,
  ["function locks(bytes32) view returns (address payer,uint256 amount,bool released,bool refunded)"],
  provider,
);
for (const [label, hash] of [
  ["sha256", sha],
  ["broken", broken],
] as const) {
  try {
    const lock = await escrow.locks(hash);
    console.log(`lock[${label}]`, {
      payer: lock.payer,
      amount: lock.amount?.toString?.() ?? String(lock[1]),
      released: lock.released ?? lock[2],
      refunded: lock.refunded ?? lock[3],
    });
  } catch (e) {
    console.log(`lock[${label}] err`, e instanceof Error ? e.message : e);
  }
}

await pool.end();
