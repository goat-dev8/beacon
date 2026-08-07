import { config } from "dotenv";
config({ path: ".env" });
import { runBeaconAgentChat } from "../packages/shared/src/flareAgents.ts";

const wallet = "0x3be57a5b65265d3704f846b93600308154fec794";
const r = await runBeaconAgentChat({
  message: "swap 1 USDT0 to FXRP from Beacon Safe",
  wallet,
});
console.log("text", (r.text || "").slice(0, 220).replace(/\n/g, " "));
console.log(
  "cards",
  (r.cards || []).map((c) => c.type + (c.mode ? `:${c.mode}` : "")),
);
console.log("model", r.displayModel);
