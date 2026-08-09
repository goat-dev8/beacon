import { chatForRole, displayModelName, isAiConfigured } from "./ai.js";
import { loadEnv, type BeaconEnv } from "./env.js";
import {
  buildTradeSignal,
  readErc20Balance,
  readFtsoFeeds,
  resolveFxrpAddress,
  COSTON2_USDT0,
} from "./ftso.js";
import {
  COSTON2_FXRP_OFT_ADAPTER,
  discoverFxrpOftRoutes,
  prepareFxrpOftBridge,
  resolveOftRouteByChain,
} from "./oftBridge.js";
import { discoverSparkDexPools, prepareSparkDexSwap } from "./sparkDex.js";
import { prepareBeaconSafeSwap, resolveSwapDeskAddress } from "./safeSwap.js";
import { prepareBeaconAgentBridge } from "./agentBridge.js";
import { readAgentVaultStatus, resolveVaultForWallet } from "./vaultClient.js";
import { readFassetsDesk } from "./fassetsStatus.js";
import { readYieldVaultDesk } from "./yieldVaults.js";
import { buildMarketIntelligence } from "./marketIntel.js";
import { readPortfolioDesk } from "./portfolioDesk.js";

export { COSTON2_FXRP_OFT_ROUTES } from "./oftBridge.js";

export type BeaconAgentId =
  | "general"
  | "signals"
  | "swap"
  | "bridge"
  | "pay"
  | "trade"
  | "desk"
  | "image"
  | "research"
  | "portfolio"
  | "fassets"
  | "intel"
  | "yield"
  | "risk"
  | "liquidity"
  | "treasury"
  | "crosschain"
  | "xrpfi";

export interface AgentDef {
  id: BeaconAgentId;
  name: string;
  blurb: string;
  builtIn: boolean;
  x402PriceUsdt0: number;
  mention: string;
  flarePrimitive: string;
}

export const BEACON_AGENTS: AgentDef[] = [
  { id: "general", name: "General", blurb: "Flare AI OS co-pilot.", builtIn: true, x402PriceUsdt0: 0, mention: "@general", flarePrimitive: "Flare" },
  { id: "signals", name: "FTSO Signals", blurb: "Live oracle feeds + bias.", builtIn: true, x402PriceUsdt0: 0, mention: "@signals", flarePrimitive: "FTSO" },
  { id: "intel", name: "Market Intel", blurb: "FTSO + liquidity reasoning.", builtIn: true, x402PriceUsdt0: 0, mention: "@intel", flarePrimitive: "FTSO + SparkDEX" },
  { id: "portfolio", name: "Portfolio", blurb: "Balances valued with FTSO.", builtIn: true, x402PriceUsdt0: 0, mention: "@portfolio", flarePrimitive: "FTSO + FAssets" },
  { id: "fassets", name: "FAssets", blurb: "FXRP status · mint/redeem guides.", builtIn: true, x402PriceUsdt0: 0, mention: "@fassets", flarePrimitive: "FAssets" },
  { id: "swap", name: "Swap", blurb: "SparkDEX pairs (Flare Mainnet).", builtIn: true, x402PriceUsdt0: 0, mention: "@swap", flarePrimitive: "SparkDEX" },
  { id: "liquidity", name: "Liquidity", blurb: "Discovered SparkDEX pools.", builtIn: true, x402PriceUsdt0: 0, mention: "@liquidity", flarePrimitive: "SparkDEX" },
  { id: "bridge", name: "Bridge", blurb: "LayerZero FXRP OFT peers.", builtIn: true, x402PriceUsdt0: 0, mention: "@bridge", flarePrimitive: "LayerZero + FAssets" },
  { id: "crosschain", name: "Cross-chain", blurb: "OFT routes + honesty.", builtIn: true, x402PriceUsdt0: 0, mention: "@crosschain", flarePrimitive: "LayerZero" },
  { id: "xrpfi", name: "XRPFi", blurb: "FXRP rails: swap · bridge · FAssets.", builtIn: true, x402PriceUsdt0: 0, mention: "@xrpfi", flarePrimitive: "FAssets + SparkDEX + LZ" },
  { id: "yield", name: "Yield", blurb: "On-chain yield rails only — never invents APY.", builtIn: true, x402PriceUsdt0: 0, mention: "@yield", flarePrimitive: "FXRP yield rails" },
  { id: "risk", name: "Risk", blurb: "FTSO bias + policy posture.", builtIn: true, x402PriceUsdt0: 0, mention: "@risk", flarePrimitive: "FTSO" },
  { id: "treasury", name: "Treasury", blurb: "Verified-read policy budget view (same Coston2 desk as Portfolio).", builtIn: true, x402PriceUsdt0: 0, mention: "@treasury", flarePrimitive: "x402 + FTSO" },
  { id: "pay", name: "Pay x402", blurb: "EIP-3009 micropay.", builtIn: true, x402PriceUsdt0: 0, mention: "@pay", flarePrimitive: "x402" },
  { id: "trade", name: "Trade", blurb: "Signals → swap.", builtIn: true, x402PriceUsdt0: 0, mention: "@trade", flarePrimitive: "FTSO + SparkDEX" },
  { id: "desk", name: "Bound Work", blurb: "Escrow creative jobs.", builtIn: true, x402PriceUsdt0: 0, mention: "@desk", flarePrimitive: "x402 escrow" },
  { id: "image", name: "Image", blurb: "Creative generation.", builtIn: true, x402PriceUsdt0: 0, mention: "@image", flarePrimitive: "x402" },
  { id: "research", name: "Research", blurb: "Scoped research packs.", builtIn: true, x402PriceUsdt0: 0, mention: "@research", flarePrimitive: "x402" },
];

export type ConversationPhase =
  | "idle"
  | "clarify"
  | "quote"
  | "await_confirm"
  | "ready_execute";

export interface ConversationState {
  intent: BeaconAgentId;
  phase: ConversationPhase;
  amountInUnits?: string;
  bridgeFrom?: string;
  bridgeTo?: string;
  imageStyle?: string;
  researchScope?: string;
  serviceId?: string;
  creativeBrief?: string;
  quotePrice?: string;
  swapTokenIn?: string;
  swapTokenOut?: string;
  swapFee?: number;
}

export type AgentCard =
  | {
      type: "ftso_signals";
      title: string;
      feeds: Array<{ symbol: string; value: number }>;
      bias: string;
      summary: string;
      ftsoV2: string;
      timestamp: number;
    }
  | {
      type: "swap_clarify";
      title: string;
      wallet?: string;
      usdt0Balance?: string;
      fxrpBalance?: string;
      faucetHref: string;
    }
  | {
      type: "swap_quote";
      title: string;
      amountInDisplay: string;
      estimatedFxrp: string;
      estimatedOut?: string;
      symbolIn?: string;
      symbolOut?: string;
      xrpUsd: number;
      wallet: string;
      usdt0Balance: string;
      network: string;
      chainId?: number;
      note: string;
      honesty?: string;
      flarePrimitive?: string;
      pairsHint?: string[];
      quoteSource?: "QuoterV2" | "FTSO+SwapDesk";
      estimateBasis?: string;
      slippageBps?: number;
      priceImpactVsFtsoBps?: number | null;
      ftsoMidOut?: string;
      amountOutMinimum?: string;
      mode?: "beacon_safe" | "sparkdex_mainnet";
      requiresMetaMask?: boolean;
      vaultBalanceDisplay?: string;
      ftsoGuard?: {
        allowed: boolean;
        feedAge: number;
        xrpUsd: number;
        maxAgeSeconds: number;
      };
    }
  | {
      type: "swap_prepare";
      title: string;
      tokenIn: string;
      tokenOut: string;
      router: string;
      amountIn: string;
      amountInDisplay: string;
      amountOutMinimum: string;
      estimatedFxrp: string;
      estimatedOut?: string;
      symbolIn?: string;
      symbolOut?: string;
      approveTo: string;
      swapTo: string;
      approveData: string;
      swapData: string;
      docs: string[];
      warning: string;
      chainId?: number;
      network?: string;
      pool?: string;
      fee?: number;
      honesty?: string;
      requiresChainSwitch?: boolean;
      requiresMetaMask?: boolean;
      mode?: "beacon_safe" | "sparkdex_mainnet";
      vault?: string;
      desk?: string;
      flarePrimitive?: string;
      quoteSource?: "QuoterV2" | "FTSO+SwapDesk";
      estimateBasis?: string;
      slippageBps?: number;
      priceImpactVsFtsoBps?: number | null;
      ftsoMidOut?: string;
      quoter?: string;
      vaultBalanceDisplay?: string;
    }
  | {
      type: "yield_vaults";
      title: string;
      flarePrimitive: string;
      honesty: string;
      network: string;
      chainId: number;
      vaults: Array<{
        id: string;
        vault: string;
        assetSymbol?: string;
        totalAssetsDisplay?: string;
        sharePriceDisplay?: string | null;
        userSharesDisplay?: string;
        explorer?: string;
        error?: string;
      }>;
      docs: string[];
    }
  | {
      type: "swap_pairs";
      title: string;
      network: string;
      chainId: number;
      pairs: Array<{
        pairKey: string;
        symbolA: string;
        symbolB: string;
        bestFee: number;
        liquidity: string;
      }>;
      honesty: string;
      flarePrimitive: string;
    }
  | {
      type: "fassets_desk";
      title: string;
      flarePrimitive: string;
      honesty: string;
      managers: Array<{
        symbol: string;
        status: string;
        lotSize: number;
        agentCount: number;
        fAsset: string;
        mint: string;
        redeem: string;
        bridge: string;
        mintHandoffSummary?: string;
      }>;
      unavailable: Array<{ symbol: string; note: string }>;
      xrpUsd: number;
      lotValueUsd: number | null;
      docs: string[];
    }
  | {
      type: "portfolio_desk";
      title: string;
      flarePrimitive: string;
      honesty: string;
      totalUsd: number;
      positions: Array<{
        symbol: string;
        balance: string;
        usdValue: number | null;
      }>;
      recommended: string[];
    }
  | {
      type: "market_intel";
      title: string;
      flarePrimitive: string;
      honesty: string;
      bias: string;
      probabilityRiskOn: number;
      confidence: number;
      risk: string;
      recommendedAction: string;
      rationale: string[];
      feeds: Array<{ symbol: string; value: number }>;
    }
  | {
      type: "bridge_quote";
      title: string;
      amountInDisplay?: string;
      destination: string;
      dstEid: number;
      amountDisplay: string;
      nativeFeeDisplay: string;
      wallet: string;
      fxrpBalance: string;
      network: string;
      note: string;
      mode?: "beacon_agent" | "eoa_metamask";
      requiresMetaMask?: boolean;
      fromSafe?: boolean;
      honesty?: string;
    }
  | {
      type: "bridge_prepare";
      title: string;
      destination: string;
      dstEid: number;
      peer: string;
      amountLD: string;
      amountDisplay: string;
      minAmountLD: string;
      nativeFee: string;
      nativeFeeDisplay: string;
      approveTo: string;
      sendTo: string;
      approveData: string;
      sendData: string;
      docs: string[];
      warning: string;
      layerZeroScanBase: string;
      deliveryHint?: string;
      mode?: "beacon_agent" | "eoa_metamask";
      requiresMetaMask?: boolean;
      fromSafe?: boolean;
      safeSpendUsdt0?: string;
      honesty?: string;
      executor?: string;
    }
  | {
      type: "bridge_routes";
      title: string;
      source: string;
      oftAdapter: string;
      routes: Array<{
        chain: string;
        eid: number;
        peer: string;
        asset: string;
        status: string;
        eta: string;
        fees: string;
      }>;
      routesSource?: "onchain" | "fallback";
      discoveredAt?: number;
      unavailable: string[];
      docs: Array<{ label: string; href: string }>;
      honesty: string;
    }
  | {
      type: "bridge_clarify";
      title: string;
      prompts: string[];
    }
  | {
      type: "bridge_intent";
      title: string;
      summary: string;
      links: Array<{ label: string; href: string }>;
      honesty: string;
    }
  | {
      type: "media_clarify";
      title: string;
      kind: "image" | "research";
      prompts: string[];
      deskHref: string;
    }
  | {
      type: "x402_quote";
      title: string;
      priceUsdt0: string;
      resource: string;
      payTo: string;
      token: string;
      facilitator: string;
      chainId: number;
      provider?: string;
      reason?: string;
      etaSeconds?: number;
      flarePrimitive?: string;
      serviceId?: string;
      agentId?: BeaconAgentId;
      brief?: string;
    }
  | {
      type: "media_result";
      title: string;
      kind: "image" | "research";
      summary: string;
      content?: string;
      mimeType?: string;
      paymentTxHint?: string;
      serviceId?: string;
    }
  | {
      type: "desk_link";
      title: string;
      href: string;
      summary: string;
    }
  | {
      type: "insufficient";
      title: string;
      summary: string;
      mintMock?: boolean;
      faucetHref?: string;
    };

