/**
 * AttestationAdapter — wraps @beacon/fdc FdcClient with honest status tracking.
 *
 * Lifecycle statuses: Requested | Submitted | Finalized | Verified | Accepted | Rejected | Timeout
 *
 * If verifier URLs are missing, returns status NOT_AVAILABLE honestly — never fakes proofs.
 */

import { FdcClient, type PrepareRequest } from "@beacon/fdc";
import { loadEnv, type BeaconEnv } from "@beacon/shared";
import type { IntegrationStatus } from "../honesty.js";

export type AttestationLifecycle =
  | "Requested"
  | "Submitted"
  | "Finalized"
  | "Verified"
  | "Accepted"
  | "Rejected"
  | "Timeout";

export interface AttestationRequest {
  kind: "Payment" | "EVMTransaction" | "Web2Json" | "AddressValidity";
  source: "xrp" | "evm";
  payload: Record<string, unknown>;
}

export interface AttestationPersistShape {
  requestId: string;
  kind: AttestationRequest["kind"];
  source: AttestationRequest["source"];
  votingRound?: number;
  proof?: unknown;
  verification?: {
    verified: boolean;
    verifierUrl?: string;
    timestamp: string;
  };
  lifecycle: AttestationLifecycle;
  status: IntegrationStatus;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface AttestationAdapterConfig {
  verifierXrpUrl?: string;
  verifierEvmUrl?: string;
  apiKey?: string;
  daLayerUrl?: string;
}

export class AttestationAdapter {
  private client: FdcClient | null = null;
  private config: AttestationAdapterConfig;

  constructor(config?: AttestationAdapterConfig) {
    this.config = config ?? {};
  }

  private getClient(): FdcClient | null {
    if (this.client) return this.client;

    const verifierXrpUrl = this.config.verifierXrpUrl;
    const verifierEvmUrl = this.config.verifierEvmUrl;

    if (!verifierXrpUrl && !verifierEvmUrl) {
      return null;
    }

    this.client = new FdcClient({
      verifierXrpUrl: verifierXrpUrl ?? "",
      verifierEvmUrl: verifierEvmUrl ?? "",
      apiKey: this.config.apiKey,
      daLayerUrl: this.config.daLayerUrl,
    });

    return this.client;
  }

  isAvailable(source: "xrp" | "evm"): boolean {
    const url = source === "xrp"
      ? this.config.verifierXrpUrl
      : this.config.verifierEvmUrl;
    return Boolean(url);
  }

  async prepare(
    request: AttestationRequest,
  ): Promise<AttestationPersistShape> {
    const now = new Date().toISOString();

    if (!this.isAvailable(request.source)) {
      return {
        requestId: "",
        kind: request.kind,
        source: request.source,
        lifecycle: "Rejected",
        status: "NOT_AVAILABLE",
        createdAt: now,
        updatedAt: now,
        error: `FDC verifier URL not configured for ${request.source} — cannot prepare attestation. Never fake proofs.`,
      };
    }

    const client = this.getClient();
    if (!client) {
      return {
        requestId: "",
        kind: request.kind,
        source: request.source,
        lifecycle: "Rejected",
        status: "NOT_AVAILABLE",
        createdAt: now,
        updatedAt: now,
        error: "FDC client not initialized",
      };
    }

    try {
      const prepareReq: PrepareRequest = {
        kind: request.kind,
        source: request.source,
        payload: request.payload,
      };

      const response = await client.prepare(prepareReq);

      if (response.status === "error" || !response.requestId) {
        return {
          requestId: "",
          kind: request.kind,
          source: request.source,
          lifecycle: "Rejected",
          status: "REAL",
          createdAt: now,
          updatedAt: now,
          error: response.message ?? "Prepare failed — verifier rejected request",
        };
      }

      return {
        requestId: response.requestId,
        kind: request.kind,
        source: request.source,
        lifecycle: "Requested",
        status: "REAL",
        createdAt: now,
        updatedAt: now,
      };
    } catch (err) {
      return {
        requestId: "",
        kind: request.kind,
        source: request.source,
        lifecycle: "Rejected",
        status: "REAL",
        createdAt: now,
        updatedAt: now,
        error: `Prepare threw: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async submit(
    attestation: AttestationPersistShape,
  ): Promise<AttestationPersistShape> {
    const now = new Date().toISOString();

    if (!attestation.requestId) {
      return {
        ...attestation,
        lifecycle: "Rejected",
        updatedAt: now,
        error: "Cannot submit without requestId",
      };
    }

    if (!this.isAvailable(attestation.source)) {
      return {
        ...attestation,
        lifecycle: "Rejected",
        status: "NOT_AVAILABLE",
        updatedAt: now,
        error: `FDC verifier URL not configured for ${attestation.source}`,
      };
    }

    const client = this.getClient();
    if (!client) {
      return {
        ...attestation,
        lifecycle: "Rejected",
        status: "NOT_AVAILABLE",
        updatedAt: now,
        error: "FDC client not initialized",
      };
    }

    try {
      const response = await client.submit(attestation.requestId, attestation.source);

      if (response.status === "error") {
        return {
          ...attestation,
          lifecycle: "Rejected",
          updatedAt: now,
          error: response.message ?? "Submit failed",
        };
      }

      return {
        ...attestation,
        lifecycle: "Submitted",
        updatedAt: now,
      };
    } catch (err) {
      return {
        ...attestation,
        lifecycle: "Rejected",
        updatedAt: now,
        error: `Submit threw: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async getStatus(
    attestation: AttestationPersistShape,
  ): Promise<AttestationPersistShape> {
    const now = new Date().toISOString();

    if (!attestation.requestId) {
      return {
        ...attestation,
        updatedAt: now,
        error: "Cannot check status without requestId",
      };
    }

    const client = this.getClient();
    if (!client) {
      return {
        ...attestation,
        status: "NOT_AVAILABLE",
        updatedAt: now,
        error: "FDC client not initialized",
      };
    }

    try {
      const proofResult = await client.fetchProof(attestation.requestId);

      if (!proofResult.ok) {
        return {
          ...attestation,
          updatedAt: now,
          error: proofResult.message ?? "Proof not available yet",
        };
      }

      return {
        ...attestation,
        lifecycle: "Finalized",
        proof: proofResult.proof,
        // Proof retrieved from DA layer ≠ on-chain FdcVerification success.
        verification: {
          verified: false,
          verifierUrl: this.config.daLayerUrl,
          timestamp: now,
        },
        updatedAt: now,
      };
    } catch (err) {
      return {
        ...attestation,
        updatedAt: now,
        error: `Status check threw: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  updateLifecycle(
    attestation: AttestationPersistShape,
    lifecycle: AttestationLifecycle,
    data?: { proof?: unknown; error?: string },
  ): AttestationPersistShape {
    return {
      ...attestation,
      lifecycle,
      proof: data?.proof ?? attestation.proof,
      error: data?.error ?? attestation.error,
      updatedAt: new Date().toISOString(),
    };
  }
}

export function createAttestationAdapter(env?: BeaconEnv): AttestationAdapter {
  const e = env ?? loadEnv();
  return new AttestationAdapter({
    verifierXrpUrl: e.FDC_VERIFIER_XRP_URL || undefined,
    verifierEvmUrl: e.FDC_VERIFIER_EVM_URL || undefined,
    apiKey: e.FDC_API_KEY || undefined,
    daLayerUrl: e.DA_LAYER_URL || undefined,
  });
}
