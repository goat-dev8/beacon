/**
 * Print FXRP / C2FLR balances for configured EOAs. Never prints private keys.
 */
import "dotenv/config";
import { Contract, JsonRpcProvider, Wallet, formatUnits } from "ethers";

async function main() {
  const rpc = process.env.COSTON2_RPC_URL;
  if (!rpc) throw new Error("COSTON2_RPC_URL missing");
  const p = new JsonRpcProvider(rpc);
  const fxrp = "0x0b6A3645c240605887a5532109323A3E12273dc7";
  const token = new Contract(
    fxrp,
    [
      "function balanceOf(address) view returns (uint256)",
      "function decimals() view returns (uint8)",
    ],
    p,
  );
  const dec = Number(await token.decimals());
  const candidates: Array<[string, string | undefined]> = [
    ["DEPLOYER", process.env.DEPLOYER_PRIVATE_KEY],
    ["SETTLER", process.env.SETTLER_PRIVATE_KEY],
    [
      "SAFE_EXECUTOR",
      process.env.SAFE_EXECUTOR_PRIVATE_KEY || process.env.BEACON_SAFE_EXECUTOR_PRIVATE_KEY,
    ],
    [
      "AGENT",
      process.env.BEACON_AGENT_PRIVATE_KEY || process.env.AGENT_PRIVATE_KEY,
    ],
  ];
  for (const [name, key] of candidates) {
    if (!key) {
      console.log(JSON.stringify({ name, configured: false }));
      continue;
    }
    const w = new Wallet(key);
    const bal = await token.balanceOf(w.address);
    const c2 = await p.getBalance(w.address);
    console.log(
      JSON.stringify({
        name,
        address: w.address,
        fxrp: formatUnits(bal, dec),
        c2flr: formatUnits(c2, 18),
      }),
    );
  }
  console.log(JSON.stringify({ minRedeemUBA: "5000000", lotUBA: "10000000" }));
}

main().catch((e) => {
  console.error(String(e).slice(0, 200));
  process.exit(1);
});
