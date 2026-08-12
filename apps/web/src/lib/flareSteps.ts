import type { JobStatus } from "./types";

/** Real Flare / Coston2 rails behind each desk stage. */
export interface FlareStep {
  id: string;
  label: string;
  detail: string;
  statusKey: JobStatus | "LOCK";
}

/** Wallet ERC-20 lockFrom path (fallback). */
export const FLARE_STEPS_WALLET: FlareStep[] = [
  {
    id: "wallet",
    label: "Wallet on Flare Coston2",
    detail: "EIP-1193 connect · chain 114",
    statusKey: "LOCK",
  },
  {
    id: "auth",
    label: "USDT0 approve",
    detail: "Approve BeaconEscrow to pull Coston2 faucet USDT0",
    statusKey: "AUTHORIZED",
  },
  {
    id: "lock",
    label: "BeaconEscrow.lockFrom",
    detail: "Funds locked on Coston2 until quality passes",
    statusKey: "AUTHORIZED",
  },
  {
    id: "generate",
    label: "Generate + compose",
    detail: "Live generator + service composer · actual model/provider stored with artifacts",
    statusKey: "GENERATING",
  },
  {
    id: "accept",
    label: "Acceptance gates",
    detail: "L1 objective · L3 format/brand · L2 AI judge when available",
    statusKey: "ACCEPTING",
  },
  {
    id: "settle",
    label: "Escrow release / refund",
    detail: "releaseToPayee or refund on BeaconEscrow (Coston2)",
    statusKey: "SETTLING",
  },
  {
    id: "receipt",
    label: "Receipt recorded",
    detail: "Database receipt links the on-chain lock and release/refund transaction",
    statusKey: "CLOSED",
  },
];

/** Beacon Safe prepaid path (primary). */
export const FLARE_STEPS_SAFE: FlareStep[] = [
  {
    id: "safe",
    label: "Beacon Safe funded",
    detail: "Prepaid Coston2 USDT0 pool · policy caps on Coston2",
    statusKey: "LOCK",
  },
  {
    id: "spend",
    label: "Safe vault.execute(transfer)",
    detail: "Executor moves USDT0 Safe → BeaconEscrow (no MetaMask)",
    statusKey: "AUTHORIZED",
  },
  {
    id: "lock",
    label: "BeaconEscrow.lockPrepaid",
    detail: "Settler records prepaid lock · refunds return to Safe",
    statusKey: "AUTHORIZED",
  },
  {
    id: "generate",
    label: "Generate + compose",
    detail: "Live generator + service composer · actual model/provider stored with artifacts",
    statusKey: "GENERATING",
  },
  {
    id: "accept",
    label: "Acceptance gates",
    detail: "L1 objective · L3 format/brand · L2 AI judge when available",
    statusKey: "ACCEPTING",
  },
  {
    id: "settle",
    label: "Escrow release / refund",
    detail: "releaseToPayee or refund to Safe on BeaconEscrow (Coston2)",
    statusKey: "SETTLING",
  },
  {
    id: "receipt",
    label: "Receipt recorded",
    detail: "Database receipt links Safe spend, escrow lock, and release/refund transactions",
    statusKey: "CLOSED",
  },
];

/** @deprecated Use FLARE_STEPS_SAFE or FLARE_STEPS_WALLET */
export const FLARE_STEPS = FLARE_STEPS_WALLET;

const ORDER: JobStatus[] = [
  "AUTHORIZED",
  "PREPARING",
  "GENERATING",
  "COMPOSING",
  "ACCEPTING",
  "PASSED",
  "SETTLING",
  "CLOSED",
];

export function flareStepState(
  step: FlareStep,
  status: JobStatus | undefined,
  hasLock: boolean,
): "done" | "active" | "todo" {
  if (!status) return step.statusKey === "LOCK" && hasLock ? "done" : "todo";

  if (step.statusKey === "LOCK") {
    return hasLock || ORDER.indexOf(status) >= 0 ? "done" : "todo";
  }

  if (status === "FAILED" || status === "REFUSING") {
    const i = ORDER.indexOf(step.statusKey as JobStatus);
    const acceptIdx = ORDER.indexOf("ACCEPTING");
    // Generation failed before accept — mark generate as done/failed path, seal refund+receipt.
    if (status === "FAILED" && step.id === "generate") return "done";
    if (i >= 0 && i <= acceptIdx) return "done";
    if (step.id === "settle" || step.id === "receipt") return "done";
    return "todo";
  }

  const cur = ORDER.indexOf(status);
  const stepIdx = ORDER.indexOf(step.statusKey as JobStatus);
  if (stepIdx < 0) return "todo";
  if (status === "CLOSED" || status === "PASSED") {
    return "done";
  }
  if (cur > stepIdx) return "done";
  if (cur === stepIdx || (step.statusKey === "GENERATING" && (status === "COMPOSING" || status === "PREPARING")))
    return "active";
  if (step.statusKey === "GENERATING" && status === "PREPARING") return "active";
  return "todo";
}
