import { config } from "dotenv";
config({ path: ".env" });
import { runBeaconAgentChat } from "../packages/shared/src/flareAgents.ts";

const wallet = "0x3be57a5b65265d3704f846b93600308154fec794";
const cases: Array<[string, string]> = [
  ["swap", "swap 0.5 USDT0 to FXRP"],
  ["bridge", "bridge 1 FXRP to Sepolia"],
  ["pay", "pay with x402"],
  ["fassets", "Redeem FAssets"],
  ["portfolio", "Analyze my Portfolio"],
  ["signals", "Show FTSO signals for FXRP"],
  ["yield", "Find best yield"],
  ["research", "Research SparkDEX briefly"],
  ["risk", "Explain risk"],
  ["general", "Help me with Beacon Safe policy"],
];

let failed = 0;
for (const [id, message] of cases) {
  try {
    const r = await runBeaconAgentChat({ message, wallet, agentId: id as never });
    const types = (r.cards || [])
      .map((c: { type: string; mode?: string }) => c.type + (c.mode ? `:${c.mode}` : ""))
      .join(",");
    const swapBad =
      id === "swap" && /Switch to Flare Mainnet|Switch \+ Approve/i.test(r.text || "");
    const bridgeOk =
      id !== "bridge" || /beacon_agent|Agent|no MetaMask/i.test(JSON.stringify(r.cards) + r.text);
    if (swapBad || (id === "bridge" && !bridgeOk && !types.includes("beacon_agent"))) {
      failed++;
      console.log("BAD", id, types, (r.text || "").slice(0, 120));
    } else {
      console.log("OK", id, types || "(no cards)", (r.text || "").slice(0, 80).replace(/\n/g, " "));
    }
  } catch (e) {
    failed++;
    console.log("FAIL", id, e instanceof Error ? e.message : e);
  }
}
console.log(failed === 0 ? "MATRIX_GREEN" : `MATRIX_FAILS=${failed}`);
process.exit(failed === 0 ? 0 : 1);