export interface AgentChatResult {
  agentId: BeaconAgentId;
  text: string;
  cards: AgentCard[];
  model: string;
  displayModel: string;
  paid: boolean;
  state: ConversationState;
}

const AGENT_SYSTEM: Record<BeaconAgentId, string> = {
  general: "You are Beacon, the Flare AI OS. Route to FTSO, SparkDEX, FAssets, LayerZero OFT, x402, Bound Work.",
  signals: "You are Beacon Signals. Explain live FTSO feeds and bias. Never invent prices.",
  intel: "You are Beacon Market Intelligence. FTSO + liquidity reasoning. Never build betting markets.",
  portfolio: "You are Beacon Portfolio. Value Coston2 balances with FTSO. Never invent holdings.",
  fassets: "You are Beacon FAssets. Show live Coston2 managers only. Never invent FBTC/FDOGE mint on Coston2.",
  swap: "You are Beacon Swap. SparkDEX pairs are discovered on Flare Mainnet. Coston2 has no SparkDEX router bytecode.",
  liquidity: "You are Beacon Liquidity. Report discovered SparkDEX pools with liquidity > 0 only.",
  bridge: "You are Beacon Bridge. LayerZero FXRP OFT peers from on-chain discovery. Never invent fills.",
  crosschain: "You are Beacon Cross-chain. Same OFT truth as bridge. Never invent destinations.",
  xrpfi: "You are Beacon XRPFi. FXRP rails: FAssets status, SparkDEX, LayerZero OFT.",
  yield: "You are Beacon Yield. Show Coston2 yield-rail on-chain status (shares/assets). Never invent APY.",
  risk: "You are Beacon Risk. FTSO bias + honest posture. Not financial advice.",
  treasury: "You are Beacon Treasury — a verified-read policy/budget lens over the same Coston2 portfolio desk as @portfolio, not a separate vault product. Explain spend rails honestly.",
  pay: "You are Beacon Payment. Every charge names provider, price, reason, ETA.",
  trade: "You are Beacon Trade. FTSO first; SparkDEX only when user confirms on Mainnet.",
  desk: "You are Bound Work. Escrow creative jobs with acceptance.",
  image: "You are Beacon Image. Small logos → x402. Large packs → Bound Offer.",
  research: "You are Beacon Research. Scope then quote; small briefs can be x402.",
};

export type PaidResourceDef = {
  id: string;
  title: string;
  provider: string;
  priceUsdt0: string;
  reason: string;
  etaSeconds: number;
  resource: string;
  flarePrimitive: string;
  agentId: BeaconAgentId;
};

export const PAID_RESOURCES: PaidResourceDef[] = [
  {
    id: "signals-deep",
    title: "FTSO deep pack",
    provider: "Beacon · FTSO V2",
    priceUsdt0: "0.25",
    reason: "Live feeds + bias narrative for trading decisions",
    etaSeconds: 12,
    resource: "/v1/agents/resources/signals-deep",
    flarePrimitive: "FTSO + x402",
    agentId: "signals",
  },
  {
    id: "image-logo",
    title: "Logo / icon still",
    provider: "Beacon media · Flux",
    priceUsdt0: "0.50",
    reason: "Single creative still for a brand mark or icon",
    etaSeconds: 45,
    resource: "/v1/agents/resources/image-logo",
    flarePrimitive: "x402",
    agentId: "image",
  },
  {
    id: "research-brief",
    title: "Research brief",
    provider: "Beacon Research",
    priceUsdt0: "0.75",
    reason: "Scoped written brief with sources checklist",
    etaSeconds: 40,
    resource: "/v1/agents/resources/research-brief",
    flarePrimitive: "x402",
    agentId: "research",
  },
];

export function findPaidResource(id?: string): PaidResourceDef | undefined {
  if (!id) return undefined;
  return PAID_RESOURCES.find((r) => r.id === id);
}

/** When payment settled, force delivery for the quoted service, never re-show the pay catalog. */
export function resolvePaidResourceTurn(opts: {
  paidResource?: boolean;
  serviceId?: string;
  state?: ConversationState | null;
}): { serviceId: string; intent: BeaconAgentId; creativeBrief?: string } | null {
  if (!opts.paidResource) return null;
  const serviceId = opts.serviceId ?? opts.state?.serviceId;
  if (!serviceId) return null;
  const res = findPaidResource(serviceId);
  if (!res) return null;
  return {
    serviceId,
    intent: res.agentId,
    creativeBrief: opts.state?.creativeBrief,
  };
}

export function shouldEmitPayCatalog(paidResource?: boolean): boolean {
  return !paidResource;
}

function pickModel(intent: BeaconAgentId, env: BeaconEnv): string {
  if (
    intent === "swap" ||
    intent === "trade" ||
    intent === "bridge" ||
    intent === "pay" ||
    intent === "signals" ||
    intent === "intel" ||
    intent === "risk" ||
    intent === "liquidity"
  ) {
    return env.AI_MODEL_QUOTE || "gpt-5.6-sol";
  }
  return env.AI_MODEL_GENERATOR || "claude-opus-5";
}

/** Beacon Safe deposit / spend-policy help — must win over sticky swap state. */
function wantsSafeHelp(message: string): boolean {
  const m = message.toLowerCase().trim();
  // Bare chip-style "Safe" / "@safe" — avoid matching "is it safe to swap".
  if (/^@?safe$/.test(m)) return true;
  // "swap 1 USDT0 from Beacon Safe" is a Safe-funded swap, not onboarding help.
  if (/\b(swap|bridge|oft|layerzero|quote)\b/.test(m)) return false;
  return /@safe\b|beacon safe|open safe|spend policy|fund (the )?safe|deposit (into |to )?(beacon )?safe|help me (with )?beacon safe|set (spend )?policy|agent vault|prepaid (ai )?budget/.test(
    m,
  );
}

function detectIntent(message: string, fallback: BeaconAgentId, state?: ConversationState): BeaconAgentId {
  const m = message.toLowerCase();
  if (wantsSafeHelp(m)) return "general";
  if (/@signals|ftso|price feed|oracle|\bsignals?\b/.test(m)) return "signals";
  if (/@intel|\bintel\b|market intel|intelligence|probability|confidence|risk posture/.test(m)) return "intel";
  if (/@portfolio|\bportfolio\b|balances?|holdings|net worth/.test(m)) return "portfolio";
  if (/@fassets|\bfassets\b|fbtc|fdoge|mint fxrp|redeem fxrp|asset manager/.test(m)) return "fassets";
  if (/@liquidity|pools?|sparkdex pairs/.test(m)) return "liquidity";
  if (/@yield|\byield\b|apy|\bearn\b/.test(m)) return "yield";
  if (/@risk\b|\brisk\b/.test(m)) return "risk";
  if (/@treasury/.test(m)) return "treasury";
  if (/@crosschain|cross-chain|\bcross chain\b/.test(m)) return "crosschain";
  if (/@xrpfi|xrp fi/.test(m)) return "xrpfi";
  if (/@swap|\bswap\b|usdt0.*fxrp/.test(m) && /swap|usdt|fxrp|@swap|wflr|wnat/.test(m)) return "swap";
  if (/@bridge|\bbridge\b|layerzero|oft|stargate/.test(m)) return "bridge";
  if (/@pay|x402|micropay/.test(m)) return "pay";
  if (/@trade|trade signal|\blong\b|\bshort\b/.test(m)) return "trade";
  if (/@desk|bound work/.test(m)) return "desk";
  if (/@image|create image|generate image|\blogo\b|icon for|thumbnail/.test(m)) return "image";
  if (/@video|create video|generate video|storyboard|voice\b/.test(m)) return "desk";
  if (/@research|\bresearch\b|competitors|market pack/.test(m)) return "research";
  if (/@general/.test(m)) return "general";
  if (state && state.phase !== "idle" && !/^@\w+/.test(m.trim())) {
    return state.intent;
  }
  return fallback;
}

/** Never match the trailing 0 inside USDT0 / FXRP ticker names. */
export function extractAmount(message: string): string | null {
  if (/\ball\b/i.test(message)) return "all";
  const hit = message.match(/(?<![A-Za-z])(\d+(?:\.\d+)?)\s*(?:usdt0|usdt|usd|fxrp)?(?![A-Za-z0-9])/i);
  if (!hit) return null;
  const n = hit[1]!;
  if (n === "0" || n === "0.0") return null;
  return n;
}

function wantsConfirm(message: string): boolean {
  return /\b(confirm|yes|proceed|do it|execute|go ahead|approve|bridge now)\b/i.test(message);
}

/** Explicit pairs/catalog discovery — not a quote turn. */
function wantsSwapDiscovery(message: string): boolean {
  return /\b(pairs?|pools?|catalog|discover|what can i swap|available pairs|list pairs|show pairs)\b/i.test(
    message,
  );
}

/** Explicit routes/catalog discovery — not a quote turn. */
function wantsBridgeDiscovery(message: string): boolean {
  return /\b(routes?|destinations?|peers?|catalog|discover|where can i bridge|list routes|show routes)\b/i.test(
    message,
  );
}

function sanitizeAssistantText(text: string): string {
  if (!text) return "Something went wrong on my side. Please try again.";
  if (/<!doctype|<html|<meta |AI provider|stack|ECONNREFUSED/i.test(text)) {
    return "I hit a temporary issue talking to the model. Your Flare tools are fine, please send that again.";
  }
  // Strip accidental hex dumps longer than a short address mention
  return text.replace(/0x[a-fA-F0-9]{64,}/g, "[tx]").trim();
}

async function narrate(opts: {
  intent: BeaconAgentId;
  userMessage: string;
  situation: string;
  /** Shown if the model is unavailable, never dump internal situation. */
  fallback?: string;
  env: BeaconEnv;
}): Promise<{ text: string; model: string; displayModel: string }> {
  const model = pickModel(opts.intent, opts.env);
  const safeFallback =
    opts.fallback ??
    "Sure, I'm with you. Tell me the next detail you want, and I'll keep this conversational.";
  if (!isAiConfigured(opts.env)) {
    return {
      text: safeFallback,
      model: "beacon-local",
      displayModel: displayModelName("beacon-local", { fallback: true }),
    };
  }
  try {
    const result = await chatForRole("quote", [
      {
        role: "system",
        content: `${AGENT_SYSTEM[opts.intent]}
Speak like Claude/ChatGPT: warm, clear, concise. Never invent transaction hashes.
Never mention AgentRouter, providers keys, APIs, calldata, HTML, or internal errors.
Never dump addresses unless the user asks. Prefer natural language.
MockUSDT0 is for Beacon pay/escrow and Beacon Safe spends on Coston2. Prefer Safe desk swaps on Coston2 (no MetaMask). SparkDEX Uniswap V3 execute is Flare Mainnet EOA-only when the user explicitly asks for Mainnet DEX.
Pipeline: Intent → Clarify → Quote → Policy → Pay → Execute → Observe → Receipt → History → Resume.
Situation for this turn:\n${opts.situation}`,
      },
      { role: "user", content: opts.userMessage },
    ], { temperature: 0.4, maxTokens: 500, env: opts.env });
    const returnedModel = result.model ?? model;
    return {
      text: sanitizeAssistantText(result.content),
      model: returnedModel,
      displayModel: displayModelName(returnedModel),
    };
  } catch {
    return {
      text: sanitizeAssistantText(safeFallback),
      model: "beacon-local",
      displayModel: displayModelName("beacon-local", { fallback: true }),
    };
  }
}

