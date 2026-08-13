import { describe, expect, it } from "vitest";
import {
  DEFAULT_SECURITY_POLICY,
  isLegacyTightDefaultPolicy,
  isSessionExpired,
  migrateStoredPolicy,
  recordSpendUsdt0,
  reverseSpendUsdt0,
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

  it("restores general / signals / research so Flow chat is not bricked", () => {
    const stored = {
      ...DEFAULT_SECURITY_POLICY,
      allowedAgents: ["swap", "bridge", "desk"],
    };
    const migrated = migrateStoredPolicy(stored);
    expect(migrated.allowedAgents).toEqual(expect.arrayContaining(["general", "signals", "research", "swap"]));
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

  it("reverseSpendUsdt0 is a no-op without Redis", async () => {
    expect(await reverseSpendUsdt0(null, "0xabc", 1)).toBe(0);
  });

  it("reverseSpendUsdt0 subtracts the UTC-day spend window after a refund", async () => {
    const store = new Map<string, number>();
    const redis = {
      get: async (key: string) => store.get(key) ?? 0,
      set: async (key: string, value: number) => {
        store.set(key, value);
      },
    };
    const wallet = "0xAbC";
    await recordSpendUsdt0(redis as never, wallet, 0.008);
    expect(await reverseSpendUsdt0(redis as never, wallet, 0.008)).toBe(0);
    expect(await reverseSpendUsdt0(redis as never, wallet, 1)).toBe(0);
  });

  it("does not expire a policy that only has updatedAt", () => {
    const stale = {
      ...DEFAULT_SECURITY_POLICY,
      updatedAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
    };
    expect(isSessionExpired(stale)).toBe(false);
  });

  it("expires only when sessionStartedAt is older than sessionExpiryHours", () => {
    const expired = {
      ...DEFAULT_SECURITY_POLICY,
      sessionExpiryHours: 24,
      sessionStartedAt: new Date(Date.now() - 25 * 3600 * 1000).toISOString(),
    };
    expect(isSessionExpired(expired)).toBe(true);
    expect(
      isSessionExpired({
        ...expired,
        sessionExpiryHours: 0,
      }),
    ).toBe(false);
  });
});
