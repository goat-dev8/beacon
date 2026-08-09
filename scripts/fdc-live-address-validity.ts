#!/usr/bin/env npx tsx
/**
 * FDC Live AddressValidity Test Script
 *
 * Demonstrates the complete FDC attestation lifecycle for AddressValidity:
 * 1. Prepares an AddressValidity request for a known valid XRP testnet address
 * 2. Submits to FdcHub on Coston2 (if private key available)
 * 3. Waits for round finalization
 * 4. Fetches proof from DA layer
 *
 * Usage:
 *   npx tsx scripts/fdc-live-address-validity.ts
 *
 * Environment:
 *   DEPLOYER_PRIVATE_KEY or SETTLER_PRIVATE_KEY - Required for on-chain submission
 *   FDC_VERIFIER_XRP_URL - Verifier base URL (defaults to testnet)
 *   FDC_API_KEY - API key for verifier
 *   DA_LAYER_URL - DA layer URL (defaults to Coston2)
 *   COSTON2_RPC_URL - RPC URL (defaults to public endpoint)
 *
 * IMPORTANT: This script NEVER prints private keys.
 */

import { loadEnv } from "@beacon/shared";
import {
  fdcClientFromEnv,
  fdcClientReadOnly,
  prepareAddressValidityRequest,
  toBytes32String,
} from "@beacon/fdc";

// Known valid XRP testnet addresses for testing
const TEST_ADDRESSES = {
  testXRP: "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe", // Valid XRP testnet format
  testBTC: "mg9P9f4wr9w7c1sgFeiTC5oMLYXCc2c7hs", // Valid BTC testnet format (from Flare docs)
};