/** Deliver a paid resource once, no x402 quote cards. */
export async function fulfillPaidResource(opts: {
  serviceId: string;
  message: string;
  creativeBrief?: string;
  settlementTxHash?: string;
  wallet?: string;
  env: BeaconEnv;
}): Promise<AgentChatResult | null> {
  const res = findPaidResource(opts.serviceId);
  if (!res) return null;

  const brief =
    opts.creativeBrief?.trim() ||
    opts.message.replace(/^pay(ment)?\s*/i, "").trim() ||
    opts.message;
  const cards: AgentCard[] = [];
  const txHint = opts.settlementTxHash;
  const idleState: ConversationState = {
    intent: res.agentId,
    phase: "idle",
    serviceId: res.id,
    creativeBrief: brief,
    quotePrice: res.priceUsdt0,
  };

  if (res.id === "signals-deep") {
    const snap = await readFtsoFeeds(opts.env);
    const signal = buildTradeSignal(snap.feeds);
    const feedLines = snap.feeds.map((f) => `${f.symbol}=${f.value}`).join(" · ");
    const deepContent = [
      "FTSO deep pack",
      "",
      "Live feeds (Coston2)",
      feedLines,
      "",
      `Bias · ${signal.bias}`,
      signal.summary,
      "",
      "Trading notes",
      "1. Prefer live FTSO reads over screenshots for size decisions.",
      "2. SparkDEX USDT0→FXRP is the DeFi path; MockUSDT0 is for x402 / escrow only.",
      "3. Cross-check explorer settlement after any paid unlock.",
      "",
      txHint ? `Settlement · ${txHint}` : "Settlement · confirmed via facilitator",
    ].join("\n");
    cards.push({
      type: "ftso_signals",
      title: "Live FTSO · Coston2",
      feeds: snap.feeds.map((f) => ({ symbol: f.symbol, value: f.value })),
      bias: signal.bias,
      summary: signal.summary,
      ftsoV2: snap.ftsoV2,
      timestamp: snap.timestamp,
    });
    const narr = await narrate({
      intent: "signals",
      userMessage: brief,
      situation: `Paid FTSO deep pack. Bias=${signal.bias}. ${signal.summary}. Keep the chat line short; full pack is in the card.`,
      fallback: `${signal.summary} Bias: ${signal.bias}. Paid FTSO deep pack unlocked.`,
      env: opts.env,
    });
    cards.push({
      type: "media_result",
      title: "FTSO deep pack",
      kind: "research",
      summary: `Bias ${signal.bias} · live FTSO on Coston2`,
      content: deepContent,
      paymentTxHint: txHint,
      serviceId: res.id,
    });
    return {
      agentId: "signals",
      text: narr.text,
      cards,
      model: narr.model,
      displayModel: narr.displayModel,
      paid: true,
      state: idleState,
    };
  }

  if (res.id === "image-logo") {
    const { generateProImage } = await import("./mediaPro.js");
    try {
      const img = await generateProImage(brief, { env: opts.env, width: 1024, height: 1024 });
      const b64 = img.bytes.toString("base64");
      cards.push({
        type: "media_result",
        title: "Image ready",
        kind: "image",
        summary: `Generated via ${img.provider} after x402 settlement on Coston2.`,
        content: `data:${img.mimeType};base64,${b64}`,
        mimeType: img.mimeType,
        paymentTxHint: txHint,
        serviceId: res.id,
      });
      return {
        agentId: "image",
        text: txHint
          ? `Payment settled (${txHint.slice(0, 10)}…). Here’s your image.`
          : "Payment settled. Here’s your image.",
        cards,
        model: "beacon-media",
        displayModel: displayModelName("beacon-media"),
        paid: true,
        state: idleState,
      };
    } catch {
      cards.push({
        type: "desk_link",
        title: "Generation busy, use Bound Work",
        href: "/flow/desk",
        summary: "Payment recorded. Open Bound Work to retry with escrow if instant media is saturated.",
      });
      return {
        agentId: "image",
        text: "Payment settled but generation is saturated, try Bound Work for a retry with escrow.",
        cards,
        model: "beacon-media",
        displayModel: displayModelName("beacon-media", { fallback: true }),
        paid: true,
        state: idleState,
      };
    }
  }

  if (res.id === "research-brief") {
    const { generateResearchBrief } = await import("./researchBrief.js");
    const briefDoc = await generateResearchBrief({
      topic: brief,
      env: opts.env,
      settlementTxHash: txHint,
    });
    cards.push({
      type: "media_result",
      title: "Research brief",
      kind: "research",
      summary: briefDoc.summary,
      content: briefDoc.content,
      paymentTxHint: txHint,
      serviceId: res.id,
    });
    return {
      agentId: "research",
      text: txHint
        ? `Payment settled (${txHint.slice(0, 10)}…). Your research brief is ready below.`
        : "Payment settled. Your research brief is ready below.",
      cards,
      model: briefDoc.model,
      displayModel: briefDoc.displayModel,
      paid: true,
      state: idleState,
    };
  }

  return null;
}

