import { chatCompletion, isAiConfigured } from "./ai.js";
import { loadEnv, type BeaconEnv } from "./env.js";
import {
  buildTradeSignal,
  prepareUsdt0ToFxrpSwap,
  readErc20Balance,
  readFtsoFeeds,
  resolveFxrpAddress,
  COSTON2_USDT0,
} from "./ftso.js";

export type BeaconAgentId =
  | "general"
  | "signals"
  | "swap"
  | "bridge"
  | "pay"
  | "trade"
  | "desk"
  | "image"
  | "video"
  | "research";

export interface AgentDef {
  id: BeaconAgentId;
  name: string;
  blurb: string;
  builtIn: boolean;
  x402PriceUsdt0: number;
  mention: string;
}

export const BEACON_AGENTS: AgentDef[] = [
  { id: "general", name: "General chat", blurb: "Flare-native co-pilot.", builtIn: true, x402PriceUsdt0: 0, mention: "@general" },
  { id: "signals", name: "FTSO Signals", blurb: "Live oracle feeds + bias.", builtIn: true, x402PriceUsdt0: 0, mention: "@signals" },
  { id: "swap", name: "Swap USDT0→FXRP", blurb: "SparkDEX on Coston2.", builtIn: true, x402PriceUsdt0: 0, mention: "@swap" },
  { id: "bridge", name: "Bridge planner", blurb: "LayerZero / FXRP OFT.", builtIn: true, x402PriceUsdt0: 0, mention: "@bridge" },
  { id: "pay", name: "Pay x402", blurb: "EIP-3009 micropay.", builtIn: true, x402PriceUsdt0: 0, mention: "@pay" },
  { id: "trade", name: "Trade desk", blurb: "Signals + swap.", builtIn: true, x402PriceUsdt0: 0, mention: "@trade" },
  { id: "desk", name: "Bound Work desk", blurb: "Escrow creative jobs.", builtIn: true, x402PriceUsdt0: 0, mention: "@desk" },
  { id: "image", name: "Image", blurb: "Creative generation.", builtIn: true, x402PriceUsdt0: 0, mention: "@image" },
  { id: "video", name: "Video", blurb: "Motion packs.", builtIn: true, x402PriceUsdt0: 0, mention: "@video" },
  { id: "research", name: "Research", blurb: "Scoped research packs.", builtIn: true, x402PriceUsdt0: 0, mention: "@research" },
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
  videoDuration?: string;
  researchScope?: string;
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
      xrpUsd: number;
      wallet: string;
      usdt0Balance: string;
      network: string;
      note: string;
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
      approveTo: string;
      swapTo: string;
      approveData: string;
      swapData: string;
      docs: string[];
      warning: string;
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
      kind: "image" | "video" | "research";
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
    }
  | {
      type: "media_result";
      title: string;
      kind: "image" | "research";
      summary: string;
      content?: string;
      mimeType?: string;
      paymentTxHint?: string;
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

/** Human-facing model label — never expose provider brand; never invent GPT-3.5/4.0. */
export function displayModelName(model: string): string {
  const m = (model || "").toLowerCase();
  if (m.includes("claude-opus-5") || m.includes("opus-5")) return "Claude Opus 5";
  if (m.includes("claude-opus-4") || m.includes("opus-4") || m.includes("claude")) return "Claude Opus 5";
  if (m.includes("gpt-5.6") || m.includes("gpt-5") || m.includes("gpt")) return "GPT-5.6";
  if (m.includes("beacon") || m.includes("local") || m.includes("heuristic") || m.includes("x402")) return "Beacon";
  return "Beacon";
}

const AGENT_SYSTEM: Record<BeaconAgentId, string> = {
  general: "You are Beacon general co-pilot on Flare. Route users to FTSO, swap, bridge, x402, or Bound Work.",
  signals: "You are Beacon Signals. Explain live FTSO feeds and bias. Never invent prices.",
  swap: "You are Beacon Swap. Conversational USDT0→FXRP on SparkDEX. Quote before execute. Never dump calldata.",
  bridge: "You are Beacon Bridge. Lead with documented LayerZero FXRP OFT peers. Never invent fills or fees.",
  pay: "You are Beacon Payment. Every charge must name provider, price, reason, and ETA. No orphan micropays.",
  trade: "You are Beacon Trade. Use FTSO first; only suggest swap when bias supports it.",
  desk: "You are Bound Work. Escrow creative jobs with acceptance.",
  image: "You are Beacon Image. Small logos → instant x402. Large packs → Bound Offer escrow.",
  video: "You are Beacon Video. Prefer Bound Offer for motion packs; clarify duration first.",
  research: "You are Beacon Research. Scope then quote; small briefs can be x402.",
};

/** Official Coston2 FXRP OFT peers from Flare DevHub getOftPeers. */
export const COSTON2_FXRP_OFT_ROUTES = [
  {
    chain: "BSC Testnet",
    eid: 40102,
    peer: "0xac7c4a07670589cf83b134a843bfe86c45a4bf4e",
    asset: "FXRP",
    status: "supported" as const,
    eta: "minutes (LayerZero)",
    fees: "LayerZero messaging fee in native gas — quote on send",
  },
  {
    chain: "Sepolia",
    eid: 40161,
    peer: "0x81672c5d42f3573ad95a0bdfbe824faac547d4e6",
    asset: "FXRP",
    status: "supported" as const,
    eta: "minutes (LayerZero)",
    fees: "LayerZero messaging fee in native gas — quote on send",
  },
  {
    chain: "Hyperliquid EVM Testnet",
    eid: 40362,
    peer: "0x14bfb521e318fc3d5e92a8462c65079bc7d4284c",
    asset: "FXRP",
    status: "supported" as const,
    eta: "minutes (LayerZero)",
    fees: "HYPE gas + LZ fee — quote on send",
  },
];

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
    provider: "Beacon · GPT-5.6",
    priceUsdt0: "0.75",
    reason: "Scoped written brief with sources checklist",
    etaSeconds: 40,
    resource: "/v1/agents/resources/research-brief",
    flarePrimitive: "x402",
    agentId: "research",
  },
];

