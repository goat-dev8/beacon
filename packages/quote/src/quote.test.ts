import { describe, expect, it } from "vitest";
import { estimateCost, evaluateSealedFit, formatPriceDisplay, hashBrief } from "./index.js";

describe("quote", () => {
  it("estimates video cost with duration", () => {
    const cost = estimateCost({
      serviceId: "video",
      briefText: "15s product ad",
      durationSeconds: 15,
    });
    expect(cost.totalCents).toBeGreaterThan(cost.baseCents);
    expect(formatPriceDisplay(cost.totalCents)).toMatch(/^\$/);
  });

  it("hashes brief stably", () => {
    expect(hashBrief("hello")).toBe(hashBrief(" hello "));
  });

  it("rejects empty brief without AI", async () => {
    const verdict = await evaluateSealedFit({ serviceId: "documents", briefText: "   " });
    expect(verdict.capability).toBe("NO_FIT");
  });
});
