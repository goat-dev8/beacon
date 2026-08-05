import { describe, expect, it } from "vitest";
import {
  displayModelName,
  extractAmount,
  resolvePaidResourceTurn,
  shouldEmitPayCatalog,
} from "./flareAgents.js";

describe("extractAmount", () => {
  it("does not treat the trailing 0 in USDT0 as an amount", () => {
    expect(extractAmount("Swap my USDT0 to FXRP")).toBeNull();
    expect(extractAmount("@swap USDT0 -> FXRP")).toBeNull();
  });

  it("parses explicit amounts", () => {
    expect(extractAmount("swap 5 USDT0")).toBe("5");
    expect(extractAmount("please swap 1.5")).toBe("1.5");
    expect(extractAmount("swap all")).toBe("all");
  });
});

describe("displayModelName", () => {
  it("never exposes provider brands or invents GPT-3.5", () => {
    expect(displayModelName("claude-opus-5")).toBe("Claude Opus 5");
    expect(displayModelName("gpt-5.6-sol")).toBe("GPT-5.6");
    expect(displayModelName("gpt-4o")).toBe("GPT-5.6");
    expect(displayModelName("local-heuristic")).toBe("Beacon");
    expect(displayModelName("agentrouter-foo")).toBe("Beacon");
  });
});

describe("paidResource + serviceId", () => {
  it("skips quote catalog when payment settled for a service", () => {
    expect(
      resolvePaidResourceTurn({
        paidResource: true,
        serviceId: "image-logo",
        state: { intent: "image", phase: "await_confirm", creativeBrief: "Acme logo, blue" },
      }),
    ).toEqual({
      serviceId: "image-logo",
      intent: "image",
      creativeBrief: "Acme logo, blue",
    });
    expect(shouldEmitPayCatalog(true)).toBe(false);
    expect(shouldEmitPayCatalog(false)).toBe(true);
    expect(resolvePaidResourceTurn({ paidResource: false, serviceId: "image-logo" })).toBeNull();
  });
});
