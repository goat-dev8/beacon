/**
 * Production Jobs: Safe USDT0 lock → generation_failed → refund + Redis reverse,
 * then one successful coding job. Requires production workers with
 * BEACON_E2E_GENERATION_FAIL token deployed.
 */
import { config } from "dotenv";
config({ path: ".env", override: true });

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Redis } from "@upstash/redis";
import { Contract, JsonRpcProvider, formatUnits } from "ethers";
import { loadEnv, resetEnvCache, jobIdToBytes32 } from "@beacon/shared";
import { executeSafeJobLock } from "../packages/shared/src/safeJobLock.ts";
import { reverseSpendUsdt0, spendKey } from "../apps/api/src/securityPolicy.ts";

const API = "https://beacon-api-97gl.onrender.com";
const WALLET = "0x3bE57A5b65265D3704f846B93600308154fec794";
const SAFE = "0x96875f3F4346e2183A3ee0d156cAe6871551A0A6";
const USDT0 = "0xC1A5B41512496B80903D1f32d6dEa3a73212E71F";
const ESCROW = "0x59F9E2471BE3747b00fD53E0Cea828227345399C";
const OUT = join(process.cwd(), "docs", "evidence");

function save(name: string, data: unknown) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), JSON.stringify(data, null, 2));
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new Error(`${res.status} ${path}: ${json.error?.message ?? JSON.stringify(json).slice(0, 400)}`);
  }
  return json;
}

