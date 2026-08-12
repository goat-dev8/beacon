/**
 * Seed SwapDesk with real Coston2 FXRP from the deployer (faucet inventory).
 * Never invents accounting. Never prints private keys.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Contract, JsonRpcProvider, Wallet } from "ethers";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FXRP = "0x0b6A3645c240605887a5532109323A3E12273dc7";
const DESK = "0xD926f5Bce2F89CD279aCa3648807607f6125986F";
const AMOUNT = 5_000_000n; // 5 FXRP (6 decimals)

function loadDotEnv(filePath) {
  return Object.fromEntries(
    fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i), l.slice(i + 1)];
      }),
  );
}

const env = loadDotEnv(path.join(ROOT, ".env"));
let key = env.DEPLOYMENT_PRIVATE_KEY || env.SETTLER_PRIVATE_KEY || "";
if (key && !key.startsWith("0x")) key = `0x${key}`;
if (!key) {
  console.error("missing deployer key");
  process.exit(1);
}

const rpc = env.COSTON2_RPC_URL || "https://coston2-api.flare.network/ext/C/rpc";
const provider = new JsonRpcProvider(rpc);
const wallet = new Wallet(key, provider);
const token = new Contract(FXRP, ["function transfer(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"], wallet);
const before = await token.balanceOf(wallet.address);
if (before < AMOUNT) {
  console.error(`insufficient FXRP: have ${before.toString()} need ${AMOUNT.toString()}`);
  process.exit(1);
}
const tx = await token.transfer(DESK, AMOUNT);
const receipt = await tx.wait();
const deskBal = await token.balanceOf(DESK);
console.log(
  JSON.stringify({
    ok: true,
    from: wallet.address,
    desk: DESK,
    amount: AMOUNT.toString(),
    txHash: receipt?.hash ?? tx.hash,
    deskBalanceAfter: deskBal.toString(),
    explorer: `https://coston2-explorer.flare.network/tx/${receipt?.hash ?? tx.hash}`,
  }),
);