function pickModel(intent: BeaconAgentId, env: BeaconEnv): string {
  if (intent === "swap" || intent === "trade" || intent === "bridge" || intent === "pay" || intent === "signals") {
    return env.AI_MODEL_QUOTE || "gpt-5.6-sol";
  }
  return env.AI_MODEL_GENERATOR || "claude-opus-5";
}

function detectIntent(message: string, fallback: BeaconAgentId, state?: ConversationState): BeaconAgentId {
  const m = message.toLowerCase();
  // Strong keyword intents always win (auto-route from General)
  if (/@signals|ftso|price feed|oracle|\bsignals?\b/.test(m)) return "signals";
  if (/@swap|\bswap\b|usdt0.*fxrp/.test(m) && /swap|usdt|fxrp|@swap/.test(m)) return "swap";
  if (/@bridge|\bbridge\b|layerzero|oft|stargate/.test(m)) return "bridge";
  if (/@pay|x402|micropay/.test(m)) return "pay";
  if (/@trade|trade signal|\blong\b|\bshort\b/.test(m)) return "trade";
  if (/@desk|bound work/.test(m)) return "desk";
  if (/@image|create image|generate image|\blogo\b|icon for|thumbnail/.test(m)) return "image";
  if (/@video|create video|generate video|storyboard/.test(m)) return "video";
  if (/@research|research |competitors|market pack/.test(m)) return "research";
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
  return /\b(confirm|yes|proceed|do it|execute|go ahead|approve)\b/i.test(message);
}

function sanitizeAssistantText(text: string): string {
  if (!text) return "Something went wrong on my side. Please try again.";
  if (/<!doctype|<html|<meta |AI provider|stack|ECONNREFUSED/i.test(text)) {
    return "I hit a temporary issue talking to the model. Your Flare tools are fine — please send that again.";
  }
  // Strip accidental hex dumps longer than a short address mention
  return text.replace(/0x[a-fA-F0-9]{64,}/g, "[tx]").trim();
}

