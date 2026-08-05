import type pg from "pg";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type ExecutionRow = {
  id: string;
  wallet: string;
  conversation_id: string | null;
  workflow_type: string;
  workflow_version: string;
  immutable_input: unknown;
  input_hash: string;
  phase: string;
  status: string;
  active_step: string | null;
  payment_mode: string;
  executor_type: string | null;
  quote_id: string | null;
  idempotency_key: string | null;
  error_json: unknown | null;
  created_at: Date;
  updated_at: Date;
};

export type ExecutionEventRow = {
  id: string;
  execution_id: string;
  seq: number;
  event_type: string;
  phase: string | null;
  payload: unknown;
  created_at: Date;
};

/** Idempotent schema ensure for execution engine tables (safe on every boot). */
export async function ensureExecutionSchema(pool: pg.Pool): Promise<void> {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  const sqlPath = path.join(__dirname, "../../../db/migrations/003_execution_engine.sql");
  try {
    const sql = readFileSync(sqlPath, "utf8");
    await pool.query(sql);
  } catch (err) {
    console.warn("execution schema fallback — ensure flow schema ran first", err instanceof Error ? err.message : err);
  }
}

export async function insertExecution(
  pool: pg.Pool,
  row: {
    wallet: string;
    workflowType: string;
    workflowVersion: string;
    immutableInput: unknown;
    inputHash: string;
    phase: string;
    conversationId?: string;
    paymentMode?: string;
    idempotencyKey?: string;
  },
): Promise<ExecutionRow> {
  const { rows } = await pool.query<ExecutionRow>(
    `INSERT INTO executions (
       wallet, conversation_id, workflow_type, workflow_version,
       immutable_input, input_hash, phase, payment_mode, idempotency_key
     )
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
     RETURNING *`,
    [
      row.wallet,
      row.conversationId ?? null,
      row.workflowType,
      row.workflowVersion,
      JSON.stringify(row.immutableInput ?? {}),
      row.inputHash,
      row.phase,
      row.paymentMode ?? "none",
      row.idempotencyKey ?? null,
    ],
  );
  return rows[0]!;
}

export async function getExecutionById(pool: pg.Pool, id: string): Promise<ExecutionRow | null> {
  const { rows } = await pool.query<ExecutionRow>(`SELECT * FROM executions WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function getExecutionByIdempotencyKey(
  pool: pg.Pool,
  idempotencyKey: string,
): Promise<ExecutionRow | null> {
  const { rows } = await pool.query<ExecutionRow>(
    `SELECT * FROM executions WHERE idempotency_key = $1`,
    [idempotencyKey],
  );
  return rows[0] ?? null;
}

export async function updateExecutionPhase(
  pool: pg.Pool,
  id: string,
  phase: string,
  status = "active",
  errorJson?: unknown,
): Promise<ExecutionRow> {
  const { rows } = await pool.query<ExecutionRow>(
    `UPDATE executions
     SET phase = $2, status = $3, error_json = $4::jsonb, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, phase, status, errorJson != null ? JSON.stringify(errorJson) : null],
  );
  return rows[0]!;
}

export async function getNextEventSeq(pool: pg.Pool, executionId: string): Promise<number> {
  const { rows } = await pool.query<{ next_seq: string }>(
    `SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM execution_events WHERE execution_id = $1`,
    [executionId],
  );
  return Number(rows[0]?.next_seq ?? 1);
}

export async function insertExecutionEvent(
  pool: pg.Pool,
  input: {
    executionId: string;
    seq: number;
    eventType: string;
    phase?: string;
    payload?: unknown;
  },
): Promise<ExecutionEventRow> {
  const { rows } = await pool.query<ExecutionEventRow>(
    `INSERT INTO execution_events (execution_id, seq, event_type, phase, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING *`,
    [
      input.executionId,
      input.seq,
      input.eventType,
      input.phase ?? null,
      JSON.stringify(input.payload ?? {}),
    ],
  );
  return rows[0]!;
}