async function waitJob(jobId: string, timeoutMs = 180_000) {
  const start = Date.now();
  let last: Record<string, unknown> = {};
  while (Date.now() - start < timeoutMs) {
    last = (await api(`/v1/jobs/${jobId}`)) as Record<string, unknown>;
    const job = (last.job ?? last) as { status?: string };
    const status = String(job.status ?? "");
    console.log("job", jobId, status);
    if (["CLOSED", "EXPIRED"].includes(status)) return last;
    await new Promise((r) => setTimeout(r, 4000));
  }
  return last;
}

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

  const leftover = Number(process.env.REVERSE_USDT0 ?? "0") || 0;
  if (leftover > 0) {
    const reversed = await reverseSpendUsdt0(redis, WALLET, leftover);
    console.log("reversed leftover Redis spend", leftover, "now", reversed);
  }

  const spendBefore = Number((await redis.get<number | string>(spendKey(WALLET))) ?? 0) || 0;
  const safeBefore = formatUnits(await token.balanceOf(SAFE), 6);
  const failOnly = process.env.FAIL_ONLY === "1";
  const skipFail = process.env.SKIP_FAIL === "1";

  if (!skipFail) {
  const failCreate = await api<{ jobId: string }>("/v1/jobs", {
    method: "POST",
    body: JSON.stringify({
      serviceId: "coding",
      briefText:
        "BEACON_E2E_GENERATION_FAIL Write a tiny TypeScript function add(a: number, b: number). Controlled refund probe — do not generate.",
    }),
  });
  const failQuote = await api<{ jobId: string; offerId: string; quote: { priceDisplay?: string } }>(
    `/v1/jobs/${failCreate.jobId}/quote`,
    { method: "POST", body: "{}" },
  );
  console.log("fail quoted", failCreate.jobId, failQuote.quote?.priceDisplay);

  const lock = await executeSafeJobLock(
    {
      jobId: failCreate.jobId,
      amountUsdt0Display: String(failQuote.quote?.priceDisplay ?? "0.01").replace(/^\$/, ""),
      ownerWallet: WALLET,
    },
    env,
  );
  if (!lock.ok) throw new Error(`Safe lock failed: ${lock.error}`);
  console.log("safe lock", lock.lockTxHash, lock.spendTxHash);

  const approve = await api<Record<string, unknown>>(`/v1/jobs/${failCreate.jobId}/approve`, {
    method: "POST",
    body: JSON.stringify({
      offerId: failQuote.offerId,
      ownerWallet: WALLET,
      lockTxHash: lock.lockTxHash,
      spendTxHash: lock.spendTxHash,
      authorization: {
        mode: "beacon_safe",
        payer: lock.vault,
        ownerWallet: WALLET,
        amount: lock.amount,
        lockTxHash: lock.lockTxHash,
        spendTxHash: lock.spendTxHash,
      },
    }),
  });
  console.log("approved", approve);

  const failFinal = await waitJob(failCreate.jobId, 120_000);
  const failHash = jobIdToBytes32(failCreate.jobId);
  const failLock = await escrow.locks(failHash);
  const spendAfterFail = Number((await redis.get<number | string>(spendKey(WALLET))) ?? 0) || 0;
  const safeAfterFail = formatUnits(await token.balanceOf(SAFE), 6);
  const receipt = await api<Record<string, unknown>>(`/v1/jobs/${failCreate.jobId}/receipt`).catch((e) => ({
    error: String(e),
  }));

  const failEvidence = {
    at: new Date().toISOString(),
    jobId: failCreate.jobId,
    desk: `https://beacon-desk.vercel.app/flow/desk?job=${failCreate.jobId}`,
    service: "coding",
    briefToken: "BEACON_E2E_GENERATION_FAIL",
    quote: failQuote.quote,
    safe: SAFE,
    ownerWallet: WALLET,
    spendTx: lock.spendTxHash,
    lockTx: lock.lockTxHash,
    explorerSpend: lock.explorerSpend,
    explorerLock: lock.explorerLock,
    job: failFinal,
    onChainLock: {
      payer: failLock.payer ?? failLock[0],
      amount: String(failLock.amount ?? failLock[1]),
      released: failLock.released ?? failLock[2],
      refunded: failLock.refunded ?? failLock[3],
    },
    redisSpend: { before: spendBefore, afterFail: spendAfterFail, netZeroVsBefore: spendAfterFail <= spendBefore + 1e-9 },
    safeUsdt0: { before: safeBefore, afterFail: safeAfterFail },
    receipt,
  };
  save("closeout-jobs-fail.json", failEvidence);
  console.log("FAIL evidence", JSON.stringify(failEvidence, null, 2));
  if (failOnly) return;
  }

  const okCreate = await api<{ jobId: string }>("/v1/jobs", {
    method: "POST",
    body: JSON.stringify({
      serviceId: "coding",
      briefText:
        "Write a tiny TypeScript function add(a: number, b: number): number that returns a+b, with a one-line comment. No extra files.",
    }),
  });
  const okQuote = await api<{ jobId: string; offerId: string; quote: { priceDisplay?: string } }>(
    `/v1/jobs/${okCreate.jobId}/quote`,
    { method: "POST", body: "{}" },
  );
  const okLock = await executeSafeJobLock(
    {
      jobId: okCreate.jobId,
      amountUsdt0Display: String(okQuote.quote?.priceDisplay ?? "0.01").replace(/^\$/, ""),
      ownerWallet: WALLET,
    },
    env,
  );
  if (!okLock.ok) throw new Error(`success Safe lock failed: ${okLock.error}`);
  await api(`/v1/jobs/${okCreate.jobId}/approve`, {
    method: "POST",
    body: JSON.stringify({
      offerId: okQuote.offerId,
      ownerWallet: WALLET,
      lockTxHash: okLock.lockTxHash,
      spendTxHash: okLock.spendTxHash,
      authorization: {
        mode: "beacon_safe",
        payer: okLock.vault,
        ownerWallet: WALLET,
        amount: okLock.amount,
        lockTxHash: okLock.lockTxHash,
        spendTxHash: okLock.spendTxHash,
      },
    }),
  });
  const okFinal = await waitJob(okCreate.jobId, 300_000);
  const okHash = jobIdToBytes32(okCreate.jobId);
  const okOnchain = await escrow.locks(okHash);
  const spendAfterOk = Number((await redis.get<number | string>(spendKey(WALLET))) ?? 0) || 0;
  const okReceipt = await api<Record<string, unknown>>(`/v1/jobs/${okCreate.jobId}/receipt`).catch((e) => ({
    error: String(e),
  }));
  const successEvidence = {
    at: new Date().toISOString(),
    jobId: okCreate.jobId,
    desk: `https://beacon-desk.vercel.app/flow/desk?job=${okCreate.jobId}`,
    quote: okQuote.quote,
    spendTx: okLock.spendTxHash,
    lockTx: okLock.lockTxHash,
    explorerSpend: okLock.explorerSpend,
    explorerLock: okLock.explorerLock,
    job: okFinal,
    onChainLock: {
      payer: okOnchain.payer ?? okOnchain[0],
      amount: String(okOnchain.amount ?? okOnchain[1]),
      released: okOnchain.released ?? okOnchain[2],
      refunded: okOnchain.refunded ?? okOnchain[3],
    },
    redisSpendAfter: spendAfterOk,
    receipt: okReceipt,
  };
  save("closeout-jobs-success.json", successEvidence);
  console.log("SUCCESS evidence", JSON.stringify(successEvidence, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
