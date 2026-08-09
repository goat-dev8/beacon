import { describe, expect, it } from "vitest";
import { evaluateFtsoGuard } from "./ftsoGuard.js";

const baseFeeds = [
  { symbol: "XRP/USD", value: 2.5, timestamp: 1_700_000_000 },
  { symbol: "FLR/USD", value: 0.02, timestamp: 1_700_000_000 },
];

describe("evaluateFtsoGuard", () => {
  it("allows fresh feed within limits", () => {
    const r = evaluateFtsoGuard(baseFeeds, {
      feedSymbol: "XRP/USD",
      maxAgeSeconds: 300,
      nowSeconds: 1_700_000_030,
      maxSlippageBps: 200,
      quotedSlippageBps: 100,
    });
    expect(r.allowed).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it("blocks STALE price", () => {
    const r = evaluateFtsoGuard(baseFeeds, {
      feedSymbol: "XRP/USD",
      maxAgeSeconds: 60,
      nowSeconds: 1_700_000_200,
    });
    expect(r.allowed).toBe(false);
    expect(r.reasons[0]).toMatch(/STALE/);
  });

  it("blocks HIGH_DEVIATION", () => {
    const r = evaluateFtsoGuard(baseFeeds, {
      feedSymbol: "XRP/USD",
      maxAgeSeconds: 300,
      nowSeconds: 1_700_000_010,
      referencePrice: 2.0,
      maxDeviationBps: 100,
    });
    expect(r.allowed).toBe(false);
    expect(r.reasons[0]).toMatch(/HIGH_DEVIATION/);
  });

  it("blocks EXCESSIVE_SLIPPAGE", () => {
    const r = evaluateFtsoGuard(baseFeeds, {
      feedSymbol: "XRP/USD",
      maxAgeSeconds: 300,
      nowSeconds: 1_700_000_010,
      maxSlippageBps: 50,
      quotedSlippageBps: 200,
    });
    expect(r.allowed).toBe(false);
    expect(r.reasons[0]).toMatch(/EXCESSIVE_SLIPPAGE/);
  });
});
