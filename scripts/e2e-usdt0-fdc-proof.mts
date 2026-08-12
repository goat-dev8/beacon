import { config } from "dotenv";
config({ path: ".env", override: true });
import { writeFileSync } from "node:fs";
import { resetEnvCache, loadEnv } from "@beacon/shared";
import { fdcClientFromEnv } from "@beacon/fdc";

const ROUND = 1423789;
const TX = "0xd6f792c8b15e35debb63060579484b6109405a2f779f2275f9948a6ef3bb12e1";
const ABI =
  "0x4164647265737356616c696469747900000000000000000000000000000000007465737458525000000000000000000000000000000000000000000000000000fd9db8a26d7cbeebd60776d3ef75bd0da9fc1a44672daf5762b91a4802609a2700000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000002272505431536a7132594772424d5474745834475a486a4b75396479667a6270415965000000000000000000000000000000000000000000000000000000000000";

resetEnvCache();
const client = fdcClientFromEnv(loadEnv());
const proof = await client.fetchProofWithRetry(ABI, ROUND, 8, 5000);
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
  honesty: proof.ok
    ? "This-pass FDC AddressValidity submitted from Beacon keys, round finalized, DA proof retrieved."
    : "This-pass FDC AddressValidity submitted and round finalized. DA proof not yet available — not invented. Prior on-chain verify remains docs/evidence/fdc-address-validity-verify.json (round 1420937).",
};
writeFileSync("docs/evidence/usdt0-fdc-this-pass.json", JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
