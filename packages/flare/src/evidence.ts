/**
 * EvidenceEnvelope — unified type connecting all stages of a Beacon job
 * through Flare protocol interactions.
 *
 * Provides an audit trail from intent → quote → execution → settlement.
 */

import type { IntegrationStatus } from "./honesty.js";

export interface EvidenceStage {
  name: string;
  status: IntegrationStatus;
  timestamp?: string;
  hash?: string;
  data?: unknown;
}

export interface IntentEvidence {
  jobId: string;
  userId: string;
  intentHash?: string;
  description?: string;
  timestamp?: string;
}

export interface QuoteEvidence {
  quoteId: string;
  amountIn?: string;
  amountOut?: string;
  priceSource?: string;
  expiresAt?: string;
  timestamp?: string;
  hash?: string;
}

export interface FtsoSnapshotEvidence {
  ftsoV2Address: string;
  feeds: Array<{
    symbol: string;
    value: number;
    timestamp: number;
  }>;
  blockNumber?: number;
  hash?: string;
}

export interface FdcProofEvidence {
  requestId: string;
  attestationType: string;
  votingRound?: number;
  proof?: unknown;
  verified?: boolean;
  verifierUrl?: string;
  timestamp?: string;
  hash?: string;
  /** FdcHub.requestAttestation transaction hash when submitted on-chain. */
  txHash?: string;
  proofAvailable?: boolean;
}

export interface PolicyDecisionEvidence {
  policyHash: string;
  policyEpoch?: number;
  allowed: boolean;
  reasons: string[];
  timestamp?: string;
}

export interface FccAuthorizationEvidence {
  actionHash: string;
  policyHash: string;
  nonce: string;
  validAfter?: string;
  validBefore?: string;
  allow: boolean;
  mode: "verified" | "simulated" | "unavailable";
  reasonCommitment?: string;
  timestamp?: string;
}

export interface PaymentEvidence {
  rail: "x402" | "safe_escrow" | "xrpl" | "evm_transfer";
  txHash?: string;
  amount?: string;
  currency?: string;
  from?: string;
  to?: string;
  timestamp?: string;
}

export interface ExecutionEvidence {
  executionId: string;
  workerAddress?: string;
  startedAt?: string;
  completedAt?: string;
  artifactHash?: string;
  logs?: string[];
}

export interface ExternalProofEvidence {
  source: string;
  proofType: string;
  data: unknown;
  timestamp?: string;
  hash?: string;
}

export interface AcceptanceEvidence {
  accepted: boolean;
  acceptorAddress?: string;
  signature?: string;
  timestamp?: string;
  hash?: string;
}

export interface SettlementEvidence {
  settlementTxHash?: string;
  chain?: string;
  amount?: string;
  recipient?: string;
  timestamp?: string;
}

export interface ReceiptEvidence {
  receiptId: string;
  signature?: string;
  ipfsHash?: string;
  arweaveId?: string;
  timestamp?: string;
}

export interface EvidenceEnvelope {
  version: "1.0";
  jobId: string;
  createdAt: string;
  updatedAt: string;

  intent?: IntentEvidence;
  quote?: QuoteEvidence;
  ftsoSnapshot?: FtsoSnapshotEvidence;
  fdcProof?: FdcProofEvidence;
  policyDecision?: PolicyDecisionEvidence;
  fccAuthorization?: FccAuthorizationEvidence;
  payment?: PaymentEvidence;
  execution?: ExecutionEvidence;
  externalProof?: ExternalProofEvidence;
  acceptance?: AcceptanceEvidence;
  settlement?: SettlementEvidence;
  receipt?: ReceiptEvidence;

  stages: EvidenceStage[];
  currentStage?: string;
  finalStatus?: IntegrationStatus;
}

export function createEvidenceEnvelope(
  partial: Partial<EvidenceEnvelope> & { jobId: string },
): EvidenceEnvelope {
  const now = new Date().toISOString();
  const { jobId, createdAt, stages, ...rest } = partial;
  return {
    version: "1.0",
    jobId,
    createdAt: createdAt ?? now,
    updatedAt: now,
    stages: stages ?? [],
    ...rest,
  };
}

export function appendEvidenceStage(
  envelope: EvidenceEnvelope,
  stage: string,
  data: {
    status: IntegrationStatus;
    hash?: string;
    payload?: unknown;
  },
): EvidenceEnvelope {
  const now = new Date().toISOString();
  const newStage: EvidenceStage = {
    name: stage,
    status: data.status,
    timestamp: now,
    hash: data.hash,
    data: data.payload,
  };

  return {
    ...envelope,
    updatedAt: now,
    currentStage: stage,
    stages: [...envelope.stages, newStage],
    finalStatus: data.status,
  };
}

export function getLatestStage(envelope: EvidenceEnvelope): EvidenceStage | null {
  return envelope.stages.length > 0
    ? envelope.stages[envelope.stages.length - 1]!
    : null;
}

export function hasCompletedStage(
  envelope: EvidenceEnvelope,
  stageName: string,
): boolean {
  return envelope.stages.some(
    (s) => s.name === stageName && (s.status === "REAL" || s.status === "SIMULATED"),
  );
}
