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

/** Human-facing model label — never expose provider brand. */
export function displayModelName(model: string): string {
  const m = model.toLowerCase();
  if (m.includes("claude-opus-5") || m.includes("opus-5")) return "Claude Opus 5";
  if (m.includes("claude-opus-4") || m.includes("opus-4")) return "Claude Opus 4";
  if (m.includes("gpt-5.6") || m.includes("gpt-5")) return "GPT-5.6";
  if (m.includes("x402")) return "Beacon";
  if (m.includes("local") || m.includes("heuristic")) return "Beacon";
  return "Beacon";
}

function pickModel(intent: BeaconAgentId, env: BeaconEnv): string {
  if (intent === "swap" || intent === "trade" || intent === "bridge" || intent === "pay" || intent === "signals") {
    return env.AI_MODEL_QUOTE || "gpt-5.6-sol";
  }
  return env.AI_MODEL_GENERATOR || "claude-opus-5";
}

function detectIntent(message: string, fallback: BeaconAgentId, state?: ConversationState): BeaconAgentId {
  const m = message.toLowerCase();
  if (state && state.phase !== "idle" && !/^@\w+/.test(m.trim())) {
    // Continue active intent unless user switches with @mention
    return state.intent;
  }
  if (/@signals|ftso|price feed|oracle|\bsignals?\b/.test(m)) return "signals";
  if (/@swap|swap|usdt0.*fxrp|fxrp/.test(m) && /swap|usdt|fxrp|@swap/.test(m)) return "swap";
  if (/@bridge|bridge|layerzero|oft|stargate/.test(m)) return "bridge";
  if (/@pay|x402|micropay/.test(m)) return "pay";
  if (/@trade|trade signal|long |short /.test(m)) return "trade";
  if (/@desk|bound work/.test(m)) return "desk";
  if (/@image|create image|generate image|logo/.test(m)) return "image";
  if (/@video|create video|generate video/.test(m)) return "video";
  if (/@research|research /.test(m)) return "research";
  if (/@general/.test(m)) return "general";
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
  env: BeaconEnv;
}): Promise<{ text: string; model: string }> {
  const model = pickModel(opts.intent, opts.env);
  if (!isAiConfigured(opts.env)) {
    return { text: opts.situation, model: "beacon-local" };
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
            content: `You are Beacon, a polished financial and creative assistant on Flare Coston2.
Speak like Claude/ChatGPT: warm, clear, concise. Never invent transaction hashes.
Never mention AgentRouter, providers, APIs, calldata, HTML, or internal errors.
Never dump addresses unless the user asks. Prefer natural language.
MockUSDT0 is for Beacon pay/escrow only. SparkDEX swaps use Coston2 USDT0.
Situation for this turn:\n${opts.situation}`,
          },
          { role: "user", content: opts.userMessage },
        ],
      },
      opts.env,
    );
    return { text: sanitizeAssistantText(result.content), model: result.model };
  } catch {
    return { text: sanitizeAssistantText(opts.situation), model };
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
        displayModel: displayModelName(narr.model),
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
        displayModel: displayModelName(narr.model),
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
        env,
      });
      return {
        agentId: "swap",
        text: narr.text,
        cards,
        model: narr.model,
        displayModel: displayModelName(narr.model),
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
        env,
      });
      return {
        agentId: "swap",
        text: narr.text,
        cards,
        model: narr.model,
        displayModel: displayModelName(narr.model),
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
        env,
      });
      return {
        agentId: "swap",
        text: narr.text,
        cards,
        model: narr.model,
        displayModel: displayModelName(narr.model),
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
      env,
    });
    return {
      agentId: "swap",
      text: narr.text,
      cards,
      model: narr.model,
      displayModel: displayModelName(narr.model),
      paid: true,
      state: { intent: "swap", phase: "ready_execute", amountInUnits: finalAmount },
    };
  }

  // ——— Bridge clarify ———
  if (intent === "bridge") {
    const hasRoute = /coston2|flare|sepolia|ethereum|base|bnb/i.test(opts.message) && extractAmount(opts.message);
    if (!hasRoute && state.phase !== "quote") {
      cards.push({
        type: "bridge_clarify",
        title: "Let’s plan your bridge",
        prompts: [
          "Source chain? (e.g. Coston2 / Flare)",
          "Destination chain?",
          "Asset and amount?",
          "Need arrival estimate + fees?",
        ],
      });
      const narr = await narrate({
        intent: "bridge",
        userMessage: opts.message,
        situation:
          "Ask clarifying questions for a LayerZero/OFT bridge. Be honest that FXRP OFT is mainly documented for mainnet routes; on Coston2 we plan carefully and never fake a filled bridge.",
        env,
      });
      return {
        agentId: "bridge",
        text: narr.text,
        cards,
        model: narr.model,
        displayModel: displayModelName(narr.model),
        paid: true,
        state: { intent: "bridge", phase: "clarify" },
      };
    }
    cards.push({
      type: "bridge_intent",
      title: "Bridge planner · LayerZero / FXRP OFT",
      summary:
        "Flare documents LayerZero V2 and FXRP OFT. On Coston2 we prepare an honest plan — we will not claim a bridge filled without a real OFT send receipt.",
      links: [
        { label: "LayerZero · Flare Testnet", href: "https://docs.layerzero.network/v2/deployments/chains/flare-testnet" },
        { label: "Developer Tools", href: "https://dev.flare.network/network/developer-tools?network=coston2" },
        { label: "FXRP OFT", href: "https://dev.flare.network/fxrp/oft" },
        { label: "Stargate", href: "https://stargate.finance/" },
      ],
      honesty: "Confirm destination OFT + liquidity before signing anything.",
    });
    const narr = await narrate({
      intent: "bridge",
      userMessage: opts.message,
      situation: "Summarize bridge options and next steps without inventing fees or ETAs.",
      env,
    });
    return {
      agentId: "bridge",
      text: narr.text,
      cards,
      model: narr.model,
      displayModel: displayModelName(narr.model),
      paid: true,
      state: { intent: "bridge", phase: "quote" },
    };
  }

  // ——— Media clarify (conversational creative brief) ———
  if (intent === "image" || intent === "video" || intent === "research") {
    const m = opts.message.toLowerCase();
    const durationHit = m.match(/\b(15|30|60)\s*(s|sec|secs|second|seconds)?\b/);
    const hasAspect = /\b(1:1|9:16|16:9|4:5)\b/.test(m);
    const hasStyle = /\b(cinematic|minimal|bold|warm|luxury|playful|documentary)\b/.test(m);
    const readyForDesk =
      intent === "video"
        ? Boolean(durationHit && (hasAspect || hasStyle || state.phase === "quote"))
        : intent === "image"
          ? Boolean(hasAspect || hasStyle || /logo|poster|ad|packshot/.test(m))
          : Boolean(/sources?|depth|format|brief/.test(m) && m.length > 40);

    if (!readyForDesk) {
      const prompts =
        intent === "image"
          ? ["Style / mood?", "Aspect ratio (1:1, 9:16, 16:9)?", "Any reference?", "Quality bar?"]
          : intent === "video"
            ? ["Duration — 15s, 30s, or 60s?", "Aspect ratio?", "Voice / language?", "Style?", "Audience?", "Delivery deadline?"]
            : ["Scope?", "Sources to prioritize?", "Depth?", "Output format?"];
      cards.push({
        type: "media_clarify",
        title: intent === "image" ? "Image brief" : intent === "video" ? "Video brief" : "Research brief",
        kind: intent,
        prompts,
        deskHref: "/app",
      });
      const narr = await narrate({
        intent,
        userMessage: opts.message,
        situation:
          intent === "video"
            ? `User wants a video/ad. Ask conversationally for duration (offer 15/30/60), aspect, voice, language, style, audience. Do not start generation yet. When enough is known, invite Bound Work desk to lock escrow.`
            : `Ask 2–4 short follow-ups for a ${intent} job, then invite Bound Work desk (/app) to seal a Bound Offer and lock escrow.`,
        env,
      });
      return {
        agentId: intent,
        text: narr.text,
        cards,
        model: narr.model,
        displayModel: displayModelName(narr.model),
        paid: true,
        state: {
          intent,
          phase: "clarify",
          videoDuration: durationHit?.[1],
        },
      };
    }

    cards.push({
      type: "media_clarify",
      title: "Ready for Bound Offer",
      kind: intent,
      prompts: [
        "Open Bound Work desk to get a sealed price + acceptance rubric.",
        "Funds lock in BeaconEscrow with EIP-3009 — pay only if quality passes.",
      ],
      deskHref: "/app",
    });
    const narr = await narrate({
      intent,
      userMessage: opts.message,
      situation: `Summarize the brief warmly. Estimated duration preference ${durationHit?.[1] ?? state.videoDuration ?? "TBD"}. Invite them to /app to approve a Bound Offer. Never invent a price.`,
      env,
    });
    return {
      agentId: intent,
      text: narr.text,
      cards,
      model: narr.model,
      displayModel: displayModelName(narr.model),
      paid: true,
      state: { intent, phase: "quote", videoDuration: durationHit?.[1] ?? state.videoDuration },
    };
  }

  if (intent === "pay") {
    cards.push({
      type: "x402_quote",
      title: "Pay with x402",
      priceUsdt0: "0.10",
      resource: "/v1/agents/premium",
      payTo: env.X402_PAYEE_ADDRESS || "",
      token: env.X402_TOKEN_ADDRESS || "",
      facilitator: env.X402_FACILITATOR_ADDRESS || "",
      chainId: 114,
    });
    const narr = await narrate({
      intent: "pay",
      userMessage: opts.message,
      situation:
        "Explain they will sign one EIP-3009 authorization (gasless for them); Beacon settles on Coston2. This uses Beacon MockUSDT0 for agent micropay — not SparkDEX USDT0.",
      env,
    });
    return {
      agentId: "pay",
      text: narr.text,
      cards,
      model: narr.model,
      displayModel: displayModelName(narr.model),
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
      env,
    });
    return {
      agentId: "desk",
      text: narr.text,
      cards,
      model: narr.model,
      displayModel: displayModelName(narr.model),
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
    env,
  });
  return {
    agentId: "general",
    text: narr.text,
    cards: [],
    model: narr.model,
    displayModel: displayModelName(narr.model),
    paid: true,
    state: { intent: "general", phase: "idle" },
  };
}
