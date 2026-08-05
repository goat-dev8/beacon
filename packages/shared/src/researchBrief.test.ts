import { describe, expect, it } from "vitest";
import { normalizeResearchTopic } from "./researchBrief.js";

describe("normalizeResearchTopic", () => {
  it("replaces @pay / empty scopes with a Flare default", () => {
    const topic = normalizeResearchTopic("@pay");
    expect(topic.toLowerCase()).toContain("flare");
    expect(topic.toLowerCase()).toContain("ftso");
  });

  it("keeps a real user scope", () => {
    expect(normalizeResearchTopic("Compare FXRP OFT fees to Sepolia")).toBe(
      "Compare FXRP OFT fees to Sepolia",
    );
  });
});
