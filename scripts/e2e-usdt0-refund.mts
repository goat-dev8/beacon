/**
 * Live Coston2 USDT0 escrow refund: lockFrom → refund on official faucet token.
 * Also proves Redis spend-window reverse (record then reverse, net-zero).
 * Does not print private keys.
 */
import { config } from "dotenv";
config({ path: ".env", override: true });

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { Redis } from "@upstash/redis";
import { Contract, JsonRpcProvider, Wallet, formatUnits } from "ethers";
import {
  getDailySpendUsdt0,
  recordSpendUsdt0,
  reverseSpendUsdt0,
} from "../apps/api/src/securityPolicy.ts";

const TOKEN_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
];
const ESCROW_ABI = [
  "function lockFrom(bytes32 jobId, address payer, uint256 amount)",
  "function refund(bytes32 jobId)",
  "function locks(bytes32) view returns (address payer,uint256 amount,bool released,bool refunded)",
  "function token() view returns (address)",
];

function jobIdToBytes32(jobId: string): string {
  return "0x" + createHash("sha256").update(jobId).digest("hex");
}

function requireAddr(name: string, value: string | undefined): string {
  if (!value || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`${name} missing or invalid`);
  }
  return value;
}

const OFFICIAL_USDT0 = "0xC1A5B41512496B80903D1f32d6dEa3a73212E71F";
const AMOUNT = 10_000n; // 0.01 USDT0 (6 decimals)

const rpc = process.env.COSTON2_RPC_URL || "https://coston2-api.flare.network/ext/C/rpc";
const tokenAddr = requireAddr("X402_TOKEN_ADDRESS", process.env.X402_TOKEN_ADDRESS);
const escrowAddr = requireAddr("BEACON_ESCROW", process.env.BEACON_ESCROW);
const pk = process.env.DEPLOYER_PRIVATE_KEY || process.env.DEPLOYMENT_PRIVATE_KEY || process.env.SETTLER_PRIVATE_KEY;
if (!pk) throw new Error("No settler/deployer key");
if (tokenAddr.toLowerCase() !== OFFICIAL_USDT0.toLowerCase()) {
  throw new Error(`Refusing refund on non-official USDT0 ${tokenAddr}`);
}

const provider = new JsonRpcProvider(rpc);
const wallet = new Wallet(pk.startsWith("0x") ? pk : `0x${pk}`, provider);
const token = new Contract(tokenAddr, TOKEN_ABI, wallet);
const escrow = new Contract(escrowAddr, ESCROW_ABI, wallet);

const [name, decimals, escrowToken, beforePayer, beforeEscrow] = await Promise.all([
  token.name() as Promise<string>,
  token.decimals() as Promise<number>,
  escrow.token() as Promise<string>,
  token.balanceOf(wallet.address) as Promise<bigint>,
  token.balanceOf(escrowAddr) as Promise<bigint>,
]);

if (escrowToken.toLowerCase() !== OFFICIAL_USDT0.toLowerCase()) {
  throw new Error(`Escrow token is ${escrowToken}, not official USDT0`);
}

const jobId = `refund-usdt0-${Date.now()}`;
const jobHash = jobIdToBytes32(jobId);

if (beforePayer < AMOUNT) {
  throw new Error(
    `Need 0.01 USDT0 on executor. Claim https://faucet.flare.network/coston2 — have ${formatUnits(beforePayer, decimals)}`,
  );
}

const approveTx = await token.approve(escrowAddr, AMOUNT);
await approveTx.wait();
const lockTx = await escrow.lockFrom(jobHash, wallet.address, AMOUNT);
const lockReceipt = await lockTx.wait();
const midPayer = (await token.balanceOf(wallet.address)) as bigint;
const midEscrow = (await token.balanceOf(escrowAddr)) as bigint;
const lockState = await escrow.locks(jobHash);

const refundTx = await escrow.refund(jobHash);
const refundReceipt = await refundTx.wait();
const afterPayer = (await token.balanceOf(wallet.address)) as bigint;
const afterEscrow = (await token.balanceOf(escrowAddr)) as bigint;
const afterLock = await escrow.locks(jobHash);

const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
let redisProof: Record<string, unknown> = { skipped: true };
if (redisUrl && redisToken) {
  const redis = new Redis({ url: redisUrl, token: redisToken });
  const spendWallet = wallet.address;
  const beforeSpend = await getDailySpendUsdt0(redis, spendWallet);
  try {
    await recordSpendUsdt0(redis, spendWallet, 0.01);
    const afterRecord = await getDailySpendUsdt0(redis, spendWallet);
    const reversedTo = await reverseSpendUsdt0(redis, spendWallet, 0.01);
    const afterReverse = await getDailySpendUsdt0(redis, spendWallet);
    redisProof = {
      skipped: false,
      beforeSpend,
      afterRecord,
      reversedTo,
      afterReverse,
      netZero: Math.abs(afterReverse - beforeSpend) < 1e-9,
      recordIncreased: afterRecord > beforeSpend + 0.009,
    };
  } catch (err) {
    await redis.set(
      `security:spend:${spendWallet.toLowerCase()}:${new Date().toISOString().slice(0, 10)}`,
      beforeSpend,
      { ex: 60 * 60 * 36 },
    );
    redisProof = { skipped: false, error: err instanceof Error ? err.message : String(err), restoredTo: beforeSpend };
  }
}

const evidence = {
  at: new Date().toISOString(),
  path: "executor lockFrom → escrow.refund on official Coston2 faucet USDT0",
  token: tokenAddr,
  tokenName: name,
  decimals: Number(decimals),
  escrow: escrowAddr,
  payer: wallet.address,
  jobId,
  jobHash,
  amountRaw: AMOUNT.toString(),
  amountUsdt0: "0.01",
  balances: {
    payerBefore: formatUnits(beforePayer, decimals),
    payerAfterLock: formatUnits(midPayer, decimals),
    payerAfterRefund: formatUnits(afterPayer, decimals),
    escrowBefore: formatUnits(beforeEscrow, decimals),
    escrowAfterLock: formatUnits(midEscrow, decimals),
    escrowAfterRefund: formatUnits(afterEscrow, decimals),
  },
  lock: {
    tx: lockReceipt?.hash ?? lockTx.hash,
    explorer: `https://coston2-explorer.flare.network/tx/${lockReceipt?.hash ?? lockTx.hash}`,
    payer: lockState[0],
    amount: lockState[1].toString(),
  },
  refund: {
    tx: refundReceipt?.hash ?? refundTx.hash,
    explorer: `https://coston2-explorer.flare.network/tx/${refundReceipt?.hash ?? refundTx.hash}`,
    released: afterLock[2] === true || afterLock[2] === 1n,
    refunded: afterLock[3] === true || afterLock[3] === 1n,
  },
  redisSpendWindow: redisProof,
  note: "Real USDT0 left the payer into BeaconEscrow then returned on refund. Not MockUSDT0. Jobs UI FAIL/NEEDS_LOOK reject uses this same escrow.refund + reverseSpendUsdt0 path.",
};

const json = JSON.stringify(
  evidence,
  (_k, v) => (typeof v === "bigint" ? v.toString() : v),
  2,
);
writeFileSync("docs/evidence/usdt0-refund.json", json);
console.log(json);
if (!(afterLock[3] === true || afterLock[3] === 1n)) process.exit(2);
if (redisProof.skipped !== true && redisProof.netZero !== true && !redisProof.error) process.exit(3);
