import { chatForRole, displayModelName, isAiConfigured } from "./ai.js";
import type { BeaconEnv } from "./env.js";
import { readFtsoFeeds } from "./ftso.js";

export type ResearchBriefResult = {
  topic: string;
  summary: string;
  content: string;
  model: string;
  displayModel: string;
};

export const RESEARCH_EXAMPLE_PROMPTS = [
  "Research SparkDEX",
  "Compare two DeFi protocols",
  "Research the latest XRP ecosystem developments",
  "Analyze a protocol before I use it",
] as const;

const DEFAULT_FLARE_TOPIC =
  "Flare Network for builders: FTSO signals, FAssets FXRP, SparkDEX on Flare Mainnet vs Coston2, LayerZero OFT bridges, and x402 agent micropayments";

/** Catalog / @pay clicks are not a research scope. Use a real Flare default topic. */
export function normalizeResearchTopic(raw: string): string {
  const cleaned = raw
    .replace(/^@\w+\s*/i, "")
    .replace(/^(pay(ment)?|confirm|yes|ok|run)\s*/i, "")
    .trim();
  if (!cleaned || cleaned.length < 8 || !hasNamedResearchTopic(cleaned)) {
    return DEFAULT_FLARE_TOPIC;
  }
  return cleaned.slice(0, 600);
}

/**
 * True when the user named a topic worth researching (protocol, product, market, etc.).
 * Bare "research" / "what is research" still needs examples, not a quote.
 */
export function hasNamedResearchTopic(raw: string): boolean {
  const cleaned = raw
    .replace(/^@\w+\s*/i, "")
    .replace(/^(please\s+)?(help me\s+)?/i, "")
    .trim();
  if (!cleaned) return false;
  if (/^what is research\b/i.test(cleaned)) return false;
  if (/^(research|brief|pack|help|topic)\??$/i.test(cleaned)) return false;
  if (/\b(research|compare|analyze|analyse|brief)\s+\S{3,}/i.test(cleaned)) return true;
  if (cleaned.length >= 12) return true;
  return false;
}

function topicLooksLikeSparkDex(topic: string): boolean {
  return /sparkdex|spark dex/i.test(topic);
}

function localResearchBrief(topic: string, ftsoLine: string): string {
  const spark = topicLooksLikeSparkDex(topic);
  const findings = spark
    ? [
        "SparkDEX is Flare’s Uniswap v3-style DEX (concentrated liquidity) used on Flare Mainnet for swaps such as USDT0 ↔ FXRP.",
        "On Coston2, SparkDEX SwapRouter bytecode is empty. Beacon does not execute SparkDEX swaps there. Coston2 Safe swaps go through Beacon SwapDesk with an FTSOv2 guard.",
        "Official Coston2 faucet USDT0 is Beacon’s EVM payment rail (Safe, Jobs, x402, SwapDesk). It is not Flare Mainnet USD₮0.",
        "FXRP is the FAsset / LayerZero OFT rail. It is not a substitute for USDT0.",
        ftsoLine
          ? `Live FTSO context on Coston2 (not SparkDEX pool prices): ${ftsoLine}.`
          : "Live pool TVL and SparkDEX quotes are not in this fallback brief — verify on SparkDEX / explorer before trading.",
      ]
    : [
        `This brief is scoped to: ${topic}.`,
        "Treat the following as orientation from Beacon’s model, not a live data scrape. Confirm anything that would move funds.",
        "If the topic is a protocol or product: identify what it is, who it is for, how it works at a high level, and what to verify before using it.",
        "If the topic is a market or competitor set: compare mechanism, risk, and what is actually live vs announced.",
        ftsoLine
          ? `Optional Coston2 FTSO context (only if prices are relevant): ${ftsoLine}.`
          : "No live FTSO snapshot was attached to this fallback brief.",
      ];

  return [
    `What was researched`,
    topic,
    ``,
    `Key findings`,
    ...findings.map((line, i) => `${i + 1}. ${line}`),
    ``,
    `Conclusions`,
    spark
      ? `Use SparkDEX on Flare Mainnet if you intend to trade on that DEX. Use Beacon Flow on Coston2 for SwapDesk + FTSO test execution — do not expect a SparkDEX router there.`
      : `You can use this as a starting map. Verify current docs, deployments, and risk before you interact with the protocol or product.`,
    ``,
    `Caveats`,
    `- This is not financial advice. Model knowledge can be stale.`,
    `- Do not invent URLs, TVL, audit scores, or paper titles.`,
    `- Re-check explorer / official docs before any spend.`,
    spark ? `- Never treat Coston2 faucet USDT0 as Flare Mainnet SparkDEX USDT0.` : `- If a fact is unknown, it is omitted rather than guessed.`,
    ``,
    `Source checklist (search these names — do not invent URLs)`,
    spark
      ? [
          `- SparkDEX official documentation`,
          `- Flare Developer Hub · SparkDEX / DEXes`,
          `- Flare Developer Hub · FAssets and FTSO`,
          `- Coston2 explorer · verify that SwapRouter is empty before assuming a testnet SparkDEX path`,
          `- Beacon desk · SwapDesk is the Coston2 execute path`,
        ].join("\n")
      : [
          `- Official project or protocol documentation`,
          `- Flare Developer Hub (when the topic is Flare-related)`,
          `- Relevant chain explorer for deployments`,
          `- Project GitHub / audits if the user asked about safety`,
        ].join("\n"),
  ].join("\n");
}

