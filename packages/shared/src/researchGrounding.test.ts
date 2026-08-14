import { describe, expect, it } from "vitest";
import {
  buildBeaconFlareContext,
  extractSearchQuery,
  hostAllowed,
  parseJinaSearchHits,
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
    expect(topicTouchesFlare("Research FAssets")).toBe(true);
    expect(topicTouchesFlare("Research FDC")).toBe(true);
    expect(topicTouchesFlare("Research signals")).toBe(true);
    expect(topicTouchesFlare("Write a poem about cats")).toBe(false);
  });

  it("maps short Flare research prompts to matching DevHub pages", () => {
    const spark = selectOfficialSources("Research SparkDEX on Flare.").map((p) => p.url);
    expect(spark.some((u) => u.includes("docs.sparkdex.ai"))).toBe(true);

    const fcc = selectOfficialSources("Research Flare Confidential Compute (FCC).").map((p) => p.url);
    expect(fcc.some((u) => u.includes("/fcc/"))).toBe(true);
    expect(fcc.every((u) => u.includes("/fcc/") || u.includes("tee/extensions"))).toBe(true);

    const fassets = selectOfficialSources("Research Flare FAssets and FXRP.").map((p) => p.url);
    expect(fassets.some((u) => u.includes("/fassets/"))).toBe(true);

    const fdc = selectOfficialSources("Research the Flare Data Connector (FDC).").map((p) => p.url);
    expect(fdc.some((u) => u.includes("/fdc/"))).toBe(true);
    expect(fdc.every((u) => u.includes("/fdc/"))).toBe(true);

    const signals = selectOfficialSources("Research FTSO price signals on Flare.").map((p) => p.url);
    expect(signals.some((u) => u.includes("/ftso/"))).toBe(true);

    const shortSignals = selectOfficialSources("Research signals").map((p) => p.url);
    expect(shortSignals.some((u) => u.includes("/ftso/"))).toBe(true);
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
    expect(extractSearchQuery("poly market reasearch")).toBe("Polymarket");
    expect(extractSearchQuery("Research Polymarket")).toBe("Polymarket");
    expect(extractSearchQuery("research btc")).toBe("Bitcoin");
    expect(extractSearchQuery("BTC")).toBe("Bitcoin");
  });

  it("rejects Wikipedia titles that do not share tokens with the query", () => {
    expect(wikipediaTitleRelevant("Research SparkDEX", "SparkDEX")).toBe(true);
    expect(wikipediaTitleRelevant("Research SparkDEX", "Sparkle in the Rain")).toBe(false);
    expect(wikipediaTitleRelevant("poly market reasearch", "Polymarket")).toBe(true);
  });

  it("parses Jina search hits into http URLs", () => {
    const hits = parseJinaSearchHits(
      "[Polymarket](https://polymarket.com/) Prediction markets.\n[Docs](https://docs.polymarket.com/overview)",
    );
    expect(hits.map((h) => h.url)).toEqual([
      "https://polymarket.com/",
      "https://docs.polymarket.com/overview",
    ]);
  });

  it("selects at most four official pages", () => {
    const urls = selectOfficialSources("Research SparkDEX FTSO FDC FCC Flare ecosystem");
    expect(urls.length).toBeLessThanOrEqual(4);
    expect(urls.length).toBeGreaterThan(0);
  });
});
