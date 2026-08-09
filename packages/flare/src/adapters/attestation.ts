/**
 * AttestationAdapter — wraps @beacon/fdc FdcClient with honest status tracking.
 *
 * Now uses the official FDC lifecycle:
 * 1. prepareRequest via verifier
 * 2. submitAttestation to FdcHub
 * 3. waitFinalized via Relay
 * 4. fetchProof from DA Layer
 *
 * Lifecycle statuses: Requested | Submitted | Finalized | Verified | Accepted | Rejected | Timeout
 *
 * If verifier URLs are missing, returns status NOT_AVAILABLE honestly — never fakes proofs.
 */

import {
  FdcClient,
  fdcClientFromEnv,
  fdcClientReadOnly,
  prepareAddressValidityRequest,
  prepareEvmTransactionRequest,
  preparePaymentRequest,
  type SourceId,
} from "@beacon/fdc";
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
  /** The abiEncodedRequest from verifier (this is the canonical request ID) */
  requestId: string;
  kind: AttestationRequest["kind"];
  source: AttestationRequest["source"];
  votingRound?: number;
  txHash?: string;
  proof?: unknown;
  responseHex?: string;
  onChainVerified?: boolean;
  fdcVerificationAddress?: string;
  verification?: {
    verified: boolean;
    verifierUrl?: string;
    timestamp: string;
    callKind?: "staticCall";
    error?: string;
  };
  lifecycle: AttestationLifecycle;
  status: IntegrationStatus;
  createdAt: string;
  updatedAt: string;
  error?: string;
  explorerUrl?: string;
}

export interface AttestationAdapterConfig {
  verifierBaseUrl?: string;
  apiKey?: string;
  daLayerUrl?: string;
  rpcUrl?: string;
  privateKey?: string;
}

export class AttestationAdapter {
  private client: FdcClient | null = null;
  private readOnlyClient: FdcClient | null = null;
  private config: AttestationAdapterConfig;
  private env: BeaconEnv;

  constructor(config?: AttestationAdapterConfig, env?: BeaconEnv) {
    this.config = config ?? {};
    this.env = env ?? loadEnv();
  }

  private getClient(): FdcClient | null {
    if (this.client) return this.client;

    // Check if we have the required config
    const hasVerifier = Boolean(this.config.verifierBaseUrl || this.env.FDC_VERIFIER_EVM_URL || this.env.FDC_VERIFIER_XRP_URL);
    if (!hasVerifier) {
      return null;
    }

    const hasKey = Boolean(this.config.privateKey || this.env.DEPLOYER_PRIVATE_KEY || this.env.SETTLER_PRIVATE_KEY);
    if (!hasKey) {
      return null;
    }

    this.client = fdcClientFromEnv(this.env);
    return this.client;
  }

  private getReadOnlyClient(): FdcClient | null {
    if (this.readOnlyClient) return this.readOnlyClient;

    const hasVerifier = Boolean(this.config.verifierBaseUrl || this.env.FDC_VERIFIER_EVM_URL || this.env.FDC_VERIFIER_XRP_URL);
    if (!hasVerifier) {
      return null;
    }

    this.readOnlyClient = fdcClientReadOnly(this.env);
    return this.readOnlyClient;
  }

  isAvailable(source: "xrp" | "evm"): boolean {
    const url = source === "xrp" ? this.env.FDC_VERIFIER_XRP_URL : this.env.FDC_VERIFIER_EVM_URL;
    return Boolean(url);
  }

  canSubmit(): boolean {
    return Boolean(this.env.DEPLOYER_PRIVATE_KEY || this.env.SETTLER_PRIVATE_KEY || this.env.DEPLOYMENT_PRIVATE_KEY);
  }