async function narrate(opts: {
  intent: BeaconAgentId;
  userMessage: string;
  situation: string;
  /** Shown if the model is unavailable — never dump internal situation. */
  fallback?: string;
  env: BeaconEnv;
}): Promise<{ text: string; model: string; displayModel: string }> {
  const model = pickModel(opts.intent, opts.env);
  const displayModel = displayModelName(model);
  const safeFallback =
    opts.fallback ??
    "Sure — I'm with you. Tell me the next detail you want, and I'll keep this conversational.";
  if (!isAiConfigured(opts.env)) {
    return { text: safeFallback, model: "beacon-local", displayModel: "Beacon" };
  }
  try {
    const result = await chatCompletion(
      {
        model,
        temperature: 0.4,
        maxTokens: 500,
        messages: [
          {
            role: "system",
            content: `${AGENT_SYSTEM[opts.intent]}
Speak like Claude/ChatGPT: warm, clear, concise. Never invent transaction hashes.
Never mention AgentRouter, providers keys, APIs, calldata, HTML, or internal errors.
Never dump addresses unless the user asks. Prefer natural language.
MockUSDT0 is for Beacon pay/escrow only. SparkDEX swaps use Coston2 USDT0.
Pipeline: Intent → Quote → Payment (if needed) → Execution → Receipt.
Situation for this turn:\n${opts.situation}`,
          },
          { role: "user", content: opts.userMessage },
        ],
      },
      opts.env,
    );
    return {
      text: sanitizeAssistantText(result.content),
      model: result.model ?? model,
      displayModel,
    };
  } catch {
    return { text: sanitizeAssistantText(safeFallback), model, displayModel };
  }
}

