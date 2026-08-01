import type { ErrorCode } from "./errors.js";

const USER_MESSAGES: Record<ErrorCode, string> = {
  NO_FIT: "We can't take this job as described. Try simplifying the brief or choosing a different service.",
  QUOTE_TIMEOUT: "We couldn't prepare a quote in time. Please try again.",
  JOB_NOT_FOUND: "We couldn't find that job.",
  OFFER_EXPIRED: "This quote has expired. Request a new quote to continue.",
  INVALID_TRANSITION: "This action isn't available for the job right now.",
  UNAUTHORIZED: "Please sign in to continue.",
  FORBIDDEN: "You don't have access to this job.",
  VALIDATION: "Please check your input and try again.",
  PAYMENT_REQUIRED: "Work credit or approval is required before we can continue.",
  PAYMENT_FAILED: "We couldn't complete the payment step. You have not been charged.",
  SETTLE_FAILED: "We finished your job but couldn't finalize billing. Our team has been notified.",
  PIPELINE_FAILED: "We couldn't finish this job. You have not been charged.",
  ACCEPT_FAILED: "Quality checks did not pass. You have not been charged.",
  SERVICE_UNAVAILABLE: "Beacon is temporarily unavailable. Please try again shortly.",
  RATE_LIMITED: "Too many requests. Please wait a moment and try again.",
  INTERNAL: "Something went wrong on our side. Please try again.",
  NOT_READY: "Beacon is still starting up. Please try again in a moment.",
  ARTIFACT_MISSING: "The requested result isn't ready yet.",
  CREDIT_PREP_FAILED: "We couldn't prepare the add-credit flow. Please try again.",
};

const FORBIDDEN_WORDS = [
  /\bfcc\b/i,
  /\btee\b/i,
  /\bx402\b/i,
  /\bfdc\b/i,
  /\bfassets?\b/i,
  /\bsmart\s+accounts?\b/i,
  /\beip[- ]?3009\b/i,
  /\bescrow\b/i,
  /\bfacilitator\b/i,
  /\bflare\s+compute\b/i,
  /\bsealed\s+fit\b/i,
  /\bbound\s+offer\b/i,
];

export function userMessageForCode(code: ErrorCode): string {
  return USER_MESSAGES[code] ?? USER_MESSAGES.INTERNAL;
}

export function sanitizeUserMessage(message: string): string {
  let out = message;
  for (const pattern of FORBIDDEN_WORDS) {
    if (pattern.test(out)) {
      return USER_MESSAGES.INTERNAL;
    }
  }
  return out;
}

export const COPY = {
  preparing: "Preparing your job",
  generating: "Generating",
  composing: "Assembling your deliverable",
  checking: "Checking quality",
  needsLook: "Needs a quick look",
  done: "Done",
  notCharged: "Not charged",
  addCredit: "Add credit",
  approve: "Approve",
  quote: "Quote",
  receipt: "Receipt",
  workCredit: "Work credit",
} as const;