async function main() {
  console.log("=".repeat(70));
  console.log("FDC Live AddressValidity Test");
  console.log("=".repeat(70));
  console.log();

  const env = loadEnv();

  // Check configuration
  console.log("[Config] Checking environment...");
  console.log(`  FDC_VERIFIER_XRP_URL: ${env.FDC_VERIFIER_XRP_URL ? "configured" : "not set"}`);
  console.log(`  FDC_API_KEY: ${env.FDC_API_KEY ? "configured" : "not set"}`);
  console.log(`  DA_LAYER_URL: ${env.DA_LAYER_URL || "default (ctn2-data-availability.flare.network)"}`);
  console.log(`  COSTON2_RPC_URL: ${env.COSTON2_RPC_URL || "default (coston2-api.flare.network)"}`);
  console.log(
    `  Private Key: ${env.DEPLOYER_PRIVATE_KEY || env.SETTLER_PRIVATE_KEY ? "AVAILABLE (not printing)" : "NOT SET"}`,
  );
  console.log();

  // Select test address
  const sourceId = "testXRP";
  const addressStr = TEST_ADDRESSES[sourceId];

  console.log("[Test Parameters]");
  console.log(`  Attestation Type: AddressValidity`);
  console.log(`  Source ID: ${sourceId}`);
  console.log(`  Test Address: ${addressStr}`);
  console.log();

  // Show encoded values
  console.log("[Encoding]");
  console.log(`  attestationType (hex32): ${toBytes32String("AddressValidity")}`);
  console.log(`  sourceId (hex32): ${toBytes32String(sourceId)}`);
  console.log();

  // Check if we can do on-chain operations
  const hasPrivateKey = Boolean(env.DEPLOYER_PRIVATE_KEY || env.SETTLER_PRIVATE_KEY || env.DEPLOYMENT_PRIVATE_KEY);

  try {
    // Step 1: Prepare the attestation request
    console.log("-".repeat(70));
    console.log("[Step 1] Preparing attestation request via verifier...");
    console.log();

    const client = hasPrivateKey ? fdcClientFromEnv(env) : fdcClientReadOnly(env);

    const preparedBody = prepareAddressValidityRequest({
      addressStr,
      sourceId,
    });

    console.log("Request body:");
    console.log(JSON.stringify(preparedBody, null, 2));
    console.log();

    const prepareResult = await client.prepareRequest("AddressValidity", sourceId, preparedBody.requestBody);

    if (!prepareResult.ok) {
      console.log("[FAILED] Prepare request failed:");
      console.log(`  Status: ${prepareResult.status}`);
      console.log(`  Error: ${prepareResult.error}`);
      if (prepareResult.raw) {
        console.log(`  Raw response: ${JSON.stringify(prepareResult.raw, null, 2)}`);
      }
      process.exit(1);
    }

    console.log("[SUCCESS] Verifier returned VALID");
    console.log(`  abiEncodedRequest: ${prepareResult.abiEncodedRequest?.slice(0, 100)}...`);
    console.log(`  Full length: ${prepareResult.abiEncodedRequest?.length} chars`);
    console.log();

    if (!hasPrivateKey) {
      console.log("-".repeat(70));
      console.log("[INFO] No private key configured - stopping after prepare step.");
      console.log();
      console.log("To run the full lifecycle (submit, wait, proof), set one of:");
      console.log("  DEPLOYER_PRIVATE_KEY");
      console.log("  SETTLER_PRIVATE_KEY");
      console.log("  DEPLOYMENT_PRIVATE_KEY");
      console.log();
      console.log("Summary:");
      console.log(`  Prepare: SUCCESS`);
      console.log(`  abiEncodedRequest: ${prepareResult.abiEncodedRequest}`);
      process.exit(0);
    }

    // Step 2: Submit to FdcHub
    console.log("-".repeat(70));
    console.log("[Step 2] Submitting attestation request to FdcHub on Coston2...");
    console.log();

    const submitResult = await client.submitAttestation(prepareResult.abiEncodedRequest!);

    if (!submitResult.ok) {
      console.log("[FAILED] Submit failed:");
      console.log(`  Error: ${submitResult.error}`);
      process.exit(1);
    }

    console.log("[SUCCESS] Attestation request submitted");
    console.log(`  txHash: ${submitResult.txHash}`);
    console.log(`  roundId: ${submitResult.roundId}`);
    console.log(`  blockNumber: ${submitResult.blockNumber}`);
    console.log(`  explorerUrl: ${submitResult.explorerUrl}`);
    console.log();

    // Step 3: Wait for finalization
    console.log("-".repeat(70));
    console.log(`[Step 3] Waiting for round ${submitResult.roundId} to finalize...`);
    console.log("  (This may take up to 180 seconds)");
    console.log();

    const waitTimeout = 200_000; // 200s timeout
    const waitResult = await client.waitFinalized(submitResult.roundId!, waitTimeout, 10_000);

    if (!waitResult.ok || !waitResult.finalized) {
      console.log("[TIMEOUT] Round did not finalize within timeout:");
      console.log(`  Elapsed: ${waitResult.elapsedMs}ms`);
      console.log(`  Error: ${waitResult.error}`);
      console.log();
      console.log("You can check the round status at:");
      console.log(`  ${submitResult.explorerUrl}`);
      console.log();
      console.log("And fetch the proof later using:");
      console.log(`  roundId: ${submitResult.roundId}`);
      console.log(`  abiEncodedRequest: ${prepareResult.abiEncodedRequest}`);
      process.exit(1);
    }

    console.log(`[SUCCESS] Round ${submitResult.roundId} finalized`);
    console.log(`  Elapsed: ${waitResult.elapsedMs}ms`);
    console.log();

    // Step 4: Fetch proof
    console.log("-".repeat(70));
    console.log("[Step 4] Fetching proof from DA layer...");
    console.log();

    // Give DA layer a moment to generate the proof
    await new Promise((r) => setTimeout(r, 5000));

    const proofResult = await client.fetchProofWithRetry(prepareResult.abiEncodedRequest!, submitResult.roundId!);

    if (!proofResult.ok) {
      console.log("[FAILED] Proof fetch failed:");
      console.log(`  Status: ${proofResult.status}`);
      console.log(`  Error: ${proofResult.error}`);
      console.log(`  URL tried: ${proofResult.urlTried}`);
      process.exit(1);
    }

    console.log("[SUCCESS] Proof retrieved from DA layer");
    console.log(`  Proof array length: ${proofResult.proof?.length ?? 0}`);
    console.log(`  responseHex length: ${proofResult.responseHex?.length ?? 0}`);
    console.log(`  attestationType: ${proofResult.attestationType}`);
    console.log();

    // Print final summary
    console.log("=".repeat(70));
    console.log("FINAL SUMMARY");
    console.log("=".repeat(70));
    console.log();
    console.log(`Test Address: ${addressStr}`);
    console.log(`Source: ${sourceId}`);
    console.log(`Transaction Hash: ${submitResult.txHash}`);
    console.log(`Voting Round: ${submitResult.roundId}`);
    console.log(`Proof Available: YES`);
    console.log(`Merkle Proof: ${JSON.stringify(proofResult.proof)}`);
    console.log();
    console.log("Explorer Links:");
    console.log(`  Transaction: https://coston2-explorer.flare.network/tx/${submitResult.txHash}`);
    console.log(`  FDC Round: ${submitResult.explorerUrl}`);
    console.log();

    // Parse response to show validity
    if (proofResult.responseHex) {
      console.log("Response Data (partial decode):");
      console.log(`  responseHex (first 200 chars): ${proofResult.responseHex.slice(0, 200)}...`);
    }

    console.log();
    console.log("Full Attestation Lifecycle: COMPLETE");
    console.log();
  } catch (err) {
    console.error("[ERROR] Unexpected error:");
    console.error(err instanceof Error ? err.message : String(err));
    if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

main();