export async function runBeaconAgentChat(opts: {
  agentId?: BeaconAgentId;
  message: string;
  wallet?: string;
  paidResource?: boolean;
  serviceId?: string;
  settlementTxHash?: string;
  state?: ConversationState | null;
  env?: BeaconEnv;
}): Promise<AgentChatResult> {
  const env = opts.env ?? loadEnv();
  const prev = opts.state ?? null;

  const paidTurn = resolvePaidResourceTurn({
    paidResource: opts.paidResource,
    serviceId: opts.serviceId,
    state: prev,
  });
  if (paidTurn) {
    const fulfilled = await fulfillPaidResource({
      serviceId: paidTurn.serviceId,
      message: opts.message,
      creativeBrief: paidTurn.creativeBrief ?? prev?.creativeBrief,
      settlementTxHash: opts.settlementTxHash,
      wallet: opts.wallet,
      env,
    });
    if (fulfilled) return fulfilled;
  }

  // Safe help before sticky swap/bridge state can swallow the turn.
  if (wantsSafeHelp(opts.message)) {
    const cards: AgentCard[] = [
      {
        type: "desk_link",
        title: "Beacon Safe",
        href: "/flow/security",
        summary:
          "Deposit USDT0 with one MetaMask EIP-3009 signature. Anyone can fund; withdraw and spend policy stay owner-only.",
      },
    ];
    const narr = await narrate({
      intent: "general",
      userMessage: opts.message,
      situation:
        "User wants to fund Beacon Safe and/or set spend policy. Guide them to /flow/security. EIP-3009 deposit (no approve). MockUSDT0 on Coston2. Do not start a SparkDEX swap.",
      fallback:
        "Open **Beacon Safe** to deposit USDT0 with one MetaMask signature (EIP-3009). Anyone can fund the prepaid pool; withdraw and spend policy stay with the Safe owner.",
      env,
    });
    return {
      agentId: "general",
      text: narr.text,
      cards,
      model: narr.model,
      displayModel: narr.displayModel,
      paid: true,
      state: { intent: "general", phase: "idle" },
    };
  }

  const intent = detectIntent(opts.message, opts.agentId ?? prev?.intent ?? "general", prev ?? undefined);
  const cards: AgentCard[] = [];
  let state: ConversationState = prev && prev.intent === intent
    ? { ...prev, intent }
    : { intent, phase: "idle" };

  // --- Signals ---
  if (intent === "signals" || intent === "trade") {
    const snap = await readFtsoFeeds(env);
    const signal = buildTradeSignal(snap.feeds);
    cards.push({
      type: "ftso_signals",
      title: "Live FTSO · Coston2",
      feeds: snap.feeds.map((f) => ({ symbol: f.symbol, value: f.value })),
      bias: signal.bias,
      summary: signal.summary,
      ftsoV2: snap.ftsoV2,
      timestamp: snap.timestamp,
    });
    state = { intent, phase: "idle" };
    const narr = await narrate({
      intent,
      userMessage: opts.message,
      situation: `User asked for market signals. Bias=${signal.bias}. ${signal.summary}. Feeds: ${signal.highlights.join(", ")}.`,
      fallback: `${signal.summary} Bias looks ${signal.bias} from live FTSO feeds.`,
      env,
    });
    if (intent === "trade" && !/swap/i.test(opts.message)) {
      const shouldSwap = signal.bias === "risk-on" || /buy|long|accumulate/i.test(signal.summary);
      return {
        agentId: intent,
        text: `${narr.text}\n\n${
          shouldSwap
            ? "FTSO bias leans constructive, I can prepare a USDT0 → FXRP swap if you want exposure. How much?"
            : "FTSO bias does not scream urgency, holding cash (USDT0) may be fine. Say if you still want a swap quote."
        }`,
        cards,
        model: narr.model,
        displayModel: narr.displayModel,
        paid: true,
        state,
      };
    }
    if (intent === "signals") {
      return {
        agentId: intent,
        text: narr.text,
        cards,
        model: narr.model,
        displayModel: narr.displayModel,
        paid: true,
        state,
      };
    }
  }

  // --- Swap multi-turn (SparkDEX = Flare Mainnet only) ---
  if (intent === "swap" || (intent === "trade" && (/swap|fxrp|usdt|wflr|wnat/i.test(opts.message) || state.phase !== "idle"))) {
    const wallet = opts.wallet;
    const discovered = await discoverSparkDexPools(env);
    const dep = discovered.deployment;
    const discoveryOnly = wantsSwapDiscovery(opts.message) && !extractAmount(opts.message);

    const pushSwapPairs = () => {
      cards.push({
        type: "swap_pairs",
        title: "SparkDEX liquid pairs",
        network: dep.network === "flare" ? "Flare Mainnet" : "unavailable",
        chainId: dep.chainId || 14,
        pairs: discovered.pairs.map((p) => ({
          pairKey: p.pairKey,
          symbolA: p.symbolA,
          symbolB: p.symbolB,
          bestFee: p.bestFee,
          liquidity: p.liquidity,
        })),
        honesty: dep.honesty,
        flarePrimitive: "SparkDEX",
      });
    };

    // Discovery/catalog-only: pairs card, no quote spam
    if (discoveryOnly) {
      pushSwapPairs();
      const narr = await narrate({
        intent: "swap",
        userMessage: opts.message,
        situation: `User asked for SparkDEX pair discovery only. Network=${dep.network}. ${dep.honesty}`,
        fallback: `SparkDEX liquid pairs are on **Flare Mainnet** only. Coston2 x402 uses **MockUSDT0** (pay/escrow), not SparkDEX. ${dep.honesty}`,
        env,
      });
      return {
        agentId: "swap",
        text: narr.text,
        cards,
        model: narr.model,
        displayModel: narr.displayModel,
        paid: true,
        state: { intent: "swap", phase: "clarify" },
      };
    }

    if (!wallet) {
      pushSwapPairs();
      cards.push({
        type: "insufficient",
        title: "Connect your wallet",
        summary:
          "Connect MetaMask as the FXRP recipient on Coston2. Funded Beacon Safe swaps stay on Coston2 (agent executes — no MetaMask per trade, no Mainnet).",
        faucetHref: "https://faucet.flare.network/coston2",
      });
      const narr = await narrate({
        intent: "swap",
        userMessage: opts.message,
        situation:
          "Wallet missing. Prefer Coston2 Beacon Safe spend when funded; never push Mainnet.",
        fallback: `Connect your wallet (FXRP recipient) on **Coston2**. Prefer **Beacon Safe** after deposit — agent executes without MetaMask per trade. We never ask you to switch to Mainnet.`,
        env,
      });
      return {
        agentId: "swap",
        text: narr.text,
        cards,
        model: narr.model,
        displayModel: narr.displayModel,
        paid: true,
        state: { intent: "swap", phase: "clarify" },
      };
    }

    const fxrpC2 = await resolveFxrpAddress(env);
    const resolvedVault = await resolveVaultForWallet({
      wallet,
      env,
      personalOnly: true,
    });
    const vaultAddr = resolvedVault.address;
    const deskAddr = resolveSwapDeskAddress(env);
    const vaultStatus = vaultAddr
      ? await readAgentVaultStatus({
          address: vaultAddr,
          wallet,
          env,
          personalOnly: false,
        }).catch(() => null)
      : null;
    const safeBalDisplay =
      vaultStatus && vaultStatus.configured ? vaultStatus.balanceDisplay : "0";

    const [usdtBal, fxrpBal] = await Promise.all([
      readErc20Balance(COSTON2_USDT0, wallet, env).catch(() => ({
        formatted: "0",
        raw: 0n,
        decimals: 6,
        symbol: "USDT0",
      })),
      readErc20Balance(fxrpC2, wallet, env).catch(() => ({
        formatted: "0",
        raw: 0n,
        decimals: 6,
        symbol: "FXRP",
      })),
    ]);

    let amount = extractAmount(opts.message) ?? state.amountInUnits ?? null;
    if (amount === "all") {
      amount =
        vaultStatus && vaultStatus.configured && Number(vaultStatus.balanceDisplay) > 0
          ? vaultStatus.balanceDisplay
          : usdtBal.formatted;
    }

    const msg = opts.message.toLowerCase();
    const wantsFxrpToUsdt =
      /fxrp\s*(to|→|->)\s*usdt|swap\s*fxrp/.test(msg) && !/usdt0?\s*(to|→|->)\s*fxrp/.test(msg);
    const wantsWflr = /wflr|wnat|wflare/.test(msg);
    const preferSafe =
      Boolean(deskAddr && vaultAddr) &&
      !wantsFxrpToUsdt &&
      !wantsWflr &&
      env.CHAIN_ID === 114;

    let tokenIn = dep.usdt0;
    let tokenOut = dep.fxrp;
    if (wantsFxrpToUsdt) {
      tokenIn = dep.fxrp;
      tokenOut = dep.usdt0;
    } else if (wantsWflr && /to\s*fxrp|→\s*fxrp/.test(msg)) {
      tokenIn = dep.wnat;
      tokenOut = dep.fxrp;
    } else if (wantsWflr && /fxrp.*wflr|to\s*wflr/.test(msg)) {
      tokenIn = dep.fxrp;
      tokenOut = dep.wnat;
    } else if (state.swapTokenIn && state.swapTokenOut) {
      tokenIn = state.swapTokenIn;
      tokenOut = state.swapTokenOut;
    }

    if (!amount) {
      pushSwapPairs();
      cards.push({
        type: "swap_clarify",
        title: "How much should we swap?",
        wallet,
        usdt0Balance: usdtBal.formatted,
        fxrpBalance: fxrpBal.formatted,
        faucetHref: "https://faucet.flare.network/coston2",
      });
      const narr = await narrate({
        intent: "swap",
        userMessage: opts.message,
        situation: `Ask amount. Beacon Safe balance ${safeBalDisplay} MockUSDT0. Prefer Coston2 Safe path when funded; SparkDEX is Mainnet-only.`,
        fallback: `Beacon Safe holds **${safeBalDisplay} MockUSDT0**. Say e.g. **swap 1 USDT0 to FXRP** — if Safe is funded, the agent spends on **Coston2** (no MetaMask Mainnet). SparkDEX remains Mainnet-only for EOA pairs.`,
        env,
      });
      return {
        agentId: "swap",
        text: narr.text,
        cards,
        model: narr.model,
        displayModel: narr.displayModel,
        paid: true,
        state: { intent: "swap", phase: "clarify", swapTokenIn: tokenIn, swapTokenOut: tokenOut },
      };
    }

    const confirmed =
      wantsConfirm(opts.message) &&
      (state.phase === "await_confirm" || state.phase === "ready_execute") &&
      Boolean(state.amountInUnits || amount);

    // --- Prefer Coston2 Beacon Safe (no Mainnet MetaMask) ---
    if (preferSafe) {
      const safeQuote = await prepareBeaconSafeSwap(
        { amountInUnits: amount, recipient: wallet, address: vaultAddr },
        env,
      );
      if (safeQuote.ok) {
        if (!confirmed) {
          cards.push({
            type: "swap_quote",
            title: "Swap quote · Beacon Safe (Coston2)",
            amountInDisplay: amount,
            estimatedFxrp: safeQuote.estimatedOut,
            estimatedOut: safeQuote.estimatedOut,
            symbolIn: safeQuote.symbolIn,
            symbolOut: safeQuote.symbolOut,
            xrpUsd: safeQuote.xrpUsd,
            wallet,
            usdt0Balance: safeQuote.vaultBalanceDisplay,
            network: safeQuote.network,
            chainId: safeQuote.chainId,
            note: `${safeQuote.estimateBasis}. Agent executes from Beacon Safe — no MetaMask, no Mainnet switch.`,
            honesty: safeQuote.honesty,
            flarePrimitive: "Beacon Safe + FTSO",
            quoteSource: safeQuote.quoteSource,
            estimateBasis: safeQuote.estimateBasis,
            slippageBps: safeQuote.slippageBps,
            amountOutMinimum: safeQuote.amountOutMinimum,
            mode: "beacon_safe",
            requiresMetaMask: false,
            vaultBalanceDisplay: safeQuote.vaultBalanceDisplay,
            ftsoGuard: safeQuote.ftsoGuard,
          });
          const narr = await narrate({
            intent: "swap",
            userMessage: opts.message,
            situation: `Safe quote ${amount} MockUSDT0 → ~${safeQuote.estimatedOut} FXRP on Coston2. No MetaMask. Ask confirm.`,
            fallback: `Beacon Safe quote: **${amount} MockUSDT0 ≈ ${safeQuote.estimatedOut} FXRP** on **Coston2** (FTSO-synced desk).\n\nLive market data protects this execution (FTSO age ${safeQuote.ftsoGuard.feedAge}s).\n\n${safeQuote.honesty}\n\nReply **confirm** — agent spends from Safe (no MetaMask).`,
            env,
          });
          return {
            agentId: "swap",
            text: narr.text,
            cards,
            model: narr.model,
            displayModel: narr.displayModel,
            paid: true,
            state: {
              intent: "swap",
              phase: "await_confirm",
              amountInUnits: amount,
              swapTokenIn: safeQuote.tokenIn,
              swapTokenOut: safeQuote.tokenOut,
            },
          };
        }

        const finalAmount = amount || state.amountInUnits || "1";
        const safePrep = await prepareBeaconSafeSwap(
          { amountInUnits: finalAmount, recipient: wallet },
          env,
        );
        if (!safePrep.ok) {
          return {
            agentId: "swap",
            text: safePrep.error,
            cards,
            model: "beacon-local",
            displayModel: displayModelName("beacon-local", { fallback: true }),
            paid: true,
            state: { intent: "swap", phase: "clarify" },
          };
        }
        cards.push({
          type: "swap_prepare",
          title: "Spend from Beacon Safe · Coston2",
          tokenIn: safePrep.tokenIn,
          tokenOut: safePrep.tokenOut,
          router: safePrep.desk,
          amountIn: safePrep.amountIn,
          amountInDisplay: safePrep.amountInDisplay,
          amountOutMinimum: safePrep.amountOutMinimum,
          estimatedFxrp: safePrep.estimatedOut,
          estimatedOut: safePrep.estimatedOut,
          symbolIn: safePrep.symbolIn,
          symbolOut: safePrep.symbolOut,
          approveTo: safePrep.vault,
          swapTo: safePrep.desk,
          approveData: "0x",
          swapData: "0x",
          docs: safePrep.docs,
          warning: `${safePrep.symbolIn}→${safePrep.symbolOut} from Beacon Safe on Coston2. Executor signs — no MetaMask.`,
          chainId: safePrep.chainId,
          network: safePrep.network,
          honesty: safePrep.honesty,
          requiresChainSwitch: false,
          requiresMetaMask: false,
          mode: "beacon_safe",
          vault: safePrep.vault,
          desk: safePrep.desk,
          flarePrimitive: "Beacon Safe + FTSO",
          quoteSource: safePrep.quoteSource,
          estimateBasis: safePrep.estimateBasis,
          slippageBps: safePrep.slippageBps,
          vaultBalanceDisplay: safePrep.vaultBalanceDisplay,
        });
        const narr = await narrate({
          intent: "swap",
          userMessage: opts.message,
          situation: `Prepared Safe spend ${finalAmount} MockUSDT0→FXRP on Coston2. No MetaMask.`,
          fallback: `Prepared. Tap **Execute from Beacon Safe** — agent spends on **Coston2** (no MetaMask, no Mainnet).`,
          env,
        });
        return {
          agentId: "swap",
          text: narr.text,
          cards,
          model: narr.model,
          displayModel: narr.displayModel,
          paid: true,
          state: {
            intent: "swap",
            phase: "ready_execute",
            amountInUnits: finalAmount,
            swapTokenIn: safePrep.tokenIn,
            swapTokenOut: safePrep.tokenOut,
          },
        };
      }
      // Safe preferred but not ready — NEVER fall through to Mainnet on Coston2 product mode.
      if (!wantsFxrpToUsdt && !wantsWflr) {
        cards.push({
          type: "insufficient",
          title: "Beacon Safe not ready for this swap",
          summary: safeQuote.error,
          faucetHref: "/flow/security",
        });
        const narr = await narrate({
          intent: "swap",
          userMessage: opts.message,
          situation: `Safe path failed: ${safeQuote.error}. Stay on Coston2 — do not push Mainnet switch as the primary fix.`,
          fallback: `${safeQuote.error}\n\nDeposit MockUSDT0 to **Beacon Safe** and set spend caps (or ask desk to sync policy). We stay on **Coston2** — SparkDEX Mainnet is disabled for this Flow.`,
          env,
        });
        return {
          agentId: "swap",
          text: narr.text,
          cards,
          model: narr.model,
          displayModel: narr.displayModel,
          paid: true,
          state: { intent: "swap", phase: "clarify", amountInUnits: amount },
        };
      }
    }

    // Coston2-only product rule: never ask MetaMask to switch to Flare Mainnet (14).
    // SparkDEX bytecode exists on Mainnet only — that path is intentionally unavailable here.
    if (env.CHAIN_ID === 114) {
      cards.push({
        type: "insufficient",
        title: "Stay on Flare Testnet Coston2",
        summary:
          "Beacon Flow does not switch to Flare Mainnet. Fund Beacon Safe for MockUSDT0→FXRP on Coston2, or use a different Coston2 rail.",
        faucetHref: "/flow/security",
      });
      const narr = await narrate({
        intent: "swap",
        userMessage: opts.message,
        situation:
          "Blocked SparkDEX Mainnet fallback. Product is Coston2-only (chain 114).",
        fallback:
          "This Flow stays on **Flare Testnet Coston2 (114)**. We never ask you to switch to Mainnet.\n\nFor USDT0→FXRP: fund **Beacon Safe** at `/flow/security` so the agent can execute without MetaMask.",
        env,
      });
      return {
        agentId: "swap",
        text: narr.text,
        cards,
        model: narr.model,
        displayModel: narr.displayModel,
        paid: true,
        state: { intent: "swap", phase: "clarify", amountInUnits: amount },
      };
    }

    if (dep.network === "none" || !discovered.pairs.length) {
      pushSwapPairs();
      const narr = await narrate({
        intent: "swap",
        userMessage: opts.message,
        situation: "No SparkDEX deployment reachable.",
        fallback: dep.honesty,
        env,
      });
      return {
        agentId: "swap",
        text: narr.text,
        cards,
        model: narr.model,
        displayModel: narr.displayModel,
        paid: true,
        state: { intent: "swap", phase: "idle" },
      };
    }

    if (!confirmed) {
      // Quote phase: DO NOT emit swap_pairs alongside swap_quote
      const prepPreview = await prepareSparkDexSwap(
        { tokenIn, tokenOut, amountInUnits: amount, recipient: wallet },
        env,
      );
      if (!prepPreview.ok) {
        cards.push({
          type: "insufficient",
          title: "Cannot quote pair",
          summary: prepPreview.error,
          faucetHref: "https://dev.flare.network/fxrp/token-interactions/usdt0-fxrp-swap",
        });
        return {
          agentId: "swap",
          text: `${prepPreview.error}. ${prepPreview.honesty}`,
          cards,
          model: "beacon-local",
          displayModel: displayModelName("beacon-local", { fallback: true }),
          paid: true,
          state: { intent: "swap", phase: "clarify" },
        };
      }
      cards.push({
        type: "swap_quote",
        title: "Swap quote · SparkDEX QuoterV2",
        amountInDisplay: amount,
        estimatedFxrp: prepPreview.symbolOut.toUpperCase().includes("FXRP")
          ? prepPreview.estimatedOut
          : prepPreview.estimatedOut,
        estimatedOut: prepPreview.estimatedOut,
        symbolIn: prepPreview.symbolIn,
        symbolOut: prepPreview.symbolOut,
        xrpUsd: 0,
        wallet,
        usdt0Balance: usdtBal.formatted,
        network: prepPreview.network,
        chainId: prepPreview.chainId,
        note: `${prepPreview.estimateBasis}. Slippage ${prepPreview.slippageBps} bps → minOut. Price impact vs FTSO mid: ${prepPreview.priceImpactVsFtsoBps ?? "n/a"} bps (FTSO is narrative only). ${prepPreview.requiresChainSwitch ? "MetaMask must switch to Flare Mainnet (14) before Approve+Swap." : ""}`,
        honesty: prepPreview.honesty,
        flarePrimitive: "SparkDEX QuoterV2",
        pairsHint: discovered.pairs.map((p) => `${p.symbolA}/${p.symbolB}@${p.bestFee}`),
        quoteSource: prepPreview.quoteSource,
        estimateBasis: prepPreview.estimateBasis,
        slippageBps: prepPreview.slippageBps,
        priceImpactVsFtsoBps: prepPreview.priceImpactVsFtsoBps,
        ftsoMidOut: prepPreview.ftsoMidOut,
        amountOutMinimum: prepPreview.amountOutMinimum,
        mode: "sparkdex_mainnet",
        requiresMetaMask: true,
      });
      const narr = await narrate({
        intent: "swap",
        userMessage: opts.message,
        situation: `QuoterV2 quote ${amount} ${prepPreview.symbolIn} → ~${prepPreview.estimatedOut} ${prepPreview.symbolOut} on Flare Mainnet SparkDEX (not FTSO). Slippage ${prepPreview.slippageBps}bps. Ask confirm. Mention chain switch if needed.`,
        fallback: `QuoterV2: **${amount} ${prepPreview.symbolIn} ≈ ${prepPreview.estimatedOut} ${prepPreview.symbolOut}** on **Flare Mainnet** SparkDEX (minOut after ${prepPreview.slippageBps} bps slippage).\n\n${prepPreview.honesty}\n\nReply **confirm** to prepare Approve + Swap.`,
        env,
      });
      return {
        agentId: "swap",
        text: narr.text,
        cards,
        model: narr.model,
        displayModel: narr.displayModel,
        paid: true,
        state: {
          intent: "swap",
          phase: "await_confirm",
          amountInUnits: amount,
          swapTokenIn: tokenIn,
          swapTokenOut: tokenOut,
        },
      };
    }

    // Prepare phase: DO NOT emit swap_pairs alongside swap_prepare
    const finalAmount = amount || state.amountInUnits || "1";
    const prep = await prepareSparkDexSwap(
      {
        tokenIn: state.swapTokenIn || tokenIn,
        tokenOut: state.swapTokenOut || tokenOut,
        amountInUnits: finalAmount,
        recipient: wallet,
      },
      env,
    );
    if (!prep.ok) {
      return {
        agentId: "swap",
        text: prep.error,
        cards,
        model: "beacon-local",
        displayModel: displayModelName("beacon-local", { fallback: true }),
        paid: true,
        state: { intent: "swap", phase: "clarify" },
      };
    }
    cards.push({
      type: "swap_prepare",
      title: prep.requiresChainSwitch ? "Switch to Flare Mainnet · then Confirm" : "Confirm in wallet",
      tokenIn: prep.tokenIn,
      tokenOut: prep.tokenOut,
      router: prep.router,
      amountIn: prep.amountIn,
      amountInDisplay: prep.amountInDisplay,
      amountOutMinimum: prep.amountOutMinimum,
      estimatedFxrp: prep.estimatedOut,
      estimatedOut: prep.estimatedOut,
      symbolIn: prep.symbolIn,
      symbolOut: prep.symbolOut,
      approveTo: prep.approveTo,
      swapTo: prep.swapTo,
      approveData: prep.approveData,
      swapData: prep.swapData,
      docs: prep.docs,
      warning: `${prep.symbolIn}→${prep.symbolOut} on SparkDEX (${prep.network}). Pool fee ${prep.fee}. QuoterV2 minOut (slippage ${prep.slippageBps} bps). ${prep.honesty}`,
      chainId: prep.chainId,
      network: prep.network,
      pool: prep.pool,
      fee: prep.fee,
      honesty: prep.honesty,
      requiresChainSwitch: prep.requiresChainSwitch,
      requiresMetaMask: true,
      mode: "sparkdex_mainnet",
      flarePrimitive: "SparkDEX QuoterV2",
      quoteSource: prep.quoteSource,
      estimateBasis: prep.estimateBasis,
      slippageBps: prep.slippageBps,
      priceImpactVsFtsoBps: prep.priceImpactVsFtsoBps,
      ftsoMidOut: prep.ftsoMidOut,
      quoter: prep.quoter,
    });
    const narr = await narrate({
      intent: "swap",
      userMessage: opts.message,
      situation: `Prepared Mainnet swap ${finalAmount} ${prep.symbolIn}→${prep.symbolOut}. Chain switch=${prep.requiresChainSwitch}.`,
      fallback: prep.requiresChainSwitch
        ? `Prepared. Switch MetaMask to **Flare Mainnet**, then **Approve + Swap**.`
        : `Confirmed. Tap **Approve + Swap** — explorer link appears after confirmation.`,
      env,
    });
    return {
      agentId: "swap",
      text: narr.text,
      cards,
      model: narr.model,
      displayModel: narr.displayModel,
      paid: true,
      state: {
        intent: "swap",
        phase: "ready_execute",
        amountInUnits: finalAmount,
        swapTokenIn: prep.tokenIn,
        swapTokenOut: prep.tokenOut,
      },
    };
  }

  // --- OS agents: portfolio / fassets / intel / liquidity / yield / risk / treasury / crosschain / xrpfi ---
  if (
    intent === "portfolio" ||
    intent === "treasury" ||
    intent === "fassets" ||
    intent === "intel" ||
    intent === "liquidity" ||
    intent === "yield" ||
    intent === "risk" ||
    intent === "crosschain" ||
    intent === "xrpfi"
  ) {
    if (intent === "portfolio" || intent === "treasury") {
      if (!opts.wallet) {
        cards.push({
          type: "insufficient",
          title: "Connect your wallet",
          summary:
            intent === "treasury"
              ? "Treasury is a verified-read policy/budget view of your Coston2 desk balances."
              : "Portfolio reads live Coston2 balances.",
          faucetHref: "https://faucet.flare.network/coston2",
        });
        return {
          agentId: intent,
          text:
            intent === "treasury"
              ? "Connect your wallet for a verified-read treasury/policy budget view of the same Coston2 desk as Portfolio."
              : "Connect your wallet so I can value your Coston2 balances with FTSO.",
          cards,
          model: "beacon-local",
          displayModel: displayModelName("beacon-local", { fallback: true }),
          paid: true,
          state: { intent, phase: "clarify" },
        };
      }
      const desk = await readPortfolioDesk(opts.wallet, env);
      cards.push({
        type: "portfolio_desk",
        title:
          intent === "treasury"
            ? "Treasury · verified-read policy budget (same desk as Portfolio)"
            : "Portfolio · FTSO marked",
        flarePrimitive: desk.flarePrimitive,
        honesty:
          intent === "treasury"
            ? `${desk.honesty} Treasury is not a separate vault product — it is a verified-read policy/budget lens over the same Coston2 balances as Portfolio.`
            : desk.honesty,
        totalUsd: desk.totalUsd,
        positions: desk.positions.map((p) => ({
          symbol: p.symbol,
          balance: p.balance,
          usdValue: p.usdValue,
        })),
        recommended: desk.recommended,
      });
      const narr = await narrate({
        intent,
        userMessage: opts.message,
        situation:
          intent === "treasury"
            ? `Treasury (policy budget lens, same desk as Portfolio). totalUsd≈$${desk.totalUsd}. Positions: ${desk.positions.map((p) => `${p.symbol}=${p.balance}`).join(", ")}. ${desk.recommended.join(" ")}`
            : `Portfolio totalUsd≈$${desk.totalUsd}. Positions: ${desk.positions.map((p) => `${p.symbol}=${p.balance}`).join(", ")}. ${desk.recommended.join(" ")}`,
        fallback:
          intent === "treasury"
            ? `Treasury (verified-read budget view of the Portfolio desk): ~**$${desk.totalUsd}** on Coston2 (FTSO). ${desk.recommended[0] ?? ""}`
            : `Marked ~**$${desk.totalUsd}** on Coston2 (FTSO). ${desk.recommended[0] ?? ""}`,
        env,
      });
      return {
        agentId: intent,
        text: narr.text,
        cards,
        model: narr.model,
        displayModel: narr.displayModel,
        paid: true,
        state: { intent, phase: "idle" },
      };
    }

    if (intent === "fassets" || intent === "yield" || intent === "xrpfi") {
      const desk = await readFassetsDesk(env);
      cards.push({
        type: "fassets_desk",
        title: intent === "yield" ? "Yield · FAssets + yield rails" : intent === "xrpfi" ? "XRPFi · FXRP rails" : "FAssets desk · Coston2",
        flarePrimitive: desk.flarePrimitive,
        honesty:
          intent === "yield"
            ? `${desk.honesty} Beacon does not invent APY. Yield rails below are on-chain status only.`
            : desk.honesty,
        managers: desk.managers.map((m) => ({
          symbol: m.symbol,
          status: m.status,
          lotSize: m.lotSizeUnderlying,
          agentCount: m.agentCount,
          fAsset: m.fAsset,
          mint: m.actions.mint,
          redeem: m.actions.redeem,
          bridge: m.actions.bridge,
          mintHandoffSummary: m.mintHandoff?.summary,
        })),
        unavailable: desk.documentedElsewhere.map((d) => ({ symbol: d.symbol, note: d.note })),
        xrpUsd: desk.xrpUsd,
        lotValueUsd: desk.lotValueUsd,
        docs: desk.docs,
      });

      if (intent === "yield") {
        const vaults = await readYieldVaultDesk({ wallet: opts.wallet, env });
        const vaultRows: Array<{
          id: string;
          vault: string;
          assetSymbol?: string;
          totalAssetsDisplay?: string;
          sharePriceDisplay?: string | null;
          userSharesDisplay?: string;
          explorer?: string;
          error?: string;
        }> = [];
        if ("error" in vaults.firelight) {
          vaultRows.push({ id: "firelight", vault: vaults.firelight.vault, error: vaults.firelight.error });
        } else {
          vaultRows.push({
            id: "firelight",
            vault: vaults.firelight.vault,
            assetSymbol: vaults.firelight.assetSymbol,
            totalAssetsDisplay: vaults.firelight.totalAssetsDisplay,
            sharePriceDisplay: vaults.firelight.sharePriceDisplay,
            userSharesDisplay: vaults.firelight.user?.sharesDisplay,
            explorer: vaults.firelight.explorer,
          });
        }
        if ("error" in vaults.upshift) {
          vaultRows.push({ id: "upshift", vault: vaults.upshift.vault, error: vaults.upshift.error });
        } else {
          vaultRows.push({
            id: "upshift",
            vault: vaults.upshift.vault,
            assetSymbol: vaults.upshift.assetSymbol,
            totalAssetsDisplay: undefined,
            sharePriceDisplay: null,
            userSharesDisplay: vaults.upshift.user?.lpBalanceDisplay,
            explorer: vaults.upshift.explorer,
          });
        }
        cards.push({
          type: "yield_vaults",
          title: "Yield rails · Coston2 (no APY invented)",
          flarePrimitive: vaults.flarePrimitive,
          honesty: vaults.honesty,
          network: vaults.network,
          chainId: vaults.chainId,
          vaults: vaultRows,
          docs: vaults.docs,
        });
      }

      if (intent === "xrpfi" || intent === "yield") {
        const pools = await discoverSparkDexPools(env);
        cards.push({
          type: "swap_pairs",
          title: "FXRP liquidity · SparkDEX Mainnet",
          network: pools.deployment.network === "flare" ? "Flare Mainnet" : "unavailable",
          chainId: pools.deployment.chainId || 14,
          pairs: pools.pairs.filter((p) => /fxrp|xrp/i.test(p.symbolA + p.symbolB)).map((p) => ({
            pairKey: p.pairKey,
            symbolA: p.symbolA,
            symbolB: p.symbolB,
            bestFee: p.bestFee,
            liquidity: p.liquidity,
          })),
          honesty: pools.deployment.honesty,
          flarePrimitive: "SparkDEX",
        });
        const br = await discoverFxrpOftRoutes(env);
        cards.push({
          type: "bridge_routes",
          title: "FXRP OFT · Coston2",
          source: "Flare Testnet Coston2",
          oftAdapter: COSTON2_FXRP_OFT_ADAPTER,
          routes: br.routes,
          routesSource: br.source,
          discoveredAt: br.discoveredAt,
          unavailable: [],
          docs: [{ label: "OFT peers", href: "https://dev.flare.network/fxrp/oft/fxrp-autoredeem#discovering-available-bridge-routes" }],
          honesty: br.source === "onchain"
            ? "LayerZero peers discovered on-chain. Destination fill only via LayerZero Scan / dest receipt."
            : "FALLBACK SNAPSHOT — not live peers. Re-sync before bridging.",
        });
      }
      const narr = await narrate({
        intent,
        userMessage: opts.message,
        situation:
          intent === "yield"
            ? `Yield: FAssets live=${desk.managers.map((m) => m.symbol).join(",")}. Yield rails on Coston2 (no APY). Mint=${desk.managers[0]?.actions.mint ?? "n/a"} (docs handoff).`
            : `FAssets managers live=${desk.managers.map((m) => m.symbol).join(",")}. Unavailable=${desk.documentedElsewhere.map((d) => d.symbol).join(",")}. Mint=docs_handoff (no fake button). Redeem=${desk.managers[0]?.actions.redeem ?? "n/a"}. XRP/USD=${desk.xrpUsd}. Lot USD=${desk.lotValueUsd}.`,
        fallback:
          intent === "yield"
            ? `Coston2 yield rails + FAssets status loaded. **No APY invented** — share balances and contract links only. Mint FXRP is a documented XRPL/Xaman handoff.`
            : `Coston2 FAssets: **${desk.managers.map((m) => m.symbol).join(", ") || "none"}** live. Mint = documented XRPL handoff (not an in-app mint button). Redeem lots can be prepared for wallet. FBTC/FDOGE not on this controller. XRP/USD ≈ $${desk.xrpUsd.toFixed(4)}.`,
        env,
      });
      return {
        agentId: intent,
        text: narr.text,
        cards,
        model: narr.model,
        displayModel: narr.displayModel,
        paid: true,
        state: { intent, phase: "idle" },
      };
    }

    if (intent === "intel" || intent === "risk") {
      const intel = await buildMarketIntelligence({
        wallet: opts.wallet,
        question: opts.message,
        env,
      });
      cards.push({
        type: "market_intel",
        title: intent === "risk" ? "Risk posture · FTSO" : "AI Market Intelligence",
        flarePrimitive: intel.flarePrimitive,
        honesty: intel.honesty,
        bias: intel.bias,
        probabilityRiskOn: intel.probabilityRiskOn,
        confidence: intel.confidence,
        risk: intel.risk,
        recommendedAction: intel.recommendedAction,
        rationale: intel.rationale,
        feeds: intel.feeds,
      });
      return {
        agentId: intent,
        text: intel.recommendedAction,
        cards,
        model: intel.model,
        displayModel: intel.displayModel,
        paid: true,
        state: { intent, phase: "idle" },
      };
    }

    if (intent === "liquidity") {
      const pools = await discoverSparkDexPools(env);
      cards.push({
        type: "swap_pairs",
        title: "SparkDEX liquidity discovery",
        network: pools.deployment.network === "flare" ? "Flare Mainnet" : "unavailable",
        chainId: pools.deployment.chainId || 14,
        pairs: pools.pairs.map((p) => ({
          pairKey: p.pairKey,
          symbolA: p.symbolA,
          symbolB: p.symbolB,
          bestFee: p.bestFee,
          liquidity: p.liquidity,
        })),
        honesty: pools.deployment.honesty,
        flarePrimitive: "SparkDEX",
      });
      const narr = await narrate({
        intent: "liquidity",
        userMessage: opts.message,
        situation: `Found ${pools.pools.length} liquid pools. ${pools.deployment.honesty}`,
        fallback: `Discovered **${pools.pairs.length}** liquid pair(s) on SparkDEX Mainnet. ${pools.deployment.honesty}`,
        env,
      });
      return {
        agentId: "liquidity",
        text: narr.text,
        cards,
        model: narr.model,
        displayModel: narr.displayModel,
        paid: true,
        state: { intent: "liquidity", phase: "idle" },
      };
    }

    if (intent === "crosschain") {
      // reuse bridge routes card path by falling through — set intent bridge-like
      const discovered = await discoverFxrpOftRoutes(env);
      cards.push({
        type: "bridge_routes",
        title: "Cross-chain · FXRP OFT",
        source: "Flare Testnet Coston2",
        oftAdapter: COSTON2_FXRP_OFT_ADAPTER,
        routes: discovered.routes,
        routesSource: discovered.source,
        discoveredAt: discovered.discoveredAt,
        unavailable: ["Non-peer chains", "Invented fees"],
        docs: [
          { label: "LayerZero Flare Testnet", href: "https://docs.layerzero.network/v2/deployments/chains/flare-testnet" },
          { label: "OFT peers", href: "https://dev.flare.network/fxrp/oft/fxrp-autoredeem#discovering-available-bridge-routes" },
        ],
        honesty:
          discovered.source === "onchain"
            ? "Only FXRP OFT adapter peers on Coston2. Say @bridge with destination + amount to quoteSend + prepare."
            : "FALLBACK SNAPSHOT — not live peers. Re-query when Coston2 RPC is healthy.",
      });
      const narr = await narrate({
        intent: "crosschain",
        userMessage: opts.message,
        situation: `Routes: ${discovered.routes.map((r) => r.chain).join(", ")}. Source=${discovered.source}.`,
        fallback: `Live FXRP OFT peers (${discovered.source}): ${discovered.routes.map((r) => `${r.chain}${r.live ? "" : " [snapshot]"}`).join(", ")}. Use **@bridge** to execute.`,
        env,
      });
      return {
        agentId: "crosschain",
        text: narr.text,
        cards,
        model: narr.model,
        displayModel: narr.displayModel,
        paid: true,
        state: { intent: "crosschain", phase: "idle" },
      };
    }
  }

  // --- Bridge: routes → quote (on-chain fee) → OFT send ---
  if (intent === "bridge") {
    const wallet = opts.wallet;
    const m = opts.message.toLowerCase();
    const discovered = await discoverFxrpOftRoutes(env);
    const oftRoutes = discovered.routes;
    const dest =
      /base\s*sepolia|base/.test(m) ? "Base Sepolia"
      : /sepolia/.test(m) ? "Sepolia"
      : /hyperliquid|hyperevm/.test(m) ? "Hyperliquid EVM Testnet"
      : /bsc|bnb/.test(m) ? "BSC Testnet"
      : state.bridgeTo;
    let amount = extractAmount(opts.message) ?? state.amountInUnits ?? null;
    const discoveryOnly = wantsBridgeDiscovery(opts.message) && !amount && !dest;
    const routeNames =
      oftRoutes.map((r) => r.chain).filter(Boolean).join(", ") || "live OFT peers";

    const pushBridgeRoutes = () => {
      cards.push({
        type: "bridge_routes",
        title: "FXRP OFT routes · Coston2",
        source: "Flare Testnet Coston2",
        oftAdapter: COSTON2_FXRP_OFT_ADAPTER,
        routes: oftRoutes,
        routesSource: discovered.source,
        discoveredAt: discovered.discoveredAt,
        unavailable: ["Arbitrary EVM chains without OFT peer", "Fake fee quotes without quoteSend"],
        docs: [
          { label: "OFT peers discovery", href: "https://dev.flare.network/fxrp/oft/fxrp-autoredeem#discovering-available-bridge-routes" },
          { label: "LayerZero · Flare Testnet", href: "https://docs.layerzero.network/v2/deployments/chains/flare-testnet" },
          { label: "FXRP automint + bridge", href: "https://dev.flare.network/fxrp/oft/fxrp-automint" },
        ],
        honesty:
          discovered.source === "onchain"
            ? "Peers discovered live via OFT Adapter peers() on Coston2. Beacon will not claim a bridge filled without dest receipt / LayerZero Scan. Fees require on-chain quoteSend."
            : "FALLBACK SNAPSHOT — peers(eid) unavailable. These are NOT live routes. Re-sync before bridging.",
      });
    };

    if (discoveryOnly) {
      pushBridgeRoutes();
      const narr = await narrate({
        intent: "bridge",
        userMessage: opts.message,
        situation: `User asked for OFT route discovery only. Peers: ${oftRoutes.map((r) => r.chain).join(", ")}.`,
        fallback: `Live FXRP OFT peers from Coston2: ${oftRoutes.map((r) => r.chain).join(", ")}. Say destination + amount to quote.`,
        env,
      });
      return {
        agentId: "bridge",
        text: narr.text,
        cards,
        model: narr.model,
        displayModel: narr.displayModel,
        paid: true,
        state: { intent: "bridge", phase: "clarify" },
      };
    }

    if (!wallet) {
      pushBridgeRoutes();
      cards.push({
        type: "insufficient",
        title: "Connect your wallet",
        summary: "Connect on Flare Coston2 so I can read your FXRP balance and prepare the OFT send to your address.",
        faucetHref: "https://faucet.flare.network/coston2",
      });
      const narr = await narrate({
        intent: "bridge",
        userMessage: opts.message,
        situation: "User wants to bridge FXRP but wallet is not connected. Ask them to connect on Coston2.",
        fallback: "Connect your wallet on Flare Coston2 and tell me the destination plus how much FXRP to bridge.",
        env,
      });
      return {
        agentId: "bridge",
        text: narr.text,
        cards,
        model: narr.model,
        displayModel: narr.displayModel,
        paid: true,
        state: { intent: "bridge", phase: "clarify" },
      };
    }

    const fxrp = await resolveFxrpAddress(env);
    const fxrpBal = await readErc20Balance(fxrp, wallet, env);

    if (amount === "all") {
      amount = fxrpBal.formatted;
    }

    if (dest && amount) {
      const route = resolveOftRouteByChain(dest, oftRoutes);
      if (!route || !route.live) {
        pushBridgeRoutes();
        const names = oftRoutes.filter((r) => r.live).map((r) => r.chain).join(", ") || oftRoutes.map((r) => r.chain).join(", ");
        const narr = await narrate({
          intent: "bridge",
          userMessage: opts.message,
          situation: `Destination ${dest} missing or not a live peer. Live peers: ${names}. source=${discovered.source}.`,
          fallback: !route
            ? `That destination is not a configured FXRP OFT peer. Pick one of: ${names}.`
            : `**${dest}** is only a fallback snapshot (not a live peers() route). Re-sync peers or pick: ${names}.`,
          env,
        });
        return {
          agentId: "bridge",
          text: narr.text,
          cards,
          model: narr.model,
          displayModel: narr.displayModel,
          paid: true,
          state: { intent: "bridge", phase: "clarify" },
        };
      }

      const confirmed =
        wantsConfirm(opts.message) &&
        (state.phase === "await_confirm" || state.phase === "ready_execute") &&
        Boolean(state.amountInUnits || amount);

      if (!confirmed) {
        // Prefer Beacon Agent OFT (executor FXRP + C2FLR) — no MetaMask
        const agentQ = await prepareBeaconAgentBridge(
          { amountFxrpUnits: amount, recipient: wallet, destination: dest },
          env,
        );
        if (agentQ.ok) {
          cards.push({
            type: "bridge_quote",
            title: agentQ.fromSafe
              ? "Bridge quote · Beacon Safe → Agent OFT"
              : "Bridge quote · Beacon Agent OFT",
            destination: dest,
            dstEid: route.eid,
            amountDisplay: amount,
            nativeFeeDisplay: agentQ.nativeFeeDisplay,
            wallet,
            fxrpBalance: agentQ.executorFxrpDisplay,
            network: "Flare Testnet Coston2",
            note: agentQ.fromSafe
              ? `Safe top-up ~${agentQ.safeSpendUsdt0} MockUSDT0→FXRP, then agent OFT. Fee ≈ ${agentQ.nativeFeeDisplay}. No MetaMask.`
              : `Agent executor OFT send. Fee ≈ ${agentQ.nativeFeeDisplay}. No MetaMask.`,
            mode: "beacon_agent",
            requiresMetaMask: false,
            fromSafe: agentQ.fromSafe,
            honesty: agentQ.honesty,
          });
          const narr = await narrate({
            intent: "bridge",
            userMessage: opts.message,
            situation: `Agent bridge quote ${amount} FXRP→${dest}. Fee ${agentQ.nativeFeeDisplay}. fromSafe=${agentQ.fromSafe}. No MetaMask. Ask confirm.`,
            fallback: agentQ.fromSafe
              ? `Ready: **Beacon Safe** funds FXRP, then agent bridges **${amount} FXRP → ${dest}** (fee ≈ ${agentQ.nativeFeeDisplay}). Reply **confirm** — no MetaMask.`
              : `Ready: **Beacon Agent** bridges **${amount} FXRP → ${dest}** (fee ≈ ${agentQ.nativeFeeDisplay}). Reply **confirm** — no MetaMask.`,
            env,
          });
          return {
            agentId: "bridge",
            text: narr.text,
            cards,
            model: narr.model,
            displayModel: narr.displayModel,
            paid: true,
            state: { intent: "bridge", phase: "await_confirm", bridgeTo: dest, amountInUnits: amount },
          };
        }

        // Fallback: EOA MetaMask path
        let quotePreview;
        try {
          quotePreview = await prepareFxrpOftBridge(
            { amountFxrpUnits: amount, recipient: wallet, dstEid: route.eid },
            env,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          cards.push({
            type: "insufficient",
            title: "Could not quote bridge",
            summary: `${agentQ.error} · EOA quote: ${msg}`,
            faucetHref: "https://faucet.flare.network/coston2",
          });
          return {
            agentId: "bridge",
            text: `Agent bridge unavailable (${agentQ.error}). EOA quote also failed: ${msg}`,
            cards,
            model: "beacon-local",
            displayModel: displayModelName("beacon-local", { fallback: true }),
            paid: true,
            state: { intent: "bridge", phase: "clarify", bridgeTo: dest, amountInUnits: amount },
          };
        }

        cards.push({
          type: "bridge_quote",
          title: "Bridge quote · MetaMask EOA",
          destination: dest,
          dstEid: route.eid,
          amountDisplay: amount,
          nativeFeeDisplay: quotePreview.nativeFeeDisplay,
          wallet,
          fxrpBalance: fxrpBal.formatted,
          network: "Flare Testnet Coston2",
          note: `Agent OFT unavailable (${agentQ.error}). Fallback: your wallet FXRP + C2FLR fee via MetaMask.`,
          mode: "eoa_metamask",
          requiresMetaMask: true,
          honesty: agentQ.honesty,
        });
        const narr = await narrate({
          intent: "bridge",
          userMessage: opts.message,
          situation: `EOA fallback bridge quote ${amount} FXRP to ${dest}. Fee ${quotePreview.nativeFeeDisplay}. MetaMask required.`,
          fallback: `Agent inventory short — bridge **${amount} FXRP → ${dest}** from your wallet (fee ≈ ${quotePreview.nativeFeeDisplay}). Confirm for MetaMask Approve + Send.`,
          env,
        });
        return {
          agentId: "bridge",
          text: narr.text,
          cards,
          model: narr.model,
          displayModel: narr.displayModel,
          paid: true,
          state: { intent: "bridge", phase: "await_confirm", bridgeTo: dest, amountInUnits: amount },
        };
      }

      // Prepare phase
      const finalAmount = amount || state.amountInUnits || "1";
      const agentPrep = await prepareBeaconAgentBridge(
        { amountFxrpUnits: finalAmount, recipient: wallet, destination: dest },
        env,
      );
      if (agentPrep.ok) {
        cards.push({
          type: "bridge_prepare",
          title: agentPrep.fromSafe
            ? "Spend Safe + Agent OFT · Coston2"
            : "Execute with Beacon Agent · Coston2",
          destination: dest,
          dstEid: route.eid,
          peer: route.peer,
          amountLD: "0",
          amountDisplay: finalAmount,
          minAmountLD: "0",
          nativeFee: agentPrep.nativeFee,
          nativeFeeDisplay: agentPrep.nativeFeeDisplay,
          approveTo: agentPrep.approveTo,
          sendTo: agentPrep.sendTo,
          approveData: agentPrep.approveData,
          sendData: agentPrep.sendData,
          docs: agentPrep.docs,
          warning: agentPrep.fromSafe
            ? `Safe ~${agentPrep.safeSpendUsdt0} MockUSDT0→FXRP, then agent OFT ${finalAmount} FXRP→${dest}. Fee ≈ ${agentPrep.nativeFeeDisplay}. No MetaMask.`
            : `Agent OFT ${finalAmount} FXRP→${dest}. Fee ≈ ${agentPrep.nativeFeeDisplay}. No MetaMask.`,
          layerZeroScanBase: agentPrep.layerZeroScanBase,
          deliveryHint: agentPrep.deliveryHint,
          mode: "beacon_agent",
          requiresMetaMask: false,
          fromSafe: agentPrep.fromSafe,
          safeSpendUsdt0: agentPrep.safeSpendUsdt0,
          honesty: agentPrep.honesty,
          executor: agentPrep.executor,
        });
        const narr = await narrate({
          intent: "bridge",
          userMessage: opts.message,
          situation: `Prepared agent bridge ${finalAmount} FXRP→${dest}. No MetaMask.`,
          fallback: `Prepared. Tap **Execute with Beacon Agent** — OFT on **Coston2**, fee ≈ ${agentPrep.nativeFeeDisplay} (no MetaMask).`,
          env,
        });
        return {
          agentId: "bridge",
          text: narr.text,
          cards,
          model: narr.model,
          displayModel: narr.displayModel,
          paid: true,
          state: { intent: "bridge", phase: "ready_execute", bridgeTo: dest, amountInUnits: finalAmount },
        };
      }

      if (parseFloat(fxrpBal.formatted) + 1e-9 < parseFloat(finalAmount)) {
        cards.push({
          type: "insufficient",
          title: "Not enough FXRP",
          summary: `Agent: ${agentPrep.error}. Wallet has ${fxrpBal.formatted} FXRP; need ${finalAmount}.`,
          faucetHref: "https://faucet.flare.network/coston2",
        });
        return {
          agentId: "bridge",
          text: `Agent bridge blocked (${agentPrep.error}). Wallet FXRP **${fxrpBal.formatted}** — fund agent/Safe or your wallet.`,
          cards,
          model: "beacon-local",
          displayModel: displayModelName("beacon-local", { fallback: true }),
          paid: true,
          state: { intent: "bridge", phase: "clarify", bridgeTo: dest },
        };
      }

      const prep = await prepareFxrpOftBridge(
        { amountFxrpUnits: finalAmount, recipient: wallet, dstEid: route.eid },
        env,
      );
      cards.push({
        type: "bridge_prepare",
        title: "Confirm in wallet",
        destination: dest,
        dstEid: route.eid,
        peer: route.peer,
        amountLD: prep.amountLD,
        amountDisplay: finalAmount,
        minAmountLD: prep.minAmountLD,
        nativeFee: prep.nativeFee,
        nativeFeeDisplay: prep.nativeFeeDisplay,
        approveTo: prep.approveTo,
        sendTo: prep.sendTo,
        approveData: prep.approveData,
        sendData: prep.sendData,
        docs: prep.docs,
        warning: `EOA fallback: Approve FXRP then OFT send. Fee ≈ ${prep.nativeFeeDisplay}. (${agentPrep.error})`,
        layerZeroScanBase: prep.layerZeroScanBase,
        deliveryHint: prep.deliveryHint,
        mode: "eoa_metamask",
        requiresMetaMask: true,
        honesty: agentPrep.honesty,
      });
      const narr = await narrate({
        intent: "bridge",
        userMessage: opts.message,
        situation: `EOA MetaMask bridge prepare ${finalAmount} FXRP→${dest}.`,
        fallback: `Confirmed. Use **Approve + Send** in MetaMask, fee ≈ ${prep.nativeFeeDisplay}.`,
        env,
      });
      return {
        agentId: "bridge",
        text: narr.text,
        cards,
        model: narr.model,
        displayModel: narr.displayModel,
        paid: true,
        state: { intent: "bridge", phase: "ready_execute", bridgeTo: dest, amountInUnits: finalAmount },
      };
    }

    if (dest && !amount) {
      pushBridgeRoutes();
      const narr = await narrate({
        intent: "bridge",
        userMessage: opts.message,
        situation: `User picked ${dest}. Ask only how much FXRP to bridge. FXRP balance ${fxrpBal.formatted}. Do not re-list all clarifying questions.`,
        fallback: `Got it, destination **${dest}**. How much **FXRP** should we bridge from Coston2? You have **${fxrpBal.formatted} FXRP**.`,
        env,
      });
      return {
        agentId: "bridge",
        text: narr.text,
        cards,
        model: narr.model,
        displayModel: narr.displayModel,
        paid: true,
        state: { intent: "bridge", phase: "clarify", bridgeTo: dest },
      };
    }

    // Discovery / open clarify: routes card only
    pushBridgeRoutes();
    const narr = await narrate({
      intent: "bridge",
      userMessage: opts.message,
      situation: `Present live FXRP OFT destinations from Coston2: ${routeNames}. Ask which destination and FXRP amount. Do not invent fees.`,
      fallback: `Here are the **live FXRP OFT routes from Coston2**: ${routeNames}. Which destination and how much FXRP?`,
      env,
    });
    return {
      agentId: "bridge",
      text: narr.text,
      cards,
      model: narr.model,
      displayModel: narr.displayModel,
      paid: true,
      state: { intent: "bridge", phase: "clarify" },
    };
  }

  // --- Media: small → x402 quote; large → Bound Work ---
  if (intent === "image" || intent === "research") {
    const m = opts.message.toLowerCase();
    const isSmallImage =
      intent === "image" &&
      (/logo|icon|thumbnail|avatar|mark|badge|sticker/.test(m) || m.length < 80);
    const isLargeCreative =
      intent === "image" && /pack|campaign|brand kit|series|deck|multiple/.test(m);

    if (isSmallImage && !isLargeCreative) {
      const briefReady =
        state.phase === "await_confirm" ||
        state.phase === "quote" ||
        /color|style|transparent|serif|sans|minimal|bold|reference|company|brand|name is/i.test(m);

      if (!briefReady && state.phase !== "await_confirm") {
        cards.push({
          type: "media_clarify",
          title: "Logo brief",
          kind: "image",
          prompts: [
            "Company / product name?",
            "Colors / palette?",
            "Style (minimal, bold, geometric…)?",
            "Transparent background?",
            "Any reference?",
          ],
          deskHref: "/flow/desk",
        });
        const narr = await narrate({
          intent: "image",
          userMessage: opts.message,
          situation:
            "Small logo job. Clarify name, colors, style, transparency, reference BEFORE quoting price. Do not show payment yet.",
          fallback:
            "Happy to make that logo.\n\nQuick brief: **name**, **colors**, **style**, **transparent?**, then I’ll quote provider, price, and ETA before x402.",
          env,
        });
        return {
          agentId: "image",
          text: narr.text,
          cards,
          model: narr.model,
          displayModel: narr.displayModel,
          paid: false,
          state: { intent: "image", phase: "clarify", imageStyle: m.slice(0, 80) },
        };
      }

      const res = PAID_RESOURCES.find((r) => r.id === "image-logo")!;
      cards.push({
        type: "x402_quote",
        title: res.title,
        priceUsdt0: res.priceUsdt0,
        resource: res.resource,
        payTo: env.X402_PAYEE_ADDRESS || "",
        token: env.X402_TOKEN_ADDRESS || "",
        facilitator: env.X402_FACILITATOR_ADDRESS || "",
        chainId: 114,
        provider: res.provider,
        reason: res.reason,
        etaSeconds: res.etaSeconds,
        flarePrimitive: res.flarePrimitive,
        serviceId: res.id,
        agentId: res.agentId,
        brief: opts.message,
      });
      const narr = await narrate({
        intent: "image",
        userMessage: opts.message,
        situation: `Brief ready. Quote ${res.priceUsdt0} USDT0 via x402. Provider ${res.provider}. ETA ~${res.etaSeconds}s. After payment, generate immediately.`,
        fallback: `Creative brief locked.\n\n**Provider:** ${res.provider}\n**Price:** $${res.priceUsdt0} MockUSDT0 (x402)\n**Why:** ${res.reason}\n**ETA:** ~${res.etaSeconds}s\n\nPay & run to generate, or Bound Work for a larger escrowed pack.`,
        env,
      });
      return {
        agentId: "image",
        text: narr.text,
        cards,
        model: narr.model,
        displayModel: narr.displayModel,
        paid: false,
        state: {
          intent: "image",
          phase: "await_confirm",
          serviceId: res.id,
          creativeBrief: opts.message,
          quotePrice: res.priceUsdt0,
        },
      };
    }

    // Research: clarify → x402 brief (not Bound Work by default)
    if (intent === "research") {
      const scoped =
        state.phase === "await_confirm" ||
        /depth|source|pdf|slide|competitor|topic|outline|brief/i.test(m) ||
        m.length > 40;
      if (!scoped) {
        cards.push({
          type: "media_clarify",
          title: "Research scope",
          kind: "research",
          prompts: [
            "Topic?",
            "Depth (scan / deep)?",
            "Sources preference?",
            "PDF or slides?",
            "Competitor focus?",
          ],
          deskHref: "/flow/desk",
        });
        const narr = await narrate({
          intent: "research",
          userMessage: opts.message,
          situation: "Clarify research scope before quoting. Do not charge yet.",
          fallback:
            "Let’s scope it first: **topic**, **depth**, **sources**, **PDF/slides?**, **competitors?**, then I’ll quote the research brief.",
          env,
        });
        return {
          agentId: "research",
          text: narr.text,
          cards,
          model: narr.model,
          displayModel: narr.displayModel,
          paid: false,
          state: { intent: "research", phase: "clarify" },
        };
      }
      const res = PAID_RESOURCES.find((r) => r.id === "research-brief")!;
      cards.push({
        type: "x402_quote",
        title: res.title,
        priceUsdt0: res.priceUsdt0,
        resource: res.resource,
        payTo: env.X402_PAYEE_ADDRESS || "",
        token: env.X402_TOKEN_ADDRESS || "",
        facilitator: env.X402_FACILITATOR_ADDRESS || "",
        chainId: 114,
        provider: res.provider,
        reason: res.reason,
        etaSeconds: res.etaSeconds,
        flarePrimitive: res.flarePrimitive,
        serviceId: res.id,
        agentId: res.agentId,
        brief: opts.message,
      });
      const narr = await narrate({
        intent: "research",
        userMessage: opts.message,
        situation: `Scope ready. Quote $${res.priceUsdt0} research brief via x402. Deliver after payment.`,
        fallback: `Scope locked.\n\n**Provider:** ${res.provider}\n**Price:** $${res.priceUsdt0} MockUSDT0 (x402)\n**Why:** ${res.reason}\n**ETA:** ~${res.etaSeconds}s\n\nPay & run for the brief, larger packs use Bound Work escrow.`,
        env,
      });
      return {
        agentId: "research",
        text: narr.text,
        cards,
        model: narr.model,
        displayModel: narr.displayModel,
        paid: false,
        state: {
          intent: "research",
          phase: "await_confirm",
          serviceId: res.id,
          creativeBrief: opts.message,
          quotePrice: res.priceUsdt0,
        },
      };
    }

    const prompts =
      intent === "image"
        ? ["Style / mood?", "Aspect ratio (1:1, 9:16, 16:9)?", "Any reference?", "Quality bar?"]
        : ["Scope?", "Sources?", "Depth?", "Output format?"];
    cards.push({
      type: "media_clarify",
      title: intent === "image" ? "Creative pack → Bound Work" : "Research → Bound Work",
      kind: intent,
      prompts,
      deskHref: "/flow/desk",
    });
    const narr = await narrate({
      intent,
      userMessage: opts.message,
      situation: "Larger creative/research job. Invite Bound Work for Bound Offer + escrow acceptance. Video/voice Flow stubs were removed.",
      fallback:
        "This looks like a larger job. Open **Bound Work** for a sealed Bound Offer (price + acceptance) on Coston2. Flow video/voice placeholders were removed — use Bound Work Video if you need motion.",
      env,
    });
    return {
      agentId: intent,
      text: narr.text,
      cards,
      model: narr.model,
      displayModel: narr.displayModel,
      paid: true,
      state: { intent, phase: "clarify" },
    };
  }

  if (intent === "pay") {
    if (opts.paidResource) {
      const narr = await narrate({
        intent: "pay",
        userMessage: opts.message,
        situation:
          "Payment settled but no service was selected. Ask which resource: FTSO deep pack, logo still, or research brief. Do NOT re-list the full catalog.",
        fallback:
          "Payment settled, which resource did you mean?\n• **FTSO deep pack** ($0.25)\n• **Logo still** ($0.50)\n• **Research brief** ($0.75)\n\nReply with the one you want and I’ll deliver it.",
        env,
      });
      return {
        agentId: "pay",
        text: narr.text,
        cards: [],
        model: narr.model,
        displayModel: narr.displayModel,
        paid: true,
        state: { intent: "pay", phase: "idle" },
      };
    }

    if (shouldEmitPayCatalog(opts.paidResource)) {
      for (const res of PAID_RESOURCES) {
        cards.push({
          type: "x402_quote",
          title: res.title,
          priceUsdt0: res.priceUsdt0,
          resource: res.resource,
          payTo: env.X402_PAYEE_ADDRESS || "",
          token: env.X402_TOKEN_ADDRESS || "",
          facilitator: env.X402_FACILITATOR_ADDRESS || "",
          chainId: 114,
          provider: res.provider,
          reason: res.reason,
          etaSeconds: res.etaSeconds,
          flarePrimitive: res.flarePrimitive,
          serviceId: res.id,
          agentId: res.agentId,
        });
      }
    }
    const narr = await narrate({
      intent: "pay",
      userMessage: opts.message,
      situation:
        "Present the payable Beacon resources with provider, price, reason, ETA. No orphan $0.10 buttons. MockUSDT0 for x402.",
      fallback:
        "Every payment buys a real resource:\n• FTSO deep pack · $0.25\n• Logo still · $0.50\n• Research brief · $0.75\n\nPick one, EIP-3009 x402 on Coston2 (MockUSDT0).",
      env,
    });
    return {
      agentId: "pay",
      text: narr.text,
      cards,
      model: narr.model,
      displayModel: narr.displayModel,
      paid: true,
      state: { intent: "pay", phase: "quote" },
    };
  }

  if (intent === "desk") {
    cards.push({
      type: "desk_link",
      title: "Bound Work desk",
      href: "/flow/desk",
      summary: "Creative jobs with BeaconEscrow, pay only when quality passes.",
    });
    const narr = await narrate({
      intent: "desk",
      userMessage: opts.message,
      situation: "Invite them to the Bound Work desk for escrowed image/video/docs jobs.",
      fallback: "Bound Work is ready, open the desk to create a job, get a Bound Offer, and lock funds in escrow until quality passes.",
      env,
    });
    return {
      agentId: "desk",
      text: narr.text,
      cards,
      model: narr.model,
      displayModel: narr.displayModel,
      paid: true,
      state: { intent: "desk", phase: "idle" },
    };
  }

  // General chat
  const narr = await narrate({
    intent: "general",
    userMessage: opts.message,
    situation:
      "Be a helpful Flare co-pilot. You can help with FTSO signals, USDT0→FXRP swaps, bridges, x402 pay, or Bound Work creative jobs. Ask what they want to do.",
    fallback:
      "I'm Beacon on Flare. I can pull FTSO signals, quote USDT0→FXRP swaps, plan bridges, fund Beacon Safe, take x402 micropays, or start Bound Work. What should we do?",
    env,
  });
  return {
    agentId: "general",
    text: narr.text,
    cards: [],
    model: narr.model,
    displayModel: narr.displayModel,
    paid: true,
    state: { intent: "general", phase: "idle" },
  };
}
