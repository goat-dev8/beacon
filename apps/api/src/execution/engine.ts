import type pg from "pg";
import type { Redis } from "@upstash/redis";
import {
  assertTransition,
  hashImmutableInput,
  type ExecutionPhase,
  type ExecutionEventType,
} from "@beacon/execution";
import { AppError } from "@beacon/shared";
import { evaluatePolicy } from "../policyEvaluator.js";
import { getWorkflowRegistry } from "./workflows.js";
import {
  getExecutionById,
  getExecutionByIdempotencyKey,
  getNextEventSeq,
  insertExecution,
  insertExecutionEvent,
  insertRiskDecision,
  toEventDto,
  toExecutionDto,
  updateExecutionPhase,
  type ExecutionRow,
} from "./store.js";

export async function createExecution(
  pool: pg.Pool,
  input: {
    wallet: string;
    workflowType: string;
    workflowVersion?: string;
    immutableInput?: unknown;
    conversationId?: string;
    idempotencyKey?: string;
  },
) {
  const version = input.workflowVersion ?? "1";
  const registry = getWorkflowRegistry();
  if (!registry.has(input.workflowType, version)) {
    throw new AppError("VALIDATION", {
      message: `Unknown workflow type: ${input.workflowType}@${version}`,
    });
  }

  if (input.idempotencyKey) {
    const existing = await getExecutionByIdempotencyKey(pool, input.idempotencyKey);
    if (existing) {
      return { execution: toExecutionDto(existing), created: false };
    }
  }

  const immutableInput = input.immutableInput ?? {};
  const inputHash = hashImmutableInput(immutableInput);
  const row = await insertExecution(pool, {
    wallet: input.wallet,
    workflowType: input.workflowType,
    workflowVersion: version,
    immutableInput,
    inputHash,
    phase: "job_created",
    conversationId: input.conversationId,
    idempotencyKey: input.idempotencyKey,
  });

  await appendEvent(pool, row.id, {
    type: "phase_changed",
    phase: "job_created",
    payload: { reason: "execution_created", workflowType: input.workflowType, inputHash },
  });

  return { execution: toExecutionDto(row), created: true };
}

export async function appendEvent(
  pool: pg.Pool,
  executionId: string,
  input: {
    type: ExecutionEventType;
    phase?: ExecutionPhase;
    payload?: unknown;
  },
) {
  const seq = await getNextEventSeq(pool, executionId);
  const row = await insertExecutionEvent(pool, {
    executionId,
    seq,
    eventType: input.type,
    phase: input.phase,
    payload: input.payload,
  });
  return toEventDto(row);
}

export async function transitionPhase(
  pool: pg.Pool,
  redis: Redis | null,
  executionId: string,
  toPhase: ExecutionPhase,
  reason?: string,
) {
  const row = await getExecutionById(pool, executionId);
  if (!row) {
    throw new AppError("JOB_NOT_FOUND", { message: "Execution not found." });
  }

  const fromPhase = row.phase as ExecutionPhase;
  assertTransition(fromPhase, toPhase);

  if (toPhase === "risk_checking") {
    await runRiskChecking(pool, redis, row);
  }

  const terminalStatuses = new Set(["completed", "canceled", "expired", "refunded", "failed", "blocked"]);
  const status = terminalStatuses.has(toPhase) ? toPhase : "active";
  const updated = await updateExecutionPhase(pool, executionId, toPhase, status);

  const event = await appendEvent(pool, executionId, {
    type: "phase_changed",
    phase: toPhase,
    payload: { from: fromPhase, to: toPhase, reason: reason ?? null },
  });

  return { execution: toExecutionDto(updated), event };
}

export async function runRiskChecking(pool: pg.Pool, redis: Redis | null, row: ExecutionRow) {
  const input = (row.immutable_input ?? {}) as Record<string, unknown>;
  const amountUsdt0 =
    typeof input.amountUsdt0 === "number"
      ? input.amountUsdt0
      : typeof input.priceUsdt0 === "number"
        ? input.priceUsdt0
        : undefined;

  const decision = await evaluatePolicy(redis, {
    wallet: row.wallet,
    workflowType: row.workflow_type,
    amountUsdt0,
    chainId: typeof input.chainId === "number" ? input.chainId : 114,
  });

  await insertRiskDecision(pool, {
    executionId: row.id,
    policyVersion: decision.policyVersion,
    decision: decision.allowed ? "allow" : "block",
    reason: decision.reason,
    budgetJson: decision.checks,
    simulationJson: { enforcement: decision.enforcement, fccMode: decision.fccMode },
  });

  await appendEvent(pool, row.id, {
    type: "risk_decided",
    phase: "risk_checking",
    payload: decision,
  });

  if (!decision.allowed) {
    await updateExecutionPhase(pool, row.id, "blocked", "blocked", {
      reason: decision.reason,
      policyVersion: decision.policyVersion,
    });
    throw new AppError("VALIDATION", { message: decision.reason });
  }

  return decision;
}

export async function authorizeExecution(
  pool: pg.Pool,
  redis: Redis | null,
  executionId: string,
) {
  const row = await getExecutionById(pool, executionId);
  if (!row) {
    throw new AppError("JOB_NOT_FOUND", { message: "Execution not found." });
  }

  await runRiskChecking(pool, redis, row);
  return transitionPhase(pool, redis, executionId, "awaiting_authorization", "risk_passed");
}
