import { config } from "dotenv";
config({ path: ".env" });
import { loadEnv } from "../packages/shared/src/env.ts";
import { executeBeaconAgentBridge } from "../packages/shared/src/agentBridge.ts";

const env = loadEnv();
const r = await executeBeaconAgentBridge(
  {
    amountFxrpUnits: "0.5",
    recipient: "0x3be57a5b65265d3704f846b93600308154fec794",
    destination: "Sepolia",
  },
  env,
);
console.log(JSON.stringify(r, null, 2).slice(0, 1000));
process.exit(r.ok ? 0 : 1);
