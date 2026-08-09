/**
 * Unit tests for PriceOracleAdapter.evaluateExecutionGuard
 *
 * Tests blocking conditions:
 * - STALE: Feed older than maxAgeSeconds
 * - HIGH_DEVIATION: Price deviated from reference
 * - EXCESSIVE_SLIPPAGE: Quoted slippage exceeds max
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReadFtsoFeeds = vi.fn();

vi.mock("@beacon/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@beacon/shared")>();
  return {
    ...actual,
    readFtsoFeeds: () => mockReadFtsoFeeds(),
    loadEnv: () => ({}),
  };
});

import { PriceOracleAdapter } from "./priceOracle.js";

describe("PriceOracleAdapter", () => {
  let adapter: PriceOracleAdapter;
  const nowSeconds = Math.floor(Date.now() / 1000);

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new PriceOracleAdapter();
  });

  describe("evaluateExecutionGuard", () => {
    it("should allow when all conditions pass", async () => {
      mockReadFtsoFeeds.mockResolvedValue({
        ftsoV2: "0x123",
        timestamp: nowSeconds - 10,
        feeds: [
          {
            symbol: "XRP/USD",
            feedId: "0x01",
            value: 0.5,
            decimals: 7,
            raw: "5000000",
            timestamp: nowSeconds - 10,
          },
        ],
      });

      const result = await adapter.evaluateExecutionGuard({
        feedSymbol: "XRP/USD",
        maxAgeSeconds: 60,
        maxDeviationBps: 100,
        referencePrice: 0.5,
      });

      expect(result.allowed).toBe(true);
      expect(result.reasons).toHaveLength(0);
      expect(result.status).toBe("REAL");
    });

    it("should BLOCK when feed is STALE", async () => {
      mockReadFtsoFeeds.mockResolvedValue({
        ftsoV2: "0x123",
        timestamp: nowSeconds - 120,
        feeds: [
          {
            symbol: "XRP/USD",
            feedId: "0x01",
            value: 0.5,
            decimals: 7,
            raw: "5000000",
            timestamp: nowSeconds - 120,
          },
        ],
      });

      const result = await adapter.evaluateExecutionGuard({
        feedSymbol: "XRP/USD",
        maxAgeSeconds: 60,
      });

      expect(result.allowed).toBe(false);
      expect(result.reasons.length).toBeGreaterThan(0);
      expect(result.reasons[0]).toContain("STALE");
      expect(result.reasons[0]).toContain("BLOCK");
    });

    it("should BLOCK when deviation is HIGH", async () => {
      mockReadFtsoFeeds.mockResolvedValue({
        ftsoV2: "0x123",
        timestamp: nowSeconds - 5,
        feeds: [
          {
            symbol: "XRP/USD",
            feedId: "0x01",
            value: 0.55,
            decimals: 7,
            raw: "5500000",
            timestamp: nowSeconds - 5,
          },
        ],
      });

      const result = await adapter.evaluateExecutionGuard({
        feedSymbol: "XRP/USD",
        maxAgeSeconds: 60,
        maxDeviationBps: 50,
        referencePrice: 0.5,
      });

      expect(result.allowed).toBe(false);
      expect(result.reasons.length).toBeGreaterThan(0);
      expect(result.reasons[0]).toContain("HIGH_DEVIATION");
      expect(result.reasons[0]).toContain("BLOCK");
      expect(result.deviationBps).toBe(1000);
    });

    it("should BLOCK when slippage is EXCESSIVE", async () => {
      mockReadFtsoFeeds.mockResolvedValue({
        ftsoV2: "0x123",
        timestamp: nowSeconds - 5,
        feeds: [
          {
            symbol: "XRP/USD",
            feedId: "0x01",
            value: 0.5,
            decimals: 7,
            raw: "5000000",
            timestamp: nowSeconds - 5,
          },
        ],
      });

      const result = await adapter.evaluateExecutionGuard({
        feedSymbol: "XRP/USD",
        maxAgeSeconds: 60,
        maxSlippageBps: 50,
        quotedSlippageBps: 100,
      });

      expect(result.allowed).toBe(false);
      expect(result.reasons.length).toBeGreaterThan(0);
      expect(result.reasons[0]).toContain("EXCESSIVE_SLIPPAGE");
      expect(result.reasons[0]).toContain("BLOCK");
    });

    it("should BLOCK when feed is not found", async () => {
      mockReadFtsoFeeds.mockResolvedValue({
        ftsoV2: "0x123",
        timestamp: nowSeconds - 5,
        feeds: [
          {
            symbol: "FLR/USD",
            feedId: "0x01",
            value: 0.02,
            decimals: 7,
            raw: "200000",
            timestamp: nowSeconds - 5,
          },
        ],
      });

      const result = await adapter.evaluateExecutionGuard({
        feedSymbol: "XRP/USD",
        maxAgeSeconds: 60,
      });

      expect(result.allowed).toBe(false);
      expect(result.reasons.length).toBeGreaterThan(0);
      expect(result.reasons[0]).toContain("FEED_NOT_FOUND");
    });

    it("should accumulate multiple block reasons", async () => {
      mockReadFtsoFeeds.mockResolvedValue({
        ftsoV2: "0x123",
        timestamp: nowSeconds - 120,
        feeds: [
          {
            symbol: "XRP/USD",
            feedId: "0x01",
            value: 0.6,
            decimals: 7,
            raw: "6000000",
            timestamp: nowSeconds - 120,
          },
        ],
      });

      const result = await adapter.evaluateExecutionGuard({
        feedSymbol: "XRP/USD",
        maxAgeSeconds: 60,
        maxDeviationBps: 50,
        referencePrice: 0.5,
        maxSlippageBps: 50,
        quotedSlippageBps: 100,
      });

      expect(result.allowed).toBe(false);
      expect(result.reasons.length).toBe(3);
      expect(result.reasons.some((r) => r.includes("STALE"))).toBe(true);
      expect(result.reasons.some((r) => r.includes("HIGH_DEVIATION"))).toBe(true);
      expect(result.reasons.some((r) => r.includes("EXCESSIVE_SLIPPAGE"))).toBe(true);
    });
  });
});
