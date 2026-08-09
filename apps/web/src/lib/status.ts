import type { JobStatus } from "./types";

/** Consumer-facing stage labels, never expose protocol jargon. */
export function statusLabel(status: JobStatus): string {
  const map: Record<JobStatus, string> = {
    DRAFT: "Draft",
    QUOTING: "Preparing your quote",
    QUOTED: "Ready to approve",
    AUTHORIZED: "Escrow locked · starting",
    PREPARING: "Starting pipeline",
    GENERATING: "Generating & composing",
    COMPOSING: "Deliverable ready",
    ACCEPTING: "Checking quality",
    NEEDS_LOOK: "Needs a quick look",
    PASSED: "Passed",
    FAILED: "Not charged",
    SETTLING: "Releasing escrow",
    REFUSING: "Refunding escrow",
    CLOSED: "Complete",
    EXPIRED: "Quote expired",
    CANCELED: "Canceled",
  };
  return map[status] ?? status;
}

export function statusProgress(status: JobStatus): number {
  const order: JobStatus[] = [
    "DRAFT",
    "QUOTING",
    "QUOTED",
    "AUTHORIZED",
    "PREPARING",
    "GENERATING",
    "COMPOSING",
    "ACCEPTING",
    "NEEDS_LOOK",
    "PASSED",
    "SETTLING",
    "CLOSED",
  ];
  const i = order.indexOf(status);
  if (status === "FAILED" || status === "REFUSING" || status === "EXPIRED" || status === "CANCELED") {
    return 100;
  }
  if (i < 0) return 0;
  return Math.round((i / (order.length - 1)) * 100);
}

export const LIVE_STATUSES: JobStatus[] = [
  "AUTHORIZED",
  "PREPARING",
  "GENERATING",
  "COMPOSING",
  "ACCEPTING",
  "SETTLING",
];

export const TERMINAL_STATUSES: JobStatus[] = [
  "CLOSED",
  "FAILED",
  "REFUSING",
  "EXPIRED",
  "CANCELED",
];
