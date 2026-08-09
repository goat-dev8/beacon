#!/usr/bin/env npx tsx
/**
 * FDC on-chain AddressValidity verification (Coston2)
 *
 * 1. Prefer recovering an existing finalized round + DA proof (fast)
 * 2. Otherwise run full lifecycle (prepare → submit → wait → proof) — ~2–3 min
 * 3. Call FdcVerification.verifyAddressValidity via VIEW staticCall
 * 4. Write evidence JSON to docs/evidence/fdc-address-validity-verify.json
 *
 * Never prints private keys or API secrets.
 *
 * Usage:
 *   npx tsx scripts/fdc-verify-onchain.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { resetEnvCache, loadEnv } from "@beacon/shared";
import {
  fdcClientFromEnv,
  prepareAddressValidityRequest,
  COSTON2_FDC_VERIFICATION,
  type FullAttestationResult,
  type VerifyAddressValidityResult,
} from "@beacon/fdc";

const TEST_XRP_ADDRESS = "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe";
const SOURCE_ID = "testXRP" as const;

/** Prior live Coston2 AddressValidity request (from history) — recover if still in DA */
const PRIOR_ROUND_ID = 1420937;
const PRIOR_ABI_ENCODED_REQUEST =
  "0x4164647265737356616c696469747900000000000000000000000000000000007465737458525000000000000000000000000000000000000000000000000000fd9db8a26d7cbeebd60776d3ef75bd0da9fc1a44672daf5762b91a4802609a2700000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000002272505431536a7132594772424d5474745834475a486a4b75396479667a6270415965000000000000000000000000000000000000000000000000000000000000";
const PRIOR_TX_HASH = "0x2c62375359beeb5491c648260d79c2ec69a71fc2260bcb21027b7ad86be04516";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_PATH = join(__dirname, "..", "docs", "evidence", "fdc-address-validity-verify.json");

function writeEvidence(payload: Record<string, unknown>): void {
  mkdirSync(dirname(EVIDENCE_PATH), { recursive: true });
  writeFileSync(EVIDENCE_PATH, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`[Evidence] Wrote ${EVIDENCE_PATH}`);
}

