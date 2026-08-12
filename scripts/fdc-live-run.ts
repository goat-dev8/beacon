import { config } from "dotenv";
config({ path: ".env", override: true });
import { resetEnvCache, loadEnv } from "@beacon/shared";
import {
  fdcClientFromEnv,
  prepareAddressValidityRequest,
  toBytes32String,
} from "@beacon/fdc";

async function main() {
  resetEnvCache();
  const env = loadEnv();
  const client = fdcClientFromEnv(env);

  console.log("verifierBase", (client as unknown as { cfg: { verifierBaseUrl: string } }).cfg?.verifierBaseUrl ?? "via client");
  console.log("toBytes32 AddressValidity", toBytes32String("AddressValidity"));

  const prepared = await client.prepareRequest(
    "AddressValidity",
    "testXRP",
    { addressStr: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe" },
  );
  console.log("prepare", JSON.stringify(prepared, null, 2).slice(0, 800));

  if (!prepared.ok || !prepared.abiEncodedRequest) {
    console.log("STOP: prepare not VALID — cannot invent attestation");
    process.exit(prepared.ok ? 0 : 2);
  }

  if (!env.DEPLOYER_PRIVATE_KEY && !env.SETTLER_PRIVATE_KEY && !env.DEPLOYMENT_PRIVATE_KEY) {
    console.log("No submit key — prepare-only success");
    process.exit(0);
  }

  console.log("Submitting to FdcHub on Coston2...");
  const submitted = await client.submitAttestation(prepared.abiEncodedRequest);
  console.log("submit", JSON.stringify(submitted, null, 2));
  if (!submitted.ok || submitted.roundId == null) {
    process.exit(3);
  }

  console.log("Waiting for Relay.isFinalized(200, round)...");
  const wait = await client.waitFinalized(submitted.roundId, 240_000);
  console.log("wait", JSON.stringify(wait, null, 2));

  const proof = await client.fetchProof(prepared.abiEncodedRequest, submitted.roundId);
  console.log("proof", {
    ok: proof.ok,
    status: proof.status,
    proofLen: proof.proof?.length ?? 0,
    hasResponse: Boolean(proof.responseHex),
    urlTried: proof.urlTried,
    error: proof.error,
  });

  console.log(
    JSON.stringify(
      {
        status: proof.ok ? "REAL" : "PARTIAL",
        txHash: submitted.txHash,
        explorer: submitted.explorerUrl,
        roundId: submitted.roundId,
        finalized: wait.finalized,
        proofAvailable: proof.ok,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
