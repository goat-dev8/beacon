import { describe, expect, it } from "vitest";
import { estimateCost, evaluateSealedFit, formatPriceDisplay, hashBrief, SERVICE_CATALOG } from "./index.js";

describe("quote", () => {
  it("estimates micro video cost", () => {
    const cost = estimateCost({
      serviceId: "video",
      briefText: "15s product ad for Flare",
      durationSeconds: 15,
    });
    expect(cost.totalUsdt0).toBeGreaterThanOrEqual(0.005);
    expect(cost.totalUsdt0).toBeLessThanOrEqual(0.08);
    expect(formatPriceDisplay(cost.totalUsdt0)).toMatch(/^\$/);
  });

  it("keeps documents in micro band", () => {
    const cost = estimateCost({
      serviceId: "documents",
      briefText: "docs for school about math",
    });
    expect(cost.totalUsdt0).toBeLessThan(1);
    expect(cost.model).toBeTruthy();
  });

  it("hashes brief stably", () => {
    expect(hashBrief("hello")).toBe(hashBrief(" hello "));
  });

  it("rejects empty brief without AI", async () => {
    const verdict = await evaluateSealedFit({ serviceId: "documents", briefText: "   " });
    expect(verdict.capability).toBe("NO_FIT");
  });

  it("accepts coding in catalog without AI inventing unsupported", async () => {
    const started = Date.now();
    const verdict = await evaluateSealedFit({
      serviceId: "coding",
      briefText: "code for calculator",
    });
    expect(verdict.capability).toBe("FIT");
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("describes Research as live retrieval — not a vague pack", () => {
    const research = SERVICE_CATALOG.find((s) => s.id === "research");
    expect(research?.description.toLowerCase()).toContain("live retrieval");
    expect(research?.description.toLowerCase()).not.toContain("competitor and market packs");
  });

  it("quotes research/analysis as gpt-5.6-sol, not a fake Opus generator", () => {
    expect(estimateCost({ serviceId: "research", briefText: "Research SparkDEX" }).model).toBe(
      "gpt-5.6-sol",
    );
    expect(estimateCost({ serviceId: "analysis", briefText: "Analyze agent spend risk" }).model).toBe(
      "gpt-5.6-sol",
    );
  });
});
