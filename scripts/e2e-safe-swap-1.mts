import { config } from "dotenv";
config({ path: ".env" });
import { loadEnv } from "../packages/shared/src/env.ts";
import { executeBeaconSafeSwap } from "../packages/shared/src/safeSwap.ts";

const env = loadEnv();
const recipient = "0x3be57a5b65265d3704f846b93600308154fec794";
const r = await executeBeaconSafeSwap({ amountInUnits: "1", recipient }, env);
console.log(JSON.stringify(r, null, 2));
process.exit(r.ok ? 0 : 1);
