/**
 * ConfidentialComputeAdapter — shadow authorization only.
 *
 * Uses resolveFccMode from @beacon/shared to determine honesty status:
 * - "verified": Hardware TEE attestation available (requires evidence)
 * - "simulated": SIMULATED_TEE on Coston2 (hackathon-accepted, not hardware)
 * - "unavailable": FCC not configured — fail-closed (allow: false)
 *
 * Shadow mode cannot move funds — returns signed-style authorization object
 * for comparison with server policy, with honesty label.
 *
 * NEVER claims hardware TEE without evidence.
 */

import { resolveFccMode, type BeaconEnv, type FccMode } from "@beacon/shared";
import type { IntegrationStatus } from "../honesty.js";

export interface ShadowAuthorizationParams {
  actionHash: string;
  policyHash: string;
  policyEpoch?: number;
  nonce: string;
  validAfter?: string;
  validBefore?: string;
  allow: boolean;
  reasonCommitment?: string;
}

export interface ShadowAuthorizationResult {
  status: IntegrationStatus;
  mode: FccMode;
  authorization: {
    actionHash: string;
    policyHash: string;
    policyEpoch?: number;
    nonce: string;
    validAfter: string;
    validBefore: string;
    allow: boolean;
    reasonCommitment?: string;
    timestamp: string;
  };
  honestyLabel: string;
  canMoveFunds: false;
}

export class ConfidentialComputeAdapter {
  constructor(_env?: BeaconEnv) {
    // Environment is accessed via process.env in resolveFccMode
  }

  /**
   * Get current FCC mode from environment.
   */
  getMode(): FccMode {
    return resolveFccMode(process.env);
  }

  /**
   * Get integration status based on FCC mode.
   */
  getStatus(): {
    status: IntegrationStatus;
    mode: FccMode;
    note: string;
  } {
    const mode = this.getMode();

    let status: IntegrationStatus;
    let note: string;

    switch (mode) {
      case "verified":
        status = "REAL";
        note =
          "FCC mode is verified — hardware TEE attestation expected. " +
          "WARNING: Beacon does not currently verify hardware attestation evidence.";
        break;
      case "simulated":
        status = "SIMULATED";
        note =
          "FCC mode is simulated — using SIMULATED_TEE on Coston2 (hackathon-accepted). " +
          "This is NOT hardware-attested Confidential Space.";
        break;
      case "unavailable":
      default:
        status = "NOT_AVAILABLE";
        note =
          "FCC is unavailable — confidential compute not configured. " +
          "Shadow authorization will fail-closed (allow: false).";
        break;
    }

    return { status, mode, note };
  }

  /**
   * Evaluate shadow authorization.
   *
   * Shadow mode CANNOT move funds — this returns a signed-style authorization
   * object for comparison with server policy, with honesty label attached.
   *
   * If mode is unavailable, returns allow: false (fail-closed).
   */
  evaluateShadowAuthorization(
    params: ShadowAuthorizationParams,
  ): ShadowAuthorizationResult {
    const mode = this.getMode();
    const now = new Date();

    let status: IntegrationStatus;
    let honestyLabel: string;
    let allow = params.allow;

    switch (mode) {
      case "verified":
        status = "REAL";
        honestyLabel =
          "FCC verified mode — authorization created but Beacon lacks hardware attestation verification. " +
          "Do NOT trust this as hardware TEE proof.";
        break;
      case "simulated":
        status = "SIMULATED";
        honestyLabel =
          "FCC simulated mode (SIMULATED_TEE) — shadow authorization for development/hackathon. " +
          "Not hardware-attested. Valid for Coston2 testing only.";
        break;
      case "unavailable":
      default:
        status = "NOT_AVAILABLE";
        allow = false;
        honestyLabel =
          "FCC unavailable — shadow authorization fail-closed (allow: false). " +
          "Cannot provide confidential compute guarantees.";
        break;
    }

    const validAfter = params.validAfter ?? now.toISOString();
    const validBefore =
      params.validBefore ?? new Date(now.getTime() + 300_000).toISOString();

    return {
      status,
      mode,
      authorization: {
        actionHash: params.actionHash,
        policyHash: params.policyHash,
        policyEpoch: params.policyEpoch,
        nonce: params.nonce,
        validAfter,
        validBefore,
        allow,
        reasonCommitment: params.reasonCommitment,
        timestamp: now.toISOString(),
      },
      honestyLabel,
      canMoveFunds: false,
    };
  }

  /**
   * Check if FCC can be used for the given operation.
   *
   * Returns false if mode is unavailable — fail-closed.
   */
  canAuthorize(): boolean {
    const mode = this.getMode();
    return mode === "verified" || mode === "simulated";
  }

  /**
   * Get documentation links for FCC.
   */
  getDocs(): string[] {
    return [
      "https://dev.flare.network/fcc/overview",
      "https://dev.flare.network/fcc/developer-guides",
    ];
  }
}

export function createConfidentialComputeAdapter(
  env?: BeaconEnv,
): ConfidentialComputeAdapter {
  return new ConfidentialComputeAdapter(env);
}
