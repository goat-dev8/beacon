import type { BeaconEnv } from "./env.js";

/**
 * Hard gate: Beacon is a Flare Coston2 product.
 * Call before app.listen when FLARE_REQUIRED is not explicitly "false".
 */
export function assertFlareRequired(env: BeaconEnv): void {
  const required = (env.FLARE_REQUIRED || "true").toLowerCase() !== "false";
  if (!required) return;

  const issues: string[] = [];
  if (Number(env.CHAIN_ID) !== 114) {
    issues.push(`CHAIN_ID must be 114 (Coston2), got ${env.CHAIN_ID}`);
  }
  if ((env.NETWORK_NAME || "").toLowerCase() !== "coston2") {
    issues.push(`NETWORK_NAME must be coston2, got ${env.NETWORK_NAME}`);
  }
  if (!(env.COSTON2_RPC_URL || "").includes("flare")) {
    issues.push("COSTON2_RPC_URL must point at a Flare Coston2 RPC");
  }
  for (const key of [
    "BEACON_ESCROW",
    "X402_TOKEN_ADDRESS",
    "X402_FACILITATOR_ADDRESS",
    "BEACON_JOB_REGISTRY",
    "FLARE_CONTRACT_REGISTRY",
  ] as const) {
    if (!(env[key] || "").trim()) issues.push(`Missing ${key}`);
  }

  if (issues.length) {
    throw new Error(
      `Flare rails required (see flare-ai-skills / .cursor/skills/flare-*). ${issues.join("; ")}`,
    );
  }
}
