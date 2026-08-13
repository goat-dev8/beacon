import { describe, expect, it } from "vitest";
import { hasNamedResearchTopic, normalizeResearchTopic } from "./researchBrief.js";

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

  it("keeps SparkDEX as the topic instead of substituting a Flare dump", () => {
    expect(normalizeResearchTopic("Research SparkDEX")).toBe("Research SparkDEX");
  });
});

describe("hasNamedResearchTopic", () => {
  it("accepts realistic research prompts", () => {
    expect(hasNamedResearchTopic("Research SparkDEX")).toBe(true);
    expect(hasNamedResearchTopic("Compare two DeFi protocols")).toBe(true);
    expect(hasNamedResearchTopic("Analyze a protocol before I use it")).toBe(true);
  });

  it("rejects bare research / what-is-research", () => {
    expect(hasNamedResearchTopic("research")).toBe(false);
    expect(hasNamedResearchTopic("@research")).toBe(false);
    expect(hasNamedResearchTopic("What is research?")).toBe(false);
  });
});
