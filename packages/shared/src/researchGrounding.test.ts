import { describe, expect, it } from "vitest";
import {
  buildBeaconFlareContext,
  extractSearchQuery,
  hostAllowed,
  selectOfficialSources,
  stripToExcerpt,
  topicTouchesFlare,
  wikipediaTitleRelevant,
} from "./researchGrounding.js";

describe("research grounding", () => {
  it("treats SparkDEX / FCC / FTSO as Flare-related", () => {
    expect(topicTouchesFlare("Research SparkDEX")).toBe(true);
    expect(topicTouchesFlare("What is FCC and how does Beacon use it?")).toBe(true);
    expect(topicTouchesFlare("Research the current Flare ecosystem")).toBe(true);
    expect(topicTouchesFlare("Write a poem about cats")).toBe(false);
  });

  it("selects official SparkDEX + Flare core pages for SparkDEX", () => {
    const urls = selectOfficialSources("Research SparkDEX").map((p) => p.url);
    expect(urls.some((u) => u.includes("docs.sparkdex.ai"))).toBe(true);
    expect(urls.some((u) => u.includes("dev.flare.network"))).toBe(true);
    expect(urls.every((u) => hostAllowed(u) || u.includes("docs.sparkdex.ai"))).toBe(true);
  });

  it("selects FCC docs + explorer for FCC questions", () => {
    const urls = selectOfficialSources("What is FCC and how does Beacon use it?").map((p) => p.url);
    expect(urls.some((u) => u.includes("/fcc/"))).toBe(true);
    expect(urls.some((u) => u.includes("tee/extensions/65925"))).toBe(true);
  });

  it("does not attach SparkDEX pages to an unrelated topic", () => {
    const urls = selectOfficialSources("History of origami folding");
    expect(urls.length).toBe(0);
  });

  it("keeps Beacon facts as notes, not a SparkDEX essay", () => {
    const ctx = buildBeaconFlareContext();
    expect(ctx).toContain("canMoveFunds: false");
    expect(ctx).toContain("SwapDesk");
    expect(ctx.toLowerCase()).not.toContain("algebra integral");
  });

  it("strips HTML and caps excerpt length", () => {
    const html = "<html><body><h1>Hello</h1><p>SparkDEX on Flare</p></body></html>";
    expect(stripToExcerpt(html)).toContain("SparkDEX on Flare");
    expect(stripToExcerpt(html)).not.toContain("<h1>");
  });

  it("extracts a search query from research phrasing", () => {
    expect(extractSearchQuery("Research SparkDEX")).toBe("SparkDEX");
    expect(extractSearchQuery("What is FCC and how does Beacon use it?")).toContain("FCC");
  });

  it("rejects Wikipedia titles that do not share tokens with the query", () => {
    expect(wikipediaTitleRelevant("Research SparkDEX", "SparkDEX")).toBe(true);
    expect(wikipediaTitleRelevant("Research SparkDEX", "Sparkle in the Rain")).toBe(false);
  });

  it("selects at most four official pages", () => {
    const urls = selectOfficialSources("Research SparkDEX FTSO FDC FCC Flare ecosystem");
    expect(urls.length).toBeLessThanOrEqual(4);
    expect(urls.length).toBeGreaterThan(0);
  });
});
