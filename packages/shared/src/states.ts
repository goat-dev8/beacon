import { AppError } from "./errors.js";

export const JobStatus = {
  DRAFT: "DRAFT",
  QUOTING: "QUOTING",
  QUOTED: "QUOTED",
  AUTHORIZED: "AUTHORIZED",
  PREPARING: "PREPARING",
  GENERATING: "GENERATING",
  COMPOSING: "COMPOSING",
  ACCEPTING: "ACCEPTING",
  NEEDS_LOOK: "NEEDS_LOOK",
  PASSED: "PASSED",
  FAILED: "FAILED",
  SETTLING: "SETTLING",
  REFUSING: "REFUSING",
  CLOSED: "CLOSED",
  EXPIRED: "EXPIRED",
  CANCELED: "CANCELED",
} as const;

export type JobStatusValue = (typeof JobStatus)[keyof typeof JobStatus];

export type JobTransitionTrigger =
  | "create_job"
  | "sealed_fit_fit"
  | "sealed_fit_no_fit"
  | "sealed_fit_error"
  | "user_approve"
  | "quote_expired"
  | "orchestrator_prepare"
  | "stages_start"
  | "generation_done"
  | "generation_failed"
  | "artifacts_ready"
  | "accept_report"
  | "user_look"
  | "settler_pass"
  | "settler_fail"
  | "terminal_close"
  | "user_cancel";

const TRANSITIONS: Record<
  JobStatusValue,
  Partial<Record<JobTransitionTrigger, JobStatusValue>>
> = {
  DRAFT: { create_job: JobStatus.QUOTING },
  QUOTING: {
    sealed_fit_fit: JobStatus.QUOTED,
    sealed_fit_no_fit: JobStatus.FAILED,
    sealed_fit_error: JobStatus.FAILED,
  },
  QUOTED: {
    user_approve: JobStatus.AUTHORIZED,
    quote_expired: JobStatus.EXPIRED,
    user_cancel: JobStatus.CANCELED,
  },
  AUTHORIZED: { orchestrator_prepare: JobStatus.PREPARING },
  PREPARING: { stages_start: JobStatus.GENERATING },
  GENERATING: {
    generation_done: JobStatus.COMPOSING,
    generation_failed: JobStatus.FAILED,
  },
  COMPOSING: { artifacts_ready: JobStatus.ACCEPTING },
  ACCEPTING: { accept_report: JobStatus.PASSED },
  NEEDS_LOOK: {
    user_look: JobStatus.PASSED,
    accept_report: JobStatus.FAILED,
  },
  PASSED: { settler_pass: JobStatus.SETTLING },
  FAILED: { settler_fail: JobStatus.REFUSING },
  SETTLING: { terminal_close: JobStatus.CLOSED },
  REFUSING: { terminal_close: JobStatus.CLOSED },
  CLOSED: {},
  EXPIRED: {},
  CANCELED: {},
};

export function canTransition(
  from: JobStatusValue,
  trigger: JobTransitionTrigger,
): boolean {
  return TRANSITIONS[from]?.[trigger] !== undefined;
}

export function transition(
  from: JobStatusValue,
  trigger: JobTransitionTrigger,
  acceptOutcome?: "PASS" | "FAIL" | "NEEDS_LOOK",
): JobStatusValue {
  if (from === JobStatus.ACCEPTING && trigger === "accept_report") {
    if (!acceptOutcome) {
      throw new AppError("INVALID_TRANSITION", {
        message: "Acceptance outcome is required.",
      });
    }
    if (acceptOutcome === "NEEDS_LOOK") return JobStatus.NEEDS_LOOK;
    if (acceptOutcome === "PASS") return JobStatus.PASSED;
    return JobStatus.FAILED;
  }

  if (from === JobStatus.NEEDS_LOOK && trigger === "user_look") {
    if (!acceptOutcome || (acceptOutcome !== "PASS" && acceptOutcome !== "FAIL")) {
      throw new AppError("INVALID_TRANSITION", {
        message: "User look must resolve to pass or fail.",
      });
    }
    return acceptOutcome === "PASS" ? JobStatus.PASSED : JobStatus.FAILED;
  }

  const next = TRANSITIONS[from]?.[trigger];
  if (!next) {
    throw new AppError("INVALID_TRANSITION", {
      details: { from, trigger },
    });
  }
  return next;
}

export function isTerminal(status: JobStatusValue): boolean {
  return (
    status === JobStatus.CLOSED ||
    status === JobStatus.EXPIRED ||
    status === JobStatus.CANCELED
  );
}

export function isActive(status: JobStatusValue): boolean {
  return !isTerminal(status) && status !== JobStatus.FAILED;
}
