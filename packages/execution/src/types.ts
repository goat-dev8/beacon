import { z } from "zod";

export const ExecutionPhaseSchema = z.enum([
  "understanding",
  "clarifying",
  "job_created",
  "quoting",
  "risk_checking",
  "awaiting_authorization",
  "authorized",
  "executing",
  "observing",
  "verifying",
  "settling",
  "completed",
  "blocked",
  "failed",
  "canceled",
  "expired",
  "refunded",
]);

export type ExecutionPhase = z.infer<typeof ExecutionPhaseSchema>;

export const PaymentModeSchema = z.enum(["none", "x402", "escrow", "wallet"]);

export type PaymentMode = z.infer<typeof PaymentModeSchema>;

export interface ExecutionPlan {
  executionId: string;
  workflowType: string;
  workflowVersion: string;
  walletIdentity: string;
  immutableInput: unknown;
  inputHash: string;
  quoteId?: string;
  paymentMode: PaymentMode;
  executorType: string;
}

export interface PreparedExecution {
  executionId: string;
  workflowType: string;
  workflowVersion: string;
  preparedAt: string;
  plan: ExecutionPlan;
  payload: unknown;
}

export interface ExecutionEvidence {
  executionId: string;
  workflowType: string;
  workflowVersion: string;
  recordedAt: string;
  prepared: PreparedExecution;
  payload: unknown;
}

export interface VerificationResult {
  executionId: string;
  verified: boolean;
  outcome: "pass" | "fail" | "needs_review";
  details?: unknown;
}

export interface ExecutionAdapter {
  prepare(plan: ExecutionPlan): Promise<PreparedExecution>;
  execute(prepared: PreparedExecution): Promise<ExecutionEvidence>;
  observe(evidence: ExecutionEvidence): AsyncIterable<ExecutionEvent>;
  verify(evidence: ExecutionEvidence): Promise<VerificationResult>;
}

export type ExecutionEventType =
  | "phase_changed"
  | "step_started"
  | "step_completed"
  | "step_failed"
  | "quote_created"
  | "risk_decided"
  | "authorization_recorded"
  | "evidence_recorded"
  | "receipt_issued"
  | "note";

export interface ExecutionEvent {
  id: string;
  executionId: string;
  seq: number;
  type: ExecutionEventType;
  phase?: ExecutionPhase;
  payload: unknown;
  createdAt: string;
}

export interface WorkflowDefinition {
  workflowType: string;
  version: string;
  adapter: ExecutionAdapter;
}