  /**
   * Step 1: Prepare attestation request via verifier.
   */
  async prepare(request: AttestationRequest): Promise<AttestationPersistShape> {
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

    const client = this.getReadOnlyClient();
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
      // Determine source ID based on source type and kind
      const sourceId = this.resolveSourceId(request.source, request.kind, request.payload);

      // Prepare request via verifier
      const result = await client.prepareRequest(request.kind, sourceId, request.payload);

      if (!result.ok || !result.abiEncodedRequest) {
        return {
          requestId: "",
          kind: request.kind,
          source: request.source,
          lifecycle: "Rejected",
          status: "REAL",
          createdAt: now,
          updatedAt: now,
          error: result.error ?? `Prepare failed: verifier returned ${result.status}`,
        };
      }

      return {
        requestId: result.abiEncodedRequest,
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

  /**
   * Step 2: Submit attestation to FdcHub on-chain.
   */
  async submit(attestation: AttestationPersistShape): Promise<AttestationPersistShape> {
    const now = new Date().toISOString();

    if (!attestation.requestId) {
      return {
        ...attestation,
        lifecycle: "Rejected",
        updatedAt: now,
        error: "Cannot submit without requestId (abiEncodedRequest)",
      };
    }

    if (!this.canSubmit()) {
      return {
        ...attestation,
        lifecycle: "Rejected",
        status: "NOT_AVAILABLE",
        updatedAt: now,
        error: "No private key configured — cannot submit on-chain",
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
      const result = await client.submitAttestation(attestation.requestId);

      if (!result.ok) {
        return {
          ...attestation,
          lifecycle: "Rejected",
          updatedAt: now,
          error: result.error ?? "Submit failed",
        };
      }

      return {
        ...attestation,
        lifecycle: "Submitted",
        txHash: result.txHash,
        votingRound: result.roundId,
        explorerUrl: result.explorerUrl,
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

  /**
   * Step 3: Wait for round finalization.
   */
  async waitForFinalization(
    attestation: AttestationPersistShape,
    timeoutMs: number = 180_000,
  ): Promise<AttestationPersistShape> {
    const now = new Date().toISOString();

    if (!attestation.votingRound) {
      return {
        ...attestation,
        updatedAt: now,
        error: "Cannot wait for finalization without voting round ID",
      };
    }

    const client = this.getReadOnlyClient();
    if (!client) {
      return {
        ...attestation,
        status: "NOT_AVAILABLE",
        updatedAt: now,
        error: "FDC client not initialized",
      };
    }

    try {
      const result = await client.waitFinalized(attestation.votingRound, timeoutMs);

      if (!result.ok || !result.finalized) {
        return {
          ...attestation,
          lifecycle: "Timeout",
          updatedAt: new Date().toISOString(),
          error: result.error ?? `Round ${attestation.votingRound} did not finalize within ${timeoutMs}ms`,
        };
      }

      return {
        ...attestation,
        lifecycle: "Finalized",
        updatedAt: new Date().toISOString(),
      };
    } catch (err) {
      return {
        ...attestation,
        lifecycle: "Timeout",
        updatedAt: new Date().toISOString(),
        error: `Wait finalized threw: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Step 4: Fetch proof from DA Layer.
   * Optionally Step 5: on-chain verify via FdcVerification.verifyAddressValidity (VIEW).
   */
  async fetchProof(
    attestation: AttestationPersistShape,
    options: { verifyOnChain?: boolean } = {},
  ): Promise<AttestationPersistShape> {
    const now = new Date().toISOString();

    if (!attestation.requestId || !attestation.votingRound) {
      return {
        ...attestation,
        updatedAt: now,
        error: "Cannot fetch proof without requestId and voting round",
      };
    }

    const client = this.getReadOnlyClient();
    if (!client) {
      return {
        ...attestation,
        status: "NOT_AVAILABLE",
        updatedAt: now,
        error: "FDC client not initialized",
      };
    }

    try {
      const result = await client.fetchProofWithRetry(attestation.requestId, attestation.votingRound);

      if (!result.ok) {
        return {
          ...attestation,
          updatedAt: new Date().toISOString(),
          error: result.error ?? "Proof not available",
        };
      }

      const shouldVerify =
        options.verifyOnChain ?? attestation.kind === "AddressValidity";

      let onChainVerified = false;
      let fdcVerificationAddress: string | undefined;
      let verifyError: string | undefined;
      let lifecycle: AttestationLifecycle = "Finalized";

      if (shouldVerify) {
        const verifyResult = await client.verifyAddressValidityFromDaProof({
          proof: result.proof,
          responseHex: result.responseHex,
          response: result.response,
          raw: result.raw,
        });
        fdcVerificationAddress = verifyResult.fdcVerificationAddress;
        onChainVerified = verifyResult.verified;
        verifyError = verifyResult.error;
        if (verifyResult.ok && verifyResult.verified) {
          lifecycle = "Verified";
        }
      }

      return {
        ...attestation,
        lifecycle,
        proof: {
          merkleProof: result.proof,
          responseHex: result.responseHex,
          attestationType: result.attestationType,
          response: result.response,
        },
        responseHex: result.responseHex,
        onChainVerified: shouldVerify ? onChainVerified : undefined,
        fdcVerificationAddress,
        verification: {
          verified: onChainVerified,
          verifierUrl: fdcVerificationAddress ?? this.env.DA_LAYER_URL,
          timestamp: new Date().toISOString(),
          callKind: shouldVerify ? "staticCall" : undefined,
          error: verifyError,
        },
        updatedAt: new Date().toISOString(),
        error: verifyError && !onChainVerified ? verifyError : attestation.error,
      };
    } catch (err) {
      return {
        ...attestation,
        updatedAt: new Date().toISOString(),
        error: `Fetch proof threw: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Run full lifecycle: prepare → submit → wait → proof → (optional) on-chain verify
   */
  async runFullLifecycle(
    request: AttestationRequest,
    options: {
      waitTimeoutMs?: number;
      skipOnChain?: boolean;
      verifyOnChain?: boolean;
    } = {},
  ): Promise<AttestationPersistShape> {
    // Step 1: Prepare
    let attestation = await this.prepare(request);
    if (attestation.lifecycle === "Rejected") {
      return attestation;
    }

    // If skipOnChain, return after prepare
    if (options.skipOnChain) {
      return attestation;
    }

    // Step 2: Submit
    attestation = await this.submit(attestation);
    if (attestation.lifecycle === "Rejected") {
      return attestation;
    }

    // Step 3: Wait for finalization
    attestation = await this.waitForFinalization(attestation, options.waitTimeoutMs);
    if (attestation.lifecycle === "Timeout" || attestation.lifecycle === "Rejected") {
      return attestation;
    }

    // Step 4–5: Fetch proof + optional on-chain verify
    attestation = await this.fetchProof(attestation, {
      verifyOnChain: options.verifyOnChain ?? request.kind === "AddressValidity",
    });

    return attestation;
  }

  /**
   * Get current status / check for proof availability.
   * @deprecated Use fetchProof for explicit proof fetching
   */
  async getStatus(attestation: AttestationPersistShape): Promise<AttestationPersistShape> {
    const now = new Date().toISOString();

    if (!attestation.requestId) {
      return {
        ...attestation,
        updatedAt: now,
        error: "Cannot check status without requestId",
      };
    }

    // If we have a voting round, try to fetch proof
    if (attestation.votingRound) {
      return this.fetchProof(attestation);
    }

    // Otherwise just update timestamp
    return {
      ...attestation,
      updatedAt: now,
    };
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

  /**
   * Resolve source ID from request parameters.
   */
  private resolveSourceId(
    source: "xrp" | "evm",
    kind: AttestationRequest["kind"],
    payload: Record<string, unknown>,
  ): SourceId {
    // Check for explicit sourceId in payload
    const explicit = payload.sourceId as string | undefined;
    if (explicit) {
      return explicit as SourceId;
    }

    // Default mappings for testnet
    if (source === "xrp") {
      if (kind === "AddressValidity") {
        // Check for BTC/DOGE addresses
        const addr = (payload.addressStr as string) ?? "";
        if (addr.startsWith("D")) return "testDOGE";
        if (addr.startsWith("m") || addr.startsWith("n") || addr.startsWith("2") || addr.startsWith("tb1")) {
          return "testBTC";
        }
        return "testXRP";
      }
      return "testXRP";
    }

    // EVM sources
    return "testETH";
  }
}

export function createAttestationAdapter(env?: BeaconEnv): AttestationAdapter {
  const e = env ?? loadEnv();
  return new AttestationAdapter(
    {
      verifierBaseUrl: e.FDC_VERIFIER_EVM_URL || e.FDC_VERIFIER_XRP_URL || undefined,
      apiKey: e.FDC_API_KEY || undefined,
      daLayerUrl: e.DA_LAYER_URL || undefined,
      rpcUrl: e.COSTON2_RPC_URL || undefined,
      privateKey: e.DEPLOYER_PRIVATE_KEY || e.SETTLER_PRIVATE_KEY || undefined,
    },
    e,
  );
}

// Re-export request helpers for convenience
export { prepareAddressValidityRequest, prepareEvmTransactionRequest, preparePaymentRequest };