async function main(): Promise<void> {
  console.log("=".repeat(70));
  console.log("FDC on-chain verifyAddressValidity (Coston2)");
  console.log("=".repeat(70));
  console.log();

  resetEnvCache();
  const env = loadEnv();

  console.log("[Config] (no secrets printed)");
  console.log(`  COSTON2_RPC_URL: ${env.COSTON2_RPC_URL ? "configured" : "default"}`);
  console.log(`  DA_LAYER_URL: ${env.DA_LAYER_URL ? "configured" : "default"}`);
  console.log(`  FDC_VERIFIER_XRP_URL: ${env.FDC_VERIFIER_XRP_URL ? "configured" : "default"}`);
  console.log(`  FDC_API_KEY: ${env.FDC_API_KEY ? "configured" : "not set"}`);
  console.log(
    `  Private key: ${env.DEPLOYER_PRIVATE_KEY || env.SETTLER_PRIVATE_KEY || env.DEPLOYMENT_PRIVATE_KEY ? "AVAILABLE" : "NOT SET"}`,
  );
  console.log(`  EXPECTED_FDC_VERIFICATION: ${env.EXPECTED_FDC_VERIFICATION || COSTON2_FDC_VERIFICATION}`);
  console.log(`  Test address: ${TEST_XRP_ADDRESS}`);
  console.log();

  const client = fdcClientFromEnv(env);
  const fdcVerificationResolved = await client.getFdcVerification();
  console.log(`[Registry] FdcVerification: ${fdcVerificationResolved}`);
  console.log();

  let mode: "recover" | "full-lifecycle" = "recover";
  let roundId = PRIOR_ROUND_ID;
  let txHash: string | undefined = PRIOR_TX_HASH;
  let abiEncodedRequest = PRIOR_ABI_ENCODED_REQUEST;
  let explorerUrl = `https://coston2-systems-explorer.flare.network/voting-round/${PRIOR_ROUND_ID}?tab=fdc`;
  let timings: FullAttestationResult["timings"] | undefined;

  // --- Try recover existing round first (fast path) ---
  console.log("-".repeat(70));
  console.log(`[Recover] Trying prior round ${PRIOR_ROUND_ID} DA proof...`);
  const recovered = await client.fetchProofWithRetry(PRIOR_ABI_ENCODED_REQUEST, PRIOR_ROUND_ID, 3, 2_000);

  let verifyResult: VerifyAddressValidityResult;

  if (recovered.ok) {
    console.log(`[Recover] DA proof AVAILABLE via ${recovered.urlTried}`);
    console.log(`  merkleProof length: ${recovered.proof?.length ?? 0}`);
    console.log(`  responseHex: ${recovered.responseHex ? `${recovered.responseHex.slice(0, 66)}...` : "none"}`);
    console.log(`  response.isValid: ${recovered.response?.responseBody?.isValid ?? "n/a"}`);
    console.log();

    console.log("-".repeat(70));
    console.log("[Verify] FdcVerification.verifyAddressValidity (VIEW staticCall)...");
    verifyResult = await client.verifyAddressValidityFromDaProof({
      proof: recovered.proof,
      responseHex: recovered.responseHex,
      response: recovered.response,
      raw: recovered.raw,
    });
  } else {
    console.log(`[Recover] Not available (${recovered.error ?? recovered.status}) — running full lifecycle`);
    mode = "full-lifecycle";

    const hasKey = Boolean(
      env.DEPLOYER_PRIVATE_KEY || env.SETTLER_PRIVATE_KEY || env.DEPLOYMENT_PRIVATE_KEY,
    );
    if (!hasKey) {
      const evidence = {
        ok: false,
        mode,
        error: "Prior DA proof unavailable and no private key for full lifecycle submit",
        addressStr: TEST_XRP_ADDRESS,
        sourceId: SOURCE_ID,
        fdcVerificationAddress: fdcVerificationResolved,
        onChainVerified: false,
        callKind: "staticCall",
        timestamp: new Date().toISOString(),
      };
      writeEvidence(evidence);
      console.error(JSON.stringify(evidence, null, 2));
      process.exit(1);
    }

    const prepared = prepareAddressValidityRequest({
      addressStr: TEST_XRP_ADDRESS,
      sourceId: SOURCE_ID,
    });

    console.log("-".repeat(70));
    console.log("[Lifecycle] prepare → submit → wait (~2–3 min) → proof → verify...");
    const life = await client.runFullAttestationLifecycle(
      "AddressValidity",
      SOURCE_ID,
      prepared.requestBody,
      { waitTimeoutMs: 220_000, proofRetries: 8, verifyOnChain: true },
    );
    timings = life.timings;

    if (!life.ok) {
      const evidence = {
        ok: false,
        mode,
        stage: life.stage,
        error: life.error,
        addressStr: TEST_XRP_ADDRESS,
        sourceId: SOURCE_ID,
        txHash: life.txHash,
        roundId: life.roundId,
        fdcVerificationAddress: life.fdcVerificationAddress ?? fdcVerificationResolved,
        onChainVerified: life.onChainVerified ?? false,
        honesty: life.honesty,
        callKind: "staticCall",
        timings: life.timings,
        timestamp: new Date().toISOString(),
      };
      writeEvidence(evidence);
      console.error(JSON.stringify(evidence, null, 2));
      process.exit(1);
    }

    abiEncodedRequest = life.abiEncodedRequest!;
    roundId = life.roundId!;
    txHash = life.txHash;
    explorerUrl = life.explorerUrl ?? explorerUrl;

    verifyResult = {
      ok: true,
      verified: Boolean(life.onChainVerified),
      fdcVerificationAddress: life.fdcVerificationAddress ?? fdcVerificationResolved,
      callKind: "staticCall",
      responseBody: life.response?.responseBody,
    };

    // If lifecycle skipped returning verify detail, re-call explicitly
    if (life.onChainVerified === undefined) {
      verifyResult = await client.verifyAddressValidityFromDaProof({
        proof: life.proof,
        responseHex: life.responseHex,
        response: life.response,
      });
    }
  }

  console.log();
  console.log("[Verify result]");
  console.log(`  ok: ${verifyResult.ok}`);
  console.log(`  verified (onChainVerified): ${verifyResult.verified}`);
  console.log(`  fdcVerificationAddress: ${verifyResult.fdcVerificationAddress ?? fdcVerificationResolved}`);
  console.log(`  callKind: ${verifyResult.callKind} (VIEW — no broadcast tx)`);
  if (verifyResult.error) console.log(`  error: ${verifyResult.error}`);
  if (verifyResult.responseBody) {
    console.log(`  responseBody.isValid: ${verifyResult.responseBody.isValid}`);
    console.log(`  responseBody.standardAddress: ${verifyResult.responseBody.standardAddress}`);
  }
  console.log();

  const honesty = verifyResult.verified ? "VERIFIED" : "PARTIAL";
  const evidence = {
    ok: verifyResult.ok && verifyResult.verified,
    mode,
    attestationType: "AddressValidity",
    sourceId: SOURCE_ID,
    addressStr: TEST_XRP_ADDRESS,
    roundId,
    txHash: txHash ?? null,
    requestAttestationTxHash: txHash ?? null,
    abiEncodedRequestPreview: `${abiEncodedRequest.slice(0, 66)}...`,
    explorerUrl,
    fdcVerificationAddress: verifyResult.fdcVerificationAddress ?? fdcVerificationResolved,
    expectedFdcVerification: env.EXPECTED_FDC_VERIFICATION || COSTON2_FDC_VERIFICATION,
    onChainVerified: verifyResult.verified,
    callKind: "staticCall" as const,
    note: "verifyAddressValidity is a VIEW function; evidence is eth_call/staticCall return value, not a state-changing tx.",
    responseBody: verifyResult.responseBody
      ? {
          isValid: verifyResult.responseBody.isValid,
          standardAddress: verifyResult.responseBody.standardAddress,
          standardAddressHash: verifyResult.responseBody.standardAddressHash,
        }
      : undefined,
    honesty,
    verifyError: verifyResult.error ?? null,
    timings: timings ?? null,
    network: "coston2",
    timestamp: new Date().toISOString(),
    docs: [
      "https://dev.flare.network/fdc/reference/IFdcVerification#verifyaddressvalidity",
      "https://dev.flare.network/fdc/reference/IAddressValidity",
    ],
  };

  writeEvidence(evidence);

  console.log("=".repeat(70));
  console.log("SUMMARY");
  console.log("=".repeat(70));
  console.log(JSON.stringify(evidence, null, 2));

  if (!verifyResult.ok || !verifyResult.verified) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[ERROR]", err instanceof Error ? err.message : String(err));
  writeEvidence({
    ok: false,
    error: err instanceof Error ? err.message : String(err),
    onChainVerified: false,
    callKind: "staticCall",
    timestamp: new Date().toISOString(),
  });
  process.exit(1);
});
