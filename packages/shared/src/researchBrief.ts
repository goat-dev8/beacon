import { chatForRole, isAiConfigured } from "./ai.js";
import type { BeaconEnv } from "./env.js";
import { readFtsoFeeds } from "./ftso.js";

export type ResearchBriefResult = {
  topic: string;
  summary: string;
  content: string;
  model: string;
  displayModel: string;
};

/** Catalog / @pay clicks are not a research scope. Use a real Flare default topic. */
export function normalizeResearchTopic(raw: string): string {
  const cleaned = raw
    .replace(/^@\w+\s*/i, "")
    .replace(/^(pay(ment)?|confirm|yes|ok|run)\s*/i, "")
    .trim();
  if (!cleaned || cleaned.length < 8) {
    return "Flare Network for builders: FTSO signals, FAssets FXRP, SparkDEX USDT0, LayerZero OFT bridges, and x402 agent micropayments on Coston2";
  }
  return cleaned.slice(0, 600);
}

function localResearchBrief(topic: string, ftsoLine: string): string {
  return [
    `Research brief`,
    ``,
    `Topic`,
    topic,
    ``,
    `Executive snapshot`,
    `Beacon delivers this paid brief on Flare Coston2 after an EIP-3009 x402 settle in MockUSDT0. The scope is builder-facing: what is live today, what to verify on explorer / docs, and where micropay fits.`,
    ftsoLine ? `\nLive FTSO context\n${ftsoLine}` : "",
    ``,
    `Key points`,
    `1. FTSO V2 feeds are the signal layer for pricing and bias. Prefer live reads over static screenshots.`,
    `2. SparkDEX USDT0→FXRP is the DeFi path. Beacon MockUSDT0 is only for x402 / Bound Work escrow, not SparkDEX liquidity.`,
    `3. LayerZero OFT moves FXRP off Coston2. Quote messaging fees with quoteSend, then approve + send. Destination fill is confirmed on LayerZero Scan, not invented by Beacon.`,
    `4. x402 micropays unlock small resources (signals pack, logo still, research brief). Larger creative jobs should use Bound Work escrow.`,
    `5. Security Center spend limits are server-enforced when Redis is configured. Pause anytime.`,
    ``,
    `Risks and unknowns`,
    `- Testnet liquidity and OFT peer availability can change. Re-quote before every send.`,
    `- Model narration can fail. Settlement is still on-chain. Re-open the receipt tx if the brief UI glitches.`,
    `- Never treat MockUSDT0 balances as SparkDEX USDT0.`,
    ``,
    `Source checklist (search these, do not invent URLs)`,
    `- Flare Developer Hub · network Coston2 developer tools`,
    `- Flare Developer Hub · FAssets swap / redeem guides`,
    `- Flare Developer Hub · smart accounts · control USDT0 with viem`,
    `- LayerZero docs · v2 deployments · Flare testnet`,
    `- Coston2 explorer · verify settlement and OFT source txs`,
    `- LayerZero Scan testnet · confirm destination delivery`,
    ``,
    `Next step`,
    `Pick one path: pull FTSO signals, quote a SparkDEX swap, plan an OFT bridge, or open Bound Work for an escrowed creative job.`,
  ]
    .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
    .join("\n")
    .trim();
}

/**
 * Paid x402 research delivery. Always returns usable structured content.
 * Prefers Agent Router models; falls back to a Flare-grounded local brief (never a stub line).
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
      displayModel: "Beacon",
    };
  }

  try {
    const result = await chatForRole(
      "generator",
      [
        {
          role: "system",
          content: `You are Beacon Research on Flare. The user already paid via x402 (EIP-3009 MockUSDT0 on Coston2).
Write a REAL research brief they can use. Not a status line. Not "unlocked" marketing copy.

Hard rules:
- Structure with short plain headings (no markdown # required): Topic, Executive snapshot, Key points (5-8 bullets), Risks, Source checklist, Next step.
- Source checklist must be search queries / official doc names only. Never invent URLs or paper titles you cannot verify.
- If live FTSO context is provided, weave 1-2 sentences from it. Do not invent feed values.
- Stay concrete about Flare primitives: FTSO, FAssets/FXRP, SparkDEX USDT0 vs Beacon MockUSDT0, LayerZero OFT, x402.
- Warm, clear, concise. No AgentRouter, API keys, or internal errors.`,
        },
        {
          role: "user",
          content: [
            `Topic: ${topic}`,
            ftsoLine ? `Live FTSO (Coston2): ${ftsoLine}` : null,
            opts.settlementTxHash
              ? `Settlement tx (mention once, truncated): ${opts.settlementTxHash.slice(0, 10)}…`
              : null,
            `Write the full brief now.`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      { temperature: 0.35, maxTokens: 1800, env: opts.env },
    );

    const content = result.content.trim();
    // Reject stub / status-only replies so payment always unlocks real substance.
    const looksStub =
      content.length < 280 ||
      /paid research brief unlocked/i.test(content) ||
      /delivering a structured outline/i.test(content);

    if (looksStub) {
      return {
        topic,
        summary,
        content: local,
        model: result.model,
        displayModel: "Beacon",
      };
    }

    return {
      topic,
      summary,
      content,
      model: result.model,
      displayModel: result.model.toLowerCase().includes("gpt")
        ? "GPT-5.6"
        : result.model.toLowerCase().includes("claude")
          ? "Claude Opus 5"
          : "Beacon",
    };
  } catch {
    return {
      topic,
      summary,
      content: local,
      model: "beacon-local",
      displayModel: "Beacon",
    };
  }
}
