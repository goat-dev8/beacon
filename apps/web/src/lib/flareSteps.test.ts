import { describe, expect, it } from "vitest";
import { FLARE_STEPS_SAFE, flareStepState } from "./flareSteps";

function state(id: string, status: Parameters<typeof flareStepState>[1], hasLock: boolean) {
  const step = FLARE_STEPS_SAFE.find((s) => s.id === id);
  if (!step) throw new Error(id);
  return flareStepState(step, status, hasLock);
}

describe("flareStepState", () => {
  it("moves past Beacon Safe funded once a lock tx exists, even with no job status yet", () => {
    expect(state("safe", undefined, true)).toBe("done");
    expect(state("spend", undefined, true)).toBe("done");
    expect(state("lock", undefined, true)).toBe("done");
    expect(state("generate", undefined, true)).toBe("active");
    expect(state("accept", undefined, true)).toBe("todo");
  });

  it("keeps generate active through PREPARING / GENERATING / COMPOSING", () => {
    expect(state("generate", "AUTHORIZED", true)).toBe("active");
    expect(state("generate", "PREPARING", true)).toBe("active");
    expect(state("generate", "GENERATING", true)).toBe("active");
    expect(state("generate", "COMPOSING", true)).toBe("active");
    expect(state("generate", "ACCEPTING", true)).toBe("done");
    expect(state("accept", "ACCEPTING", true)).toBe("active");
  });

  it("does not light generate before a lock", () => {
    expect(state("safe", undefined, false)).toBe("todo");
    expect(state("generate", undefined, false)).toBe("todo");
  });
});