export async function runBeaconAgentChat(opts: {
  agentId?: BeaconAgentId;
  message: string;
  wallet?: string;
  paidResource?: boolean;
  state?: ConversationState | null;
  env?: BeaconEnv;
}): Promise<AgentChatResult> {
  const env = opts.env ?? loadEnv();
  const prev = opts.state ?? null;
  const intent = detectIntent(opts.message, opts.agentId ?? prev?.intent ?? "general", prev ?? undefined);
  const cards: AgentCard[] = [];
  let state: ConversationState = prev && prev.intent === intent
    ? { ...prev, intent }
    : { intent, phase: "idle" };

  // ——— Signals ———
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
            ? "FTSO bias leans constructive — I can prepare a USDT0 → FXRP swap if you want exposure. How much?"
            : "FTSO bias does not scream urgency — holding cash (USDT0) may be fine. Say if you still want a swap quote."
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

  // ——— Swap multi-turn ———
  if (intent === "swap" || (intent === "trade" && (/swap|fxrp|usdt/i.test(opts.message) || state.phase !== "idle"))) {
    const wallet = opts.wallet;
    if (!wallet) {
      cards.push({
        type: "insufficient",
        title: "Connect your wallet",
        summary: "Connect on Flare Coston2 so I can read your USDT0 balance and send FXRP to you.",
        faucetHref: "https://faucet.flare.network/coston2",
      });
      const narr = await narrate({
        intent: "swap",
        userMessage: opts.message,
        situation: "User wants to swap but wallet is not connected. Ask them to connect.",
        fallback: "Sure — connect your wallet on Flare Coston2 and I’ll read your USDT0 balance before we swap.",
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

    const fxrp = await resolveFxrpAddress(env);
    const [usdtBal, fxrpBal] = await Promise.all([
      readErc20Balance(COSTON2_USDT0, wallet, env),
      readErc20Balance(fxrp, wallet, env),
    ]);

    let amount = extractAmount(opts.message) ?? state.amountInUnits ?? null;
    if (amount === "all") {
      amount = usdtBal.formatted;
    }

    // Clarify amount — never prepare calldata yet
    if (!amount) {
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
        situation: `Ask how much USDT0 to swap to FXRP. Wallet ${wallet.slice(0, 6)}… has ${usdtBal.formatted} USDT0 and ${fxrpBal.formatted} FXRP on Coston2. Suggest they can say a number or "swap all". Do not prepare a transaction yet.`,
        fallback: `Sure.\n\nHow much USDT0 would you like to swap to FXRP?\nYou currently have **${usdtBal.formatted} USDT0** and **${fxrpBal.formatted} FXRP**. You can say a number or “swap all”.`,
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

    // Quote until user explicitly confirms while we already hold an amount in await_confirm
    const confirmed =
      wantsConfirm(opts.message) &&
      (state.phase === "await_confirm" || state.phase === "ready_execute") &&
      Boolean(state.amountInUnits || amount);

    if (!confirmed) {
      const prepPreview = await prepareUsdt0ToFxrpSwap({ amountInUnits: amount, recipient: wallet }, env);
      cards.push({
        type: "swap_quote",
        title: "Swap quote",
        amountInDisplay: amount,
        estimatedFxrp: prepPreview.estimatedFxrp,
        xrpUsd: prepPreview.xrpUsd,
        wallet,
        usdt0Balance: usdtBal.formatted,
        network: "Flare Testnet Coston2",
        note: "Estimate uses FTSO XRP/USD (FXRP ≈ XRP). Final fill depends on SparkDEX pool.",
      });
      const narr = await narrate({
        intent: "swap",
        userMessage: opts.message,
        situation: `Present a clear quote: swap ${amount} USDT0 ≈ ${prepPreview.estimatedFxrp} FXRP at ~$${prepPreview.xrpUsd.toFixed(4)}/XRP. Wallet balance ${usdtBal.formatted} USDT0. Ask them to reply "confirm" to open the wallet for approve + swap. No raw addresses.`,
        fallback: `Here’s the quote: **${amount} USDT0 ≈ ${prepPreview.estimatedFxrp} FXRP** (FTSO XRP/USD ~$${prepPreview.xrpUsd.toFixed(4)}).\n\nReply **confirm** when you want me to open approve + swap in your wallet.`,
        env,
      });
      return {
        agentId: "swap",
        text: narr.text,
        cards,
        model: narr.model,
        displayModel: narr.displayModel,
        paid: true,
        state: { intent: "swap", phase: "await_confirm", amountInUnits: amount },
      };
    }

    // Confirmed → prepare executable card
    const finalAmount = amount || state.amountInUnits || "1";
    if (parseFloat(usdtBal.formatted) + 1e-9 < parseFloat(finalAmount)) {
      cards.push({
        type: "insufficient",
        title: "Not enough USDT0",
        summary: `You have ${usdtBal.formatted} USDT0 on Coston2 but need ${finalAmount}. Use the faucet for test USDT0 (not Beacon MockUSDT0).`,
        faucetHref: "https://faucet.flare.network/coston2",
      });
      return {
        agentId: "swap",
        text: `You only have **${usdtBal.formatted} USDT0** on Coston2. Grab test USDT0 from the faucet, then tell me the amount again.`,
        cards,
        model: "beacon-local",
        displayModel: "Beacon",
        paid: true,
        state: { intent: "swap", phase: "clarify" },
      };
    }

    const prep = await prepareUsdt0ToFxrpSwap({ amountInUnits: finalAmount, recipient: wallet }, env);
    cards.push({
      type: "swap_prepare",
      title: "Confirm in wallet",
      tokenIn: prep.tokenIn,
      tokenOut: prep.tokenOut,
      router: prep.router,
      amountIn: prep.amountIn,
      amountInDisplay: prep.amountInDisplay,
      amountOutMinimum: prep.amountOutMinimum,
      estimatedFxrp: prep.estimatedFxrp,
      approveTo: prep.approveTo,
      swapTo: prep.swapTo,
      approveData: prep.approveData,
      swapData: prep.swapData,
      docs: prep.docs,
      warning:
        "Coston2 USDT0 → FXRP on SparkDEX. You will approve (if needed) then swap. I’ll show explorer links when both confirm.",
    });
    const narr = await narrate({
      intent: "swap",
      userMessage: opts.message,
      situation: `User confirmed swap of ${finalAmount} USDT0 (~${prep.estimatedFxrp} FXRP). Tell them to tap Confirm in wallet, then wait for Pending → Confirmed. Do not invent a hash.`,
      fallback: `Confirmed. Tap **Approve + Swap** — I’ll wait for the on-chain receipt and show the explorer link when it confirms.`,
      env,
    });
    return {
      agentId: "swap",
      text: narr.text,
      cards,
      model: narr.model,
      displayModel: narr.displayModel,
      paid: true,
      state: { intent: "swap", phase: "ready_execute", amountInUnits: finalAmount },
    };
  }

  // ——— Bridge: routes → destination+amount quote (honest fees) ———
  if (intent === "bridge") {
    const m = opts.message.toLowerCase();
    const dest =
      /sepolia/.test(m) ? "Sepolia"
      : /hyperliquid|hyperevm/.test(m) ? "Hyperliquid EVM Testnet"
      : /bsc|bnb/.test(m) ? "BSC Testnet"
      : state.bridgeTo;
    const amount = extractAmount(opts.message) ?? state.amountInUnits;

    cards.push({
      type: "bridge_routes",
      title: "FXRP OFT routes · Coston2",
      source: "Flare Testnet Coston2",
      oftAdapter: "0xCd3d2127935Ae82Af54Fc31cCD9D3440dbF46639",
      routes: COSTON2_FXRP_OFT_ROUTES,
      unavailable: ["Arbitrary EVM chains without OFT peer", "Fake fee quotes without quoteSend"],
      docs: [
        { label: "OFT peers discovery", href: "https://dev.flare.network/fxrp/oft/fxrp-autoredeem#discovering-available-bridge-routes" },
        { label: "LayerZero · Flare Testnet", href: "https://docs.layerzero.network/v2/deployments/chains/flare-testnet" },
        { label: "FXRP automint + bridge", href: "https://dev.flare.network/fxrp/oft/fxrp-automint" },
      ],
      honesty:
        "Supported peers from official getOftPeers. Beacon will not claim a bridge filled without an OFT send receipt. Fees require an on-chain quote at send time.",
    });

    if (dest && amount && amount !== "all") {
      const route = COSTON2_FXRP_OFT_ROUTES.find((r) => r.chain === dest);
      cards.push({
        type: "bridge_intent",
        title: `Plan · Coston2 → ${dest}`,
        summary: `Bridge **${amount} FXRP** from Coston2 to **${dest}** (EID ${route?.eid ?? "—"}) via LayerZero OFT Adapter. Asset: FXRP (FAssets). ETA: minutes after send confirms. Messaging fee is quoted on-chain at send — we do not invent fee amounts.`,
        links: [
          { label: "FXRP automint + bridge", href: "https://dev.flare.network/fxrp/oft/fxrp-automint" },
          { label: "LayerZero Flare Testnet", href: "https://docs.layerzero.network/v2/deployments/chains/flare-testnet" },
        ],
        honesty:
          "Execution requires OFT send from a funded FXRP balance (EOA or Smart Account custom instruction for XRPL users). Beacon stores this plan in history — explorer receipt appears only after a real send tx.",
      });
      const narr = await narrate({
        intent: "bridge",
        userMessage: opts.message,
        situation: `User selected ${dest} and amount ${amount} FXRP. Confirm the plan clearly. Fees unknown until quoteSend. Do not pretend the bridge already executed.`,
        fallback: `Plan ready: **${amount} FXRP** Coston2 → **${dest}** via LayerZero OFT.\n\nNext: fund FXRP on Coston2, then run OFT send (fee quoted on-chain). I’ll record the plan in your history — no fake fill.`,
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

    if (dest && !amount) {
      const narr = await narrate({
        intent: "bridge",
        userMessage: opts.message,
        situation: `User picked ${dest}. Ask only how much FXRP to bridge. Do not re-list all clarifying questions.`,
        fallback: `Got it — destination **${dest}**. How much **FXRP** should we plan to bridge from Coston2?`,
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

    const narr = await narrate({
      intent: "bridge",
      userMessage: opts.message,
      situation:
        "Present the three supported FXRP OFT destinations. Ask which destination and FXRP amount. Do not invent fees.",
      fallback:
        "Here are the **documented FXRP OFT routes from Coston2**: BSC, Sepolia, and Hyperliquid. Which destination and how much FXRP?",
      env,
    });
    return {
      agentId: "bridge",
      text: narr.text,
      cards,
      model: narr.model,
      displayModel: narr.displayModel,
      paid: true,
      state: { intent: "bridge", phase: "quote" },
    };
  }

  // ——— Media: small → x402 quote; large → Bound Work ———
  if (intent === "image" || intent === "video" || intent === "research") {
    const m = opts.message.toLowerCase();
    const isSmallImage =
      intent === "image" &&
      (/logo|icon|thumbnail|avatar|mark|badge|sticker/.test(m) || m.length < 80);
    const isLargeCreative =
      intent === "video" ||
      (intent === "image" && /pack|campaign|brand kit|series|deck|multiple/.test(m));

    if (opts.paidResource && (intent === "image" || intent === "research")) {
      if (intent === "image") {
        const { generateProImage } = await import("./mediaPro.js");
        try {
          const img = await generateProImage(
            opts.message.replace(/^pay(ment)?\s*/i, "").trim() || opts.message,
            { env, width: 1024, height: 1024 },
          );
          const b64 = img.bytes.toString("base64");
          cards.push({
            type: "media_result",
            title: "Image ready",
            kind: "image",
            summary: `Generated via ${img.provider} after x402 settlement on Coston2.`,
            content: `data:${img.mimeType};base64,${b64}`,
            mimeType: img.mimeType,
          });
          return {
            agentId: "image",
            text: "Payment settled. Here’s your image — verify the x402 receipt on Coston2 if you need the settlement tx.",
            cards,
            model: "beacon-media",
            displayModel: "Beacon",
            paid: true,
            state: { intent: "image", phase: "idle" },
          };
        } catch {
          cards.push({
            type: "desk_link",
            title: "Generation busy — use Bound Work",
            href: "/app",
            summary: "Payment recorded. Open Bound Work to retry with escrow if instant media is saturated.",
          });
        }
      }
      if (intent === "research") {
        const narr = await narrate({
          intent: "research",
          userMessage: opts.message,
          situation: "User paid for a research brief. Deliver a concise structured brief with source checklist. No fake citations.",
          fallback: "Paid research brief unlocked. Scope received — delivering a structured outline with source checklist (no invented URLs).",
          env,
        });
        cards.push({
          type: "media_result",
          title: "Research brief",
          kind: "research",
          summary: narr.text,
        });
        return {
          agentId: "research",
          text: narr.text,
          cards,
          model: narr.model,
          displayModel: narr.displayModel,
          paid: true,
          state: { intent: "research", phase: "idle" },
        };
      }
    }

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
          deskHref: "/app",
        });
        const narr = await narrate({
          intent: "image",
          userMessage: opts.message,
          situation:
            "Small logo job. Clarify name, colors, style, transparency, reference BEFORE quoting price. Do not show payment yet.",
          fallback:
            "Happy to make that logo.\n\nQuick brief: **name**, **colors**, **style**, **transparent?** — then I’ll quote provider, price, and ETA before x402.",
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
      });
      const narr = await narrate({
        intent: "image",
        userMessage: opts.message,
        situation: `Brief ready. Quote ${res.priceUsdt0} USDT0 via x402. Provider ${res.provider}. ETA ~${res.etaSeconds}s. After payment, generate immediately.`,
        fallback: `Creative brief locked.\n\n**Provider:** ${res.provider}\n**Price:** $${res.priceUsdt0} MockUSDT0 (x402)\n**Why:** ${res.reason}\n**ETA:** ~${res.etaSeconds}s\n\nPay & run to generate — or Bound Work for a larger escrowed pack.`,
        env,
      });
      return {
        agentId: "image",
        text: narr.text,
        cards,
        model: narr.model,
        displayModel: narr.displayModel,
        paid: Boolean(opts.paidResource),
        state: { intent: "image", phase: "await_confirm" },
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
          deskHref: "/app",
        });
        const narr = await narrate({
          intent: "research",
          userMessage: opts.message,
          situation: "Clarify research scope before quoting. Do not charge yet.",
          fallback:
            "Let’s scope it first: **topic**, **depth**, **sources**, **PDF/slides?**, **competitors?** — then I’ll quote the research brief.",
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
      });
      const narr = await narrate({
        intent: "research",
        userMessage: opts.message,
        situation: `Scope ready. Quote $${res.priceUsdt0} research brief via x402. Deliver after payment.`,
        fallback: `Scope locked.\n\n**Provider:** ${res.provider}\n**Price:** $${res.priceUsdt0} MockUSDT0 (x402)\n**Why:** ${res.reason}\n**ETA:** ~${res.etaSeconds}s\n\nPay & run for the brief — larger packs use Bound Work escrow.`,
        env,
      });
      return {
        agentId: "research",
        text: narr.text,
        cards,
        model: narr.model,
        displayModel: narr.displayModel,
        paid: Boolean(opts.paidResource),
        state: { intent: "research", phase: "await_confirm" },
      };
    }

    const durationHit = m.match(/\b(15|30|60)\s*(s|sec|secs|second|seconds)?\b/);
    const prompts =
      intent === "image"
        ? ["Style / mood?", "Aspect ratio (1:1, 9:16, 16:9)?", "Any reference?", "Quality bar?"]
        : intent === "video"
          ? ["Duration — 15s, 30s, or 60s?", "Aspect ratio?", "Voice / language?", "Style?", "Audience?"]
          : ["Scope?", "Sources?", "Depth?", "Output format?"];
    cards.push({
      type: "media_clarify",
      title: intent === "video" ? "Video Bound Offer" : intent === "image" ? "Creative pack → Bound Work" : "Research → Bound Work",
      kind: intent,
      prompts,
      deskHref: "/app",
    });
    const narr = await narrate({
      intent,
      userMessage: opts.message,
      situation:
        intent === "video"
          ? "Large video job. Clarify duration then send to Bound Work escrow. Do not pretend instant generation."
          : "Larger creative/research job. Invite Bound Work for Bound Offer + escrow acceptance.",
      fallback:
        intent === "video"
          ? "Great — let’s define duration (**15 / 30 / 60s**), then we’ll seal a Bound Offer and lock escrow."
          : "This looks like a larger job. Open **Bound Work** for a sealed Bound Offer (price + acceptance) on Coston2.",
      env,
    });
    return {
      agentId: intent,
      text: narr.text,
      cards,
      model: narr.model,
      displayModel: narr.displayModel,
      paid: true,
      state: { intent, phase: "clarify", videoDuration: durationHit?.[1] },
    };
  }

  if (intent === "pay") {
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
      });
    }
    const narr = await narrate({
      intent: "pay",
      userMessage: opts.message,
      situation:
        "Present the payable Beacon resources with provider, price, reason, ETA. No orphan $0.10 buttons. MockUSDT0 for x402.",
      fallback:
        "Every payment buys a real resource:\n• FTSO deep pack · $0.25\n• Logo still · $0.50\n• Research brief · $0.75\n\nPick one — EIP-3009 x402 on Coston2 (MockUSDT0).",
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
      href: "/app",
      summary: "Creative jobs with BeaconEscrow — pay only when quality passes.",
    });
    const narr = await narrate({
      intent: "desk",
      userMessage: opts.message,
      situation: "Invite them to the Bound Work desk for escrowed image/video/docs jobs.",
      fallback: "Bound Work is ready — open the desk to create a job, get a Bound Offer, and lock funds in escrow until quality passes.",
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
      "I'm Beacon on Flare. I can pull FTSO signals, quote USDT0→FXRP swaps, plan bridges, take x402 micropays, or start Bound Work. What should we do?",
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
