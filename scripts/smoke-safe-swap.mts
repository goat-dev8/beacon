import { config } from "dotenv";
config({ path: ".env" });
import { prepareBeaconSafeSwap, executeBeaconSafeSwap } from "../packages/shared/src/safeSwap.ts";

const recipient = process.argv[2] || "0x3be57a5b65265d3704f846b93600308154fec794";
const amount = process.argv[3] || "0.5";
console.log("quoting...", { recipient, amount });
const prep = await prepareBeaconSafeSwap({ amountInUnits: amount, recipient });
console.log(JSON.stringify(prep, null, 2));
if (!prep.ok) process.exit(1);
console.log("executing...");
const res = await executeBeaconSafeSwap({ amountInUnits: amount, recipient });
console.log(JSON.stringify(res, null, 2));
if (!res.ok) process.exit(1);
