/**
 * Direct hardware EVALUATE: over-cap must sign status 0, under-cap status 1.
 * Does not print secrets.
 */
import { config } from "dotenv";
config({ path: ".env", override: true });
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resetEnvCache, loadEnv } from "@beacon/shared";
import { FccExtensionClient, fccConfigFromEnv } from "@beacon/fdc";

const OUT = join(process.cwd(), "docs", "evidence");
const NEW_TEE = "0x2ebCFD562A24BDf0ea7b47F351f97d2140376506";
const NEW_HASH = "0xb11215743d8b701bd757442cce17ec0c3a12d98e2d5ca083f6a92aa5fd9333be";

function save(name: string, data: unknown) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), JSON.stringify(data, null, 2));
  console.log("wrote", name);
}

resetEnvCache();
const client = new FccExtensionClient(fccConfigFromEnv(loadEnv()));
const originalPoll = client.pollActionResult.bind(client);
client.pollActionResult = (id: string) => originalPoll(id, 90, 5000);

console.log("DENY over-cap 100 vs 10…");
const deny = await client.sendEvaluateFit({
  brief: "Beacon policy evaluate — amount cap",
  serviceId: "desk",
  amountUsdt0: 100,
  amountCapUsdt0: 10,
  wallet: "0x3bE57A5b65265D3704f846B93600308154fec794",
});
const denyEv = {
  at: new Date().toISOString(),
  kind: "hardware-signed-deny-overcap",
  teeId: NEW_TEE,
  codeHash: NEW_HASH,
  extensionId: 65925,
  instructionId: deny.instructionId,
  txHash: deny.txHash,
  explorer: `https://coston2-explorer.flare.network/tx/${deny.txHash}`,
  teeSignedStatus: deny.status,
  log: deny.log ?? null,
  data: deny.data,
  pass: deny.status === 0,
};
save("closure-fcc-hardware-deny.json", denyEv);
console.log(JSON.stringify(denyEv, null, 2));
if (deny.status !== 0) {
  console.error("DENY did not sign status 0");
  process.exit(2);
}

console.log("ALLOW under-cap 1 vs 10…");
const allow = await client.sendEvaluateFit({
  brief: "Beacon policy evaluate — amount cap",
  serviceId: "desk",
  amountUsdt0: 1,
  amountCapUsdt0: 10,
  wallet: "0x3bE57A5b65265D3704f846B93600308154fec794",
});
const allowEv = {
  at: new Date().toISOString(),
  kind: "hardware-signed-allow-undercap",
  teeId: NEW_TEE,
  codeHash: NEW_HASH,
  extensionId: 65925,
  instructionId: allow.instructionId,
  txHash: allow.txHash,
  explorer: `https://coston2-explorer.flare.network/tx/${allow.txHash}`,
  teeSignedStatus: allow.status,
  log: allow.log ?? null,
  data: allow.data,
  pass: allow.status === 1,
};
save("closure-fcc-hardware-allow.json", allowEv);
console.log(JSON.stringify(allowEv, null, 2));
if (allow.status !== 1) {
  console.error("ALLOW did not sign status 1");
  process.exit(3);
}
console.log("HARDWARE_ALLOW_DENY_OK");
