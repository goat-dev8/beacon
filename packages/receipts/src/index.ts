import { newId } from "@beacon/shared";

export interface ReceiptOfferBinding {
  offerId: string;
  briefHash: string;
  rubricHash: string;
  priceUsdt0: string;
}

export interface ReceiptAcceptBinding {
  acceptId: string;
  result: "PASS" | "FAIL" | "NEEDS_LOOK";
  confidence: number;
  summary: string;
}

export interface ReceiptPaymentBinding {
  paymentId: string;
  txHash?: string;
  settled: boolean;
  amountUsdt0: string;
}

export interface ReceiptArtifactRef {
  kind: string;
  uri: string;
  sha256?: string;
}

export interface BeaconReceipt {
  id: string;
  version: "1.0";
  jobId: string;
  serviceId: string;
  createdAt: string;
  offer: ReceiptOfferBinding;
  accept: ReceiptAcceptBinding;
  payment: ReceiptPaymentBinding;
  artifacts: ReceiptArtifactRef[];
  display: {
    title: string;
    priceDisplay: string;
    statusLabel: string;
  };
}

export interface BuildReceiptInput {
  jobId: string;
  serviceId: string;
  offer: ReceiptOfferBinding;
  accept: ReceiptAcceptBinding;
  payment: ReceiptPaymentBinding;
  artifacts?: ReceiptArtifactRef[];
  priceDisplay?: string;
}

export function buildReceipt(input: BuildReceiptInput): BeaconReceipt {
  const settled = input.payment.settled && input.accept.result === "PASS";
  return {
    id: newId(),
    version: "1.0",
    jobId: input.jobId,
    serviceId: input.serviceId,
    createdAt: new Date().toISOString(),
    offer: input.offer,
    accept: input.accept,
    payment: input.payment,
    artifacts: input.artifacts ?? [],
    display: {
      title: `${capitalize(input.serviceId)} job`,
      priceDisplay: input.priceDisplay ?? formatUsdt(input.payment.amountUsdt0),
      statusLabel: settled ? "Paid" : input.accept.result === "FAIL" ? "Not charged" : "Pending",
    },
  };
}

function formatUsdt(amount: string): string {
  const value = BigInt(amount);
  const whole = value / 1_000_000n;
  const frac = value % 1_000_000n;
  return `$${whole}.${frac.toString().padStart(6, "0").replace(/0+$/, "") || "00"}`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function validateReceipt(receipt: BeaconReceipt): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!receipt.id) errors.push("Missing receipt id");
  if (!receipt.jobId) errors.push("Missing job id");
  if (!receipt.offer.offerId) errors.push("Missing offer binding");
  if (!receipt.accept.acceptId) errors.push("Missing accept binding");
  if (!receipt.payment.paymentId) errors.push("Missing payment binding");
  if (receipt.payment.settled && receipt.accept.result !== "PASS") {
    errors.push("Settled payment requires PASS accept result");
  }
  return { valid: errors.length === 0, errors };
}
