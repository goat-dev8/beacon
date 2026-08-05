import type { JobStatus } from "./types";

/** Real Flare / Coston2 rails behind each desk stage. */
export interface FlareStep {
  id: string;
  label: string;
  detail: string;
  statusKey: JobStatus | "LOCK";
}

export const FLARE_STEPS: FlareStep[] = [
  {
    id: "wallet",
    label: "Wallet on Flare Coston2",
    detail: "EIP-1193 connect · chain 114",
    statusKey: "LOCK",
  },
  {
    id: "auth",
    label: "EIP-3009 authorization",
    detail: "TransferWithAuthorization typed data signed in MetaMask",
    statusKey: "AUTHORIZED",
  },
  {
    id: "lock",
    label: "BeaconEscrow.lockWithAuthorization",
    detail: "Funds locked on Coston2 until quality passes",
    statusKey: "AUTHORIZED",
  },
  {
    id: "generate",
    label: "Generate + compose",
    detail: "Off-chain media (Flux) · settlement stays on Flare Coston2",
    statusKey: "GENERATING",
  },
  {
    id: "accept",
    label: "Acceptance gates",
    detail: "L1 objective · L2 judge · L3 brand, escrow pays only on pass",
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
    label: "Receipt sealed",
    detail: "On-chain lock tx + settlement recorded",
    statusKey: "CLOSED",
  },
];

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
    if (i >= 0 && i <= acceptIdx) return "done";
    if (step.id === "settle") return "active";
    return "todo";
  }

  const cur = ORDER.indexOf(status);
  const stepIdx = ORDER.indexOf(step.statusKey as JobStatus);
  if (stepIdx < 0) return "todo";
  if (status === "CLOSED" || status === "PASSED") {
    return stepIdx <= ORDER.indexOf(status === "PASSED" ? "PASSED" : "CLOSED") ? "done" : "todo";
  }
  if (cur > stepIdx) return "done";
  if (cur === stepIdx || (step.statusKey === "GENERATING" && (status === "COMPOSING" || status === "PREPARING")))
    return "active";
  if (step.statusKey === "GENERATING" && status === "PREPARING") return "active";
  return "todo";
}
