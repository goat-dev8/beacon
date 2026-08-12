import { config } from "dotenv";
config({ path: ".env", override: true });

import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Redis } from "@upstash/redis";
import { Contract, JsonRpcProvider, formatUnits } from "ethers";
import { loadEnv, resetEnvCache, jobIdToBytes32 } from "@beacon/shared";
import { spendKey } from "../apps/api/src/securityPolicy.ts";

const API = "https://beacon-api-97gl.onrender.com";
const JOB = "b0c09470-bee8-4318-8054-7bf3ec8aed4e";
const WALLET = "0x3bE57A5b65265D3704f846B93600308154fec794";
const SAFE = "0x96875f3F4346e2183A3ee0d156cAe6871551A0A6";
const USDT0 = "0xC1A5B41512496B80903D1f32d6dEa3a73212E71F";
const ESCROW = "0x59F9E2471BE3747b00fD53E0Cea828227345399C";
const OUT = join(process.cwd(), "docs", "evidence");

async function main() {
  resetEnvCache();
  const env = loadEnv();
  const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
  const token = new Contract(USDT0, ["function balanceOf(address) view returns (uint256)"], provider);
  const escrow = new Contract(
    ESCROW,
    ["function locks(bytes32) view returns (address payer,uint256 amount,bool released,bool refunded)"],
    provider,
  );
  const redis = new Redis({
    url: env.UPSTASH_REDIS_REST_URL!,
    token: env.UPSTASH_REDIS_REST_TOKEN!,
  });

  let last: Record<string, unknown> = {};
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${API}/v1/jobs/${JOB}`);
    last = (await res.json()) as Record<string, unknown>;
    const job = (last.job ?? last) as { status?: string };
    console.log("poll", i, job.status);
    if (job.status === "CLOSED" || job.status === "EXPIRED") break;
    await new Promise((r) => setTimeout(r, 4000));
  }

  const hash = jobIdToBytes32(JOB);
  const lock = await escrow.locks(hash);
  const spend = Number((await redis.get<number | string>(spendKey(WALLET))) ?? 0) || 0;
  const safeBal = formatUnits(await token.balanceOf(SAFE), 6);
  const recRes = await fetch(`${API}/v1/jobs/${JOB}/receipt`);
  const receipt = await recRes.json();
  const before = 0.32443199999999994;
  const out = {
    at: new Date().toISOString(),
    jobId: JOB,
    desk: `https://beacon-desk.vercel.app/flow/desk?job=${JOB}`,
    status: (last.job as { status?: string } | undefined)?.status,
    paymentRail: last.paymentRail,
    recentEvents: last.recentEvents,
    onChainLock: {
      payer: lock.payer ?? lock[0],
      amount: String(lock.amount ?? lock[1]),
      released: lock.released ?? lock[2],
      refunded: lock.refunded ?? lock[3],
    },
    redisSpend: {
      beforeThisJob: before,
      afterClosed: spend,
      netZeroVsBefore: spend <= before + 1e-9,
    },
    safeUsdt0: {
      beforeThisJob: "9.953033",
      afterClosed: safeBal,
      netZeroOnChain: safeBal === "9.953033",
    },
    receipt,
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "closeout-jobs-fail-retest.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));

  const prior = JSON.parse(readFileSync(join(OUT, "closeout-jobs-fail.json"), "utf8")) as Record<string, unknown>;
  prior.retestAfterClosed = out;
  writeFileSync(join(OUT, "closeout-jobs-fail.json"), JSON.stringify(prior, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
