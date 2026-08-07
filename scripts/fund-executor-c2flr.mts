import { config } from "dotenv";
config({ path: ".env" });
import { loadEnv } from "../packages/shared/src/env.ts";
import { JsonRpcProvider, Wallet, parseEther, formatEther } from "ethers";

const env = loadEnv();
const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
const key = env.DEPLOYER_PRIVATE_KEY || env.SETTLER_PRIVATE_KEY;
if (!key) throw new Error("no key");
const w = new Wallet(key, provider);
const exec = env.SETTLER_ADDRESS || w.address;
const bal = await provider.getBalance(w.address);
const execBal = await provider.getBalance(exec);
console.log("from", w.address, formatEther(bal));
console.log("exec", exec, formatEther(execBal));
// If deployer === executor, we need external fund. Else send 30 C2FLR.
if (w.address.toLowerCase() === exec.toLowerCase()) {
  console.log("SAME_WALLET — need faucet");
  process.exit(2);
}
const need = parseEther("30");
const tx = await w.sendTransaction({ to: exec, value: need });
console.log("sent", tx.hash);
await tx.wait();
console.log("exec_after", formatEther(await provider.getBalance(exec)));
