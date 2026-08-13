/**
 * Fresh x402: GET 402 → approve facilitator → POST erc20-pull → settlement tx.
 * Payer is the deployer EOA (has Coston2 USDT0). Payee is X402_PAYEE_ADDRESS.
 */
import { config } from "dotenv";
config({ path: ".env", override: true });
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Contract, JsonRpcProvider, Wallet, formatUnits, parseUnits } from "ethers";
import { resetEnvCache, loadEnv } from "@beacon/shared";

const API = "https://beacon-api-97gl.onrender.com";
const RESOURCE = "/v1/agents/resources/signals-deep";
const USDT0 = "0xC1A5B41512496B80903D1f32d6dEa3a73212E71F";
const OUT = join(process.cwd(), "docs", "evidence");

resetEnvCache();
const env = loadEnv();
const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
const key = (env.DEPLOYER_PRIVATE_KEY || env.SETTLER_PRIVATE_KEY || "").replace(/^0x/, "");
if (!key) throw new Error("no settler key");
const wallet = new Wallet(`0x${key}`, provider);
const token = new Contract(
  USDT0,
  [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
    "function name() view returns (string)",
  ],
  wallet,
);

const unpaid = await fetch(`${API}${RESOURCE}`);
const unpaidJson = await unpaid.json();
const accepts = unpaidJson.accepts?.[0];
console.log("unpaid", unpaid.status, accepts?.asset, accepts?.maxAmountRequired, accepts?.payTo);

const amount = BigInt(accepts.maxAmountRequired);
const payTo = String(accepts.payTo);
const facilitator = String(accepts.extra.tokenAddress ? env.X402_FACILITATOR_ADDRESS : env.X402_FACILITATOR_ADDRESS);
const before = await token.balanceOf(wallet.address);
const payeeBefore = await token.balanceOf(payTo);
console.log("payer", wallet.address, "usdt0", formatUnits(before, 6));

const allowance = await token.allowance(wallet.address, facilitator);
if (allowance < amount) {
  const tx = await token.approve(facilitator, amount);
  const rec = await tx.wait();
  console.log("approve", rec?.hash);
}

const now = Math.floor(Date.now() / 1000);
const nonce = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}`;
const payment = {
  mode: "erc20-pull",
  from: wallet.address,
  to: payTo,
  token: USDT0,
  value: amount.toString(),
  validAfter: String(now - 60),
  validBefore: String(now + 600),
  nonce,
  chainId: 114,
  network: "flare-coston2",
};

const paid = await fetch(`${API}${RESOURCE}`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ brief: "closure x402 signals-deep", payment }),
});
const paidJson = await paid.json();
const after = await token.balanceOf(wallet.address);
const payeeAfter = await token.balanceOf(payTo);
const evidence = {
  at: new Date().toISOString(),
  resource: RESOURCE,
  unpaidStatus: unpaid.status,
  unpaidAsset: accepts?.asset,
  extraToken: accepts?.extra?.tokenAddress,
  priceUsdt0: formatUnits(amount, 6),
  token: USDT0,
  tokenName: await token.name(),
  chainId: 114,
  settleMode: "erc20-transferFrom",
  payer: wallet.address,
  payee: payTo,
  facilitator,
  payerUsdt0Before: formatUnits(before, 6),
  payerUsdt0After: formatUnits(after, 6),
  payeeUsdt0Before: formatUnits(payeeBefore, 6),
  payeeUsdt0After: formatUnits(payeeAfter, 6),
  http: paid.status,
  settlementTxHash: paidJson.settlementTxHash ?? null,
  explorer: paidJson.settlementTxHash
    ? `https://coston2-explorer.flare.network/tx/${paidJson.settlementTxHash}`
    : null,
  resourceOk: paidJson.ok === true,
  agentId: paidJson.agentId ?? null,
  error: paidJson.error ?? null,
};
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "closure-x402-fresh.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
if (!evidence.settlementTxHash || paid.status >= 400) process.exit(2);
