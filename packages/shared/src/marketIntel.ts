/**
 * AI Market Intelligence — NOT a prediction market / betting UI.
 *
 * Combines live FTSO + optional wallet balances + transparent heuristics + LLM narrative.
 * Never invents odds markets. Labels confidence as model+oracle derived.
 */

import { chatCompletion, displayModelName, isAiConfigured } from "./ai.js";
import { loadEnv, type BeaconEnv } from "./env.js";
import { buildTradeSignal, readErc20Balance, readFtsoFeeds, resolveFxrpAddress, COSTON2_USDT0 } from "./ftso.js";
import { discoverSparkDexPools } from "./sparkDex.js";

export interface MarketIntelligence {
  flarePrimitive: "FTSO + SparkDEX liquidity + LLM";
  timestamp: number;
  feeds: Array<{ symbol: string; value: number }>;
  bias: string;
  probabilityRiskOn: number;
  confidence: number;
  risk: "low" | "medium" | "high";
  recommendedAction: string;
  rationale: string[];
  liquidityNote: string;
  walletNote?: string;
  honesty: string;
  model: string;
  displayModel: string;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export async function buildMarketIntelligence(opts?: {
  wallet?: string;
  question?: string;
  env?: BeaconEnv;
}): Promise<MarketIntelligence> {
  const env = opts?.env ?? loadEnv();
  const snap = await readFtsoFeeds(env);
  const signal = buildTradeSignal(snap.feeds);
  const pools = await discoverSparkDexPools(env).catch(() => null);

  const btc = snap.feeds.find((f) => f.symbol === "BTC/USD")?.value ?? 0;
  const xrp = snap.feeds.find((f) => f.symbol === "XRP/USD")?.value ?? 0;
  const flr = snap.feeds.find((f) => f.symbol === "FLR/USD")?.value ?? 0;

  let probabilityRiskOn = 0.5;
  if (signal.bias === "risk-on") probabilityRiskOn = 0.62;
  if (signal.bias === "risk-off") probabilityRiskOn = 0.38;
  // Soft adjustments from levels (transparent, not magic)
  if (btc > 70_000) probabilityRiskOn += 0.05;
  if (btc < 55_000) probabilityRiskOn -= 0.05;
  if (xrp > 1.2) probabilityRiskOn += 0.03;
  if (flr < 0.01) probabilityRiskOn -= 0.03;
  probabilityRiskOn = clamp01(probabilityRiskOn);

  const liquidPools = pools?.pools.length ?? 0;
  let confidence = 0.55;
  if (snap.feeds.length >= 4) confidence += 0.1;
  if (liquidPools > 0) confidence += 0.1;
  if (opts?.wallet) confidence += 0.05;
  confidence = clamp01(confidence);

  let risk: "low" | "medium" | "high" = "medium";
  if (signal.bias === "risk-off" || probabilityRiskOn < 0.4) risk = "high";
  if (signal.bias === "risk-on" && confidence > 0.65) risk = "low";

  let walletNote: string | undefined;
  if (opts?.wallet) {
    try {
      const fxrp = await resolveFxrpAddress(env);
      const [u, f] = await Promise.all([
        readErc20Balance(COSTON2_USDT0, opts.wallet, env),
        readErc20Balance(fxrp, opts.wallet, env),
      ]);
      walletNote = `Coston2 wallet: ${u.formatted} USDT0 · ${f.formatted} FXRP (desk balances; SparkDEX execute is Flare Mainnet).`;
    } catch {
      walletNote = "Wallet connected but balance read failed.";
    }
  }

  const liquidityNote =
    liquidPools > 0
      ? `SparkDEX Mainnet: ${liquidPools} liquid pool(s) across discovered pairs (${pools!.pairs.map((p) => `${p.symbolA}/${p.symbolB}`).join(", ")}). Executable quotes use QuoterV2 (not FTSO mid).`
      : "SparkDEX liquidity discovery unavailable — FTSO remains narrative/portfolio only; no executable DEX quote.";

  const rationale = [
    `FTSO bias=${signal.bias}: ${signal.summary}`,
    `Feeds: ${snap.feeds.map((f) => `${f.symbol}=${f.value}`).join(" · ")}`,
    liquidityNote,
  ];
  if (walletNote) rationale.push(walletNote);

  let recommendedAction =
    signal.bias === "risk-on"
      ? "Consider a sized USDT0→FXRP exposure only after your own risk checks; prefer @swap from Beacon Safe on Coston2 (agent spend). SparkDEX Mainnet is an optional EOA path."
      : signal.bias === "risk-off"
        ? "Prefer staying in USDT0 / smaller size; revisit when FTSO bias improves."
        : "No strong directional edge — wait or use @signals for another FTSO read.";

  let model = "beacon-local";
  let displayModel = displayModelName("beacon-local", { fallback: true });
  let narrativeExtra = "";

  if (isAiConfigured(env)) {
    try {
      const modelId = env.AI_MODEL_QUOTE || "gpt-5.6-sol";
      const result = await chatCompletion(
        {
          model: modelId,
          temperature: 0.2,
          maxTokens: 280,
          messages: [
            {
              role: "system",
              content:
                "You are Beacon Market Intelligence on Flare. Use ONLY the provided FTSO/liquidity facts. Return 2 short sentences: (1) why the probability leans this way (2) one recommended action. Never invent prices, hashes, or betting markets. Never say Polymarket.",
            },
            {
              role: "user",
              content: `Question: ${opts?.question || "Near-term FXRP / risk posture on Flare?"}
Facts:
${rationale.join("\n")}
Heuristic probabilityRiskOn=${probabilityRiskOn.toFixed(2)} confidence=${confidence.toFixed(2)} risk=${risk}`,
            },
          ],
        },
        env,
      );
      narrativeExtra = result.content.trim();
      model = result.model ?? modelId;
      displayModel = displayModelName(model);
      if (narrativeExtra) {
        recommendedAction = narrativeExtra.split("\n").filter(Boolean).slice(-1)[0] || recommendedAction;
      }
    } catch {
      /* keep heuristic — label deterministic fallback */
      displayModel = displayModelName("beacon-local", { fallback: true });
    }
  }

  return {
    flarePrimitive: "FTSO + SparkDEX liquidity + LLM",
    timestamp: snap.timestamp,
    feeds: snap.feeds.map((f) => ({ symbol: f.symbol, value: f.value })),
    bias: signal.bias,
    probabilityRiskOn: Number(probabilityRiskOn.toFixed(2)),
    confidence: Number(confidence.toFixed(2)),
    risk,
    recommendedAction,
    rationale: narrativeExtra ? [...rationale, narrativeExtra] : rationale,
    liquidityNote,
    walletNote,
    honesty:
      "This is AI Market Intelligence, not a betting market. Probabilities are transparent heuristics over live FTSO + liquidity discovery — not event contracts.",
    model,
    displayModel,
  };
}
