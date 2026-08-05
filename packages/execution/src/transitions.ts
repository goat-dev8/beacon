import type { ExecutionPhase } from "./types.js";

export class ExecutionTransitionError extends Error {
  readonly from: ExecutionPhase;
  readonly to: ExecutionPhase;

  constructor(from: ExecutionPhase, to: ExecutionPhase) {
    super(`Illegal execution phase transition: ${from} -> ${to}`);
    this.name = "ExecutionTransitionError";
    this.from = from;
    this.to = to;
  }
}

/** Phases with no outgoing transitions (terminal). */
export const TERMINAL_PHASES: ReadonlySet<ExecutionPhase> = new Set([
  "completed",
  "canceled",
  "expired",
  "refunded",
]);

/**
 * Allowed forward transitions for the universal execution lifecycle.
 * Same-phase transitions are always permitted for idempotent replays.
 */
export const ALLOWED_TRANSITIONS: Readonly<
  Record<ExecutionPhase, readonly ExecutionPhase[]>
> = {
  understanding: ["clarifying", "job_created", "canceled"],
  clarifying: ["understanding", "job_created", "canceled"],
  job_created: ["quoting", "failed", "canceled"],
  quoting: [
    "risk_checking",
    "awaiting_authorization",
    "expired",
    "failed",
    "canceled",
  ],
  risk_checking: [
    "awaiting_authorization",
    "authorized",
    "blocked",
    "failed",
    "canceled",
  ],
  awaiting_authorization: ["authorized", "expired", "canceled", "failed"],
  authorized: ["executing", "canceled", "failed"],
  executing: ["observing", "failed"],
  observing: ["verifying", "failed"],
  verifying: ["settling", "completed", "failed"],
  settling: ["completed", "refunded", "failed"],
  completed: [],
  blocked: ["risk_checking", "quoting", "canceled", "failed"],
  failed: ["refunded"],
  canceled: [],
  expired: [],
  refunded: [],
};

export function canTransition(from: ExecutionPhase, to: ExecutionPhase): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: ExecutionPhase, to: ExecutionPhase): void {
  if (!canTransition(from, to)) {
    throw new ExecutionTransitionError(from, to);
  }
}

export function isTerminalPhase(phase: ExecutionPhase): boolean {
  return TERMINAL_PHASES.has(phase);
}