function researchSystemPrompt(): string {
  return `You are Beacon Research. The user paid for a usable brief on THEIR topic — not a Beacon product pitch.

Write so a reader immediately understands:
1. What was researched
2. Key findings (concrete, numbered)
3. Useful conclusions
4. Important caveats

Hard rules:
- Structure with these plain headings (markdown ## is fine): What was researched, Key findings, Conclusions, Caveats, Source checklist.
- Research the named topic. Protocols, products, competitors, markets, projects, and specific questions are all in scope.
- Source checklist must be search queries / official product or doc names only. Never invent URLs, paper titles, TVL, audit scores, or citations.
- If you are not sure, say so. Do not guess live prices, pool depth, or security reviews.
- SparkDEX / Flare DEX caveat only when relevant: SparkDEX is Flare Mainnet; Coston2 SparkDEX SwapRouter bytecode is empty; Beacon Coston2 swaps use SwapDesk + FTSO; Coston2 faucet USDT0 is not mainnet USD₮0.
- Do not hijack unrelated topics into FTSO / Safe / x402 marketing.
- If live FTSO context is provided, use it only when prices help. Do not invent feed values.
- Warm, clear, concise. No API keys, AgentRouter, or internal errors.`;
}

/**
 * Paid x402 research delivery. Always returns usable structured content.
 * Prefers the configured generator model; falls back to a topic-grounded local brief (never a stub line).
 */
export async function generateResearchBrief(opts: {
  topic: string;
  env: BeaconEnv;
  settlementTxHash?: string;
}): Promise<ResearchBriefResult> {
  const topic = normalizeResearchTopic(opts.topic);
  let ftsoLine = "";
  try {
    const snap = await readFtsoFeeds(opts.env);
    if (snap.feeds.length) {
      ftsoLine = snap.feeds
        .slice(0, 6)
        .map((f) => `${f.symbol}=${Number(f.value).toPrecision(6)}`)
        .join(" · ");
    }
  } catch {
    /* FTSO optional enrichment */
  }

  const local = localResearchBrief(topic, ftsoLine);
  const summary = `Scoped brief on: ${topic.slice(0, 120)}${topic.length > 120 ? "…" : ""}`;

  if (!isAiConfigured(opts.env)) {
    return {
      topic,
      summary,
      content: local,
      model: "beacon-local",
      displayModel: displayModelName("beacon-local", { fallback: true }),
    };
  }

  try {
    const result = await chatForRole(
      "generator",
      [
        {
          role: "system",
          content: researchSystemPrompt(),
        },
        {
          role: "user",
          content: [
            `Topic: ${topic}`,
            ftsoLine ? `Live FTSO (Coston2, optional): ${ftsoLine}` : null,
            opts.settlementTxHash
              ? `Settlement tx (mention once, truncated): ${opts.settlementTxHash.slice(0, 10)}…`
              : null,
            `Write the full brief now. Lead with what was researched, then findings, conclusions, caveats.`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      { temperature: 0.3, maxTokens: 2200, env: opts.env },
    );

    const content = result.content.trim();
    const looksStub =
      content.length < 400 ||
      /paid research brief unlocked/i.test(content) ||
      /delivering a structured outline/i.test(content) ||
      !/finding|conclusion|caveat|what was researched/i.test(content);

    if (looksStub) {
      return {
        topic,
        summary,
        content: local,
        model: result.model,
        displayModel: displayModelName("beacon-local", { fallback: true }),
      };
    }

    return {
      topic,
      summary,
      content,
      model: result.model,
      displayModel: displayModelName(result.model),
    };
  } catch {
    return {
      topic,
      summary,
      content: local,
      model: "beacon-local",
      displayModel: displayModelName("beacon-local", { fallback: true }),
    };
  }
}
