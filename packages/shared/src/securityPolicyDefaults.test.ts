import { describe, expect, it } from "vitest";
import {
  DEFAULT_SECURITY_POLICY,
  isLegacyTightDefaultPolicy,
  migrateStoredPolicy,
} from "../../../apps/api/src/securityPolicy.js";

describe("security policy demo defaults", () => {
  it("allows a standard 1 USDT0 Coston2 demo spend under defaults", () => {
    expect(DEFAULT_SECURITY_POLICY.perJobLimitUsdt0).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_SECURITY_POLICY.dailySpendUsdt0).toBeGreaterThanOrEqual(
      DEFAULT_SECURITY_POLICY.perJobLimitUsdt0,
    );
    expect(DEFAULT_SECURITY_POLICY.perJobLimitUsdt0).toBe(10);
    expect(DEFAULT_SECURITY_POLICY.dailySpendUsdt0).toBe(50);
  });

  it("bumps legacy 5 / 0.1 Redis policies that blocked first Flow swaps", () => {
    const legacy = {
      ...DEFAULT_SECURITY_POLICY,
      dailySpendUsdt0: 5,
      perJobLimitUsdt0: 0.1,
      emergencyPause: false,
    };
    expect(isLegacyTightDefaultPolicy(legacy)).toBe(true);
    const migrated = migrateStoredPolicy(legacy);
    expect(migrated.perJobLimitUsdt0).toBe(10);
    expect(migrated.dailySpendUsdt0).toBe(50);
  });

  it("does not rewrite intentionally tight custom policies", () => {
    const custom = {
      ...DEFAULT_SECURITY_POLICY,
      dailySpendUsdt0: 2,
      perJobLimitUsdt0: 0.5,
    };
    expect(isLegacyTightDefaultPolicy(custom)).toBe(false);
    expect(migrateStoredPolicy(custom).perJobLimitUsdt0).toBe(0.5);
  });
});
