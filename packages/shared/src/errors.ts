import { sanitizeUserMessage, userMessageForCode } from "./copy.js";

export type ErrorCode =
  | "NO_FIT"
  | "QUOTE_TIMEOUT"
  | "JOB_NOT_FOUND"
  | "OFFER_EXPIRED"
  | "INVALID_TRANSITION"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "VALIDATION"
  | "PAYMENT_REQUIRED"
  | "PAYMENT_FAILED"
  | "SETTLE_FAILED"
  | "PIPELINE_FAILED"
  | "ACCEPT_FAILED"
  | "SERVICE_UNAVAILABLE"
  | "RATE_LIMITED"
  | "INTERNAL"
  | "NOT_READY"
  | "ARTIFACT_MISSING"
  | "CREDIT_PREP_FAILED";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly userMessage: string;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(
    code: ErrorCode,
    options?: { message?: string; statusCode?: number; details?: unknown; cause?: unknown },
  ) {
    const userMessage = sanitizeUserMessage(options?.message ?? userMessageForCode(code));
    super(userMessage, { cause: options?.cause });
    this.name = "AppError";
    this.code = code;
    this.userMessage = userMessage;
    this.statusCode = options?.statusCode ?? statusForCode(code);
    this.details = options?.details;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.userMessage,
      },
    };
  }
}

function statusForCode(code: ErrorCode): number {
  switch (code) {
    case "UNAUTHORIZED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "JOB_NOT_FOUND":
    case "ARTIFACT_MISSING":
      return 404;
    case "VALIDATION":
    case "NO_FIT":
    case "OFFER_EXPIRED":
    case "INVALID_TRANSITION":
      return 400;
    case "PAYMENT_REQUIRED":
      return 402;
    case "RATE_LIMITED":
      return 429;
    case "NOT_READY":
    case "SERVICE_UNAVAILABLE":
      return 503;
    default:
      return 500;
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
