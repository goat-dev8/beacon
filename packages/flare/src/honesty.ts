/**
 * Honesty layer — integration status labels for Beacon's Flare protocol adapters.
 *
 * Every adapter method that interacts with Flare primitives must return an
 * IntegrationStatus so downstream components can:
 * - Display honest UI labels (e.g. "[Simulated]", "[Not Available]")
 * - Block unsafe operations when hardware attestation is expected but absent
 * - Log provenance for audits
 */

/**
 * REAL: Live on-chain / verified oracle / hardware-attested (evidence available)
 * SIMULATED: Using Coston2 SIMULATED_TEE or test mock — valid for hackathon/dev
 * NOT_AVAILABLE: Integration not configured / missing env / feature incomplete
 * STUB: Placeholder returning hardcoded values — never use in production paths
 */
export type IntegrationStatus = "REAL" | "SIMULATED" | "NOT_AVAILABLE" | "STUB";

export interface HonestyLabel {
  status: IntegrationStatus;
  reason: string;
  timestamp: number;
}

export function honestyLabel(
  status: IntegrationStatus,
  reason: string,
): HonestyLabel {
  return {
    status,
    reason,
    timestamp: Date.now(),
  };
}

export function isOperational(status: IntegrationStatus): boolean {
  return status === "REAL" || status === "SIMULATED";
}

export function requiresHardwareAttestation(status: IntegrationStatus): boolean {
  return status !== "REAL";
}
