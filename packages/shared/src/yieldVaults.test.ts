import { describe, expect, it } from "vitest";
import {
  FIRELIGHT_VAULT_COSTON2,
  UPSHIFT_VAULT_COSTON2,
  COSTON2_CHAIN_ID,
} from "./yieldVaults.js";

describe("yieldVaults constants", () => {
  it("documents Coston2 vault addresses + chain", () => {
    expect(COSTON2_CHAIN_ID).toBe(114);
    expect(FIRELIGHT_VAULT_COSTON2.toLowerCase()).toBe(
      "0xC90D6847747b85d1fa2E07859869fb9fB72c0361".toLowerCase(),
    );
    expect(UPSHIFT_VAULT_COSTON2.toLowerCase()).toBe(
      "0x24c1a47cD5e8473b64EAB2a94515a196E10C7C81".toLowerCase(),
    );
  });
});
