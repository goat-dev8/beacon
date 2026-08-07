import { config } from "dotenv";
config({ path: ".env" });
import {
  prepareBeaconAgentBridge,
  executeBeaconAgentBridge,
  agentBridgeReadiness,
} from "../packages/shared/src/agentBridge.ts";

const recipient = "0x3be57a5b65265d3704f846b93600308154fec794";
const amount = process.argv[2] || "1";
const destination = process.argv[3] || "Sepolia";

console.log("readiness", await agentBridgeReadiness());
const q = await prepareBeaconAgentBridge({
  amountFxrpUnits: amount,
  recipient,
  destination,
});
console.log("quote", JSON.stringify(q, null, 2));
if (!q.ok) process.exit(1);

const r = await executeBeaconAgentBridge({
  amountFxrpUnits: amount,
  recipient,
  destination,
});
console.log("result", JSON.stringify(r, null, 2));
if (!r.ok) process.exit(1);
