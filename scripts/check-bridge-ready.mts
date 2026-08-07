import { config } from "dotenv";
config({ path: ".env" });
import { loadEnv } from "../packages/shared/src/env.ts";
import { agentBridgeReadiness, prepareBeaconAgentBridge } from "../packages/shared/src/agentBridge.ts";
const env = loadEnv();
console.log("ready", JSON.stringify(await agentBridgeReadiness(env), null, 2));
const q = await prepareBeaconAgentBridge({ amountFxrpUnits: "1", recipient: "0x3be57a5b65265d3704f846b93600308154fec794", destination: "Sepolia" }, env);
console.log("prep_ok", (q as any).ok, (q as any).error || "mode ok");