export async function listExecutionEvents(
  pool: pg.Pool,
  executionId: string,
  afterSeq = 0,
): Promise<ExecutionEventRow[]> {
  const { rows } = await pool.query<ExecutionEventRow>(
    `SELECT * FROM execution_events
     WHERE execution_id = $1 AND seq > $2
     ORDER BY seq ASC
     LIMIT 500`,
    [executionId, afterSeq],
  );
  return rows;
}

export async function insertExecutionQuote(
  pool: pg.Pool,
  input: {
    executionId: string;
    provider: string;
    priceUsdt0?: bigint;
    feesJson?: unknown;
    etaSeconds?: number;
    expiresAt: Date;
    quoteHash: string;
    sourceTimestamps?: unknown;
    rawQuote?: unknown;
  },
): Promise<{ id: string }> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO execution_quotes (
       execution_id, provider, price_usdt0, fees_json, eta_seconds,
       expires_at, quote_hash, source_timestamps, raw_quote
     )
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8::jsonb, $9::jsonb)
     RETURNING id`,
    [
      input.executionId,
      input.provider,
      input.priceUsdt0 ?? null,
      JSON.stringify(input.feesJson ?? {}),
      input.etaSeconds ?? null,
      input.expiresAt,
      input.quoteHash,
      JSON.stringify(input.sourceTimestamps ?? {}),
      JSON.stringify(input.rawQuote ?? {}),
    ],
  );
  return rows[0]!;
}

export async function insertRiskDecision(
  pool: pg.Pool,
  input: {
    executionId: string;
    policyVersion: string;
    decision: "allow" | "block" | "review";
    reason?: string;
    budgetJson?: unknown;
    simulationJson?: unknown;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO execution_risk_decisions (
       execution_id, policy_version, decision, reason, budget_json, simulation_json
     )
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
    [
      input.executionId,
      input.policyVersion,
      input.decision,
      input.reason ?? null,
      JSON.stringify(input.budgetJson ?? {}),
      JSON.stringify(input.simulationJson ?? {}),
    ],
  );
}

export async function insertExecutionReceipt(
  pool: pg.Pool,
  input: {
    executionId: string;
    receiptJson?: unknown;
    explorerLinks?: unknown;
    providerEvidence?: unknown;
    artifactRefs?: unknown;
    verificationJson?: unknown;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO execution_receipts (
       execution_id, receipt_json, explorer_links, provider_evidence, artifact_refs, verification_json
     )
     VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb)
     ON CONFLICT (execution_id) DO UPDATE SET
       receipt_json = EXCLUDED.receipt_json,
       explorer_links = EXCLUDED.explorer_links,
       provider_evidence = EXCLUDED.provider_evidence,
       artifact_refs = EXCLUDED.artifact_refs,
       verification_json = EXCLUDED.verification_json`,
    [
      input.executionId,
      JSON.stringify(input.receiptJson ?? {}),
      JSON.stringify(input.explorerLinks ?? {}),
      JSON.stringify(input.providerEvidence ?? {}),
      JSON.stringify(input.artifactRefs ?? {}),
      JSON.stringify(input.verificationJson ?? {}),
    ],
  );
}

export function toExecutionDto(row: ExecutionRow) {
  return {
    id: row.id,
    wallet: row.wallet,
    conversationId: row.conversation_id,
    workflowType: row.workflow_type,
    workflowVersion: row.workflow_version,
    immutableInput: row.immutable_input,
    inputHash: row.input_hash,
    phase: row.phase,
    status: row.status,
    activeStep: row.active_step,
    paymentMode: row.payment_mode,
    executorType: row.executor_type,
    quoteId: row.quote_id,
    idempotencyKey: row.idempotency_key,
    error: row.error_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toEventDto(row: ExecutionEventRow) {
  return {
    id: row.id,
    executionId: row.execution_id,
    seq: row.seq,
    type: row.event_type,
    phase: row.phase,
    payload: row.payload,
    createdAt: row.created_at,
  };
}
