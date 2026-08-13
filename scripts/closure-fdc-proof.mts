import { config } from "dotenv";
config({ path: ".env", override: true });
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resetEnvCache, loadEnv } from "@beacon/shared";
import { fdcClientFromEnv } from "@beacon/fdc";

const ROUND = 1423862;
const TX = "0x8a4fedfbc4c7642b295befddf87b12b31fd0e4980358877e215591a9f3cb1d5e";
const ABI =
  "0x4164647265737356616c696469747900000000000000000000000000000000007465737458525000000000000000000000000000000000000000000000000000fd9db8a26d7cbeebd60776d3ef75bd0da9fc1a44672daf5762b91a4802609a2700000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000002272505431536a7132594772424d5474745834475a486a4b75396479667a6270415965000000000000000000000000000000000000000000000000000000000000";

resetEnvCache();
const client = fdcClientFromEnv(loadEnv());
const proof = await client.fetchProofWithRetry(ABI, ROUND, 30, 8000);
let verify: unknown = null;
if (proof.ok) {
  verify = await client.verifyAddressValidityFromDaProof({
    proof: proof.proof ?? [],
    responseHex: proof.responseHex ?? "",
    raw: proof.raw,
    votingRound: ROUND,
  });
}
const evidence = {
  at: new Date().toISOString(),
  attestationType: "AddressValidity",
  sourceId: "testXRP",
  addressStr: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe",
  txHash: TX,
  roundId: ROUND,
  explorer: `https://coston2-systems-explorer.flare.network/voting-round/${ROUND}?tab=fdc`,
  attestationExplorer: "https://coston2-systems-explorer.flare.network/attestation-request",
  coston2Tx: `https://coston2-explorer.flare.network/tx/${TX}`,
  finalized: true,
  proof: {
    ok: proof.ok,
    status: proof.status,
    proofLen: proof.proof?.length ?? 0,
    hasResponse: Boolean(proof.responseHex),
    urlTried: proof.urlTried,
    error: proof.error ?? null,
  },
  onChainVerify: verify,
};
mkdirSync("docs/evidence", { recursive: true });
writeFileSync(join("docs/evidence", "closure-fdc-fresh.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
if (!proof.ok) process.exit(2);
