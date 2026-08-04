import { chatCompletion, isAiConfigured } from "./ai.js";
import { loadEnv, type BeaconEnv } from "./env.js";
import {
  buildTradeSignal,
  prepareUsdt0ToFxrpSwap,
  readFtsoFeeds,
  COSTON2_USDT0,
  SPARKDEX_SWAP_ROUTER,
} from "./ftso.js";

export type BeaconAgentId =
  | "general"
  | "signals"
  | "swap"
  | "bridge"
  | "pay"
  | "trade"
  | "desk";

export interface AgentDef {
  id: BeaconAgentId;
  name: string;
  blurb: string;
  builtIn: boolean;
  x402PriceUsdt0: number; // 0 = free peek
  mention: string;
}

export const BEACON_AGENTS: AgentDef[] = [
  {
    id: "general",
    name: "General chat",
    blurb: "Flare-native co-pilot. @mention any agent.",
    builtIn: true,
    x402PriceUsdt0: 0,
    mention: "@general",
  },
  {
    id: "signals",
    name: "FTSO Signals",
    blurb: "Live Flare Time Series Oracle feeds + bias.",
    builtIn: true,
    x402PriceUsdt0: 0,
    mention: "@signals",
  },
  {
    id: "swap",
    name: "Swap USDT0→FXRP",
    blurb: "SparkDEX Uniswap V3 — you sign in MetaMask.",
    builtIn: true,
    x402PriceUsdt0: 0,
    mention: "@swap",
  },
  {
    id: "bridge",
    name: "Bridge planner",
    blurb: "LayerZero / FXRP OFT intent (honest Coston2 limits).",
    builtIn: true,
    x402PriceUsdt0: 0.1,
    mention: "@bridge",
  },
  {
    id: "pay",
    name: "Pay x402",
    blurb: "Micropay with EIP-3009 USDT0 on Coston2.",
    builtIn: true,
    x402PriceUsdt0: 0,
    mention: "@pay",
  },
  {
    id: "trade",
    name: "Trade desk",
    blurb: "FTSO signal + optional swap card.",
    builtIn: true,
    x402PriceUsdt0: 0.1,
    mention: "@trade",
  },
  {
    id: "desk",
    name: "Bound Work desk",
    blurb: "Escrow creative jobs — pay only when it passes.",
    builtIn: true,
    x402PriceUsdt0: 0,
    mention: "@desk",
  },
];

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
      type: "swap_prepare";
      title: string;
      tokenIn: string;
      tokenOut: string;
      router: string;
      amountIn: string;
      amountOutMinimum: string;
      approveTo: string;
      swapTo: string;
      approveData: string;
      swapData: string;
      docs: string[];
      warning: string;
    }
  | {
      type: "bridge_intent";
      title: string;
      summary: string;
      links: Array<{ label: string; href: string }>;
      honesty: string;
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
  paid: boolean;
}

function detectAgent(message: string, fallback: BeaconAgentId): BeaconAgentId {
  const m = message.toLowerCase();
  if (/@signals|ftso|price feed|oracle/.test(m)) return "signals";
  if (/@swap|swap .*fxrp|usdt0.*fxrp/.test(m)) return "swap";
  if (/@bridge|layerzero|oft|stargate/.test(m)) return "bridge";
  if (/@pay|x402|micropay/.test(m)) return "pay";
  if (/@trade|long|short|trade signal/.test(m)) return "trade";
  if (/@desk|bound work|generate (image|video)/.test(m)) return "desk";
  if (/@general/.test(m)) return "general";
  return fallback;
}

function extractAmount(message: string): string {
  const hit = message.match(/(\d+(?:\.\d+)?)\s*(usdt0|usdt|usd)?/i);
  if (hit) return hit[1]!;
  return "1";
}

export async function runBeaconAgentChat(opts: {
  agentId?: BeaconAgentId;
  message: string;
  wallet?: string;
  paidResource?: boolean;
  env?: BeaconEnv;
}): Promise<AgentChatResult> {
  const env = opts.env ?? loadEnv();
  const agentId = detectAgent(opts.message, opts.agentId ?? "general");
  const def = BEACON_AGENTS.find((a) => a.id === agentId)!;
  const cards: AgentCard[] = [];
  const toolNotes: string[] = [];

  if (def.x402PriceUsdt0 > 0 && !opts.paidResource) {
    cards.push({
      type: "x402_quote",
      title: "Payment required",
      priceUsdt0: def.x402PriceUsdt0.toFixed(2),
      resource: `/v1/agents/chat:${agentId}`,
      payTo: env.X402_PAYEE_ADDRESS || env.BEACON_ESCROW || "",
      token: env.X402_TOKEN_ADDRESS || "",
      facilitator: env.X402_FACILITATOR_ADDRESS || "",
      chainId: Number(env.CHAIN_ID) || 114,
    });
    return {
      agentId,
      text: `${def.name} needs a ${def.x402PriceUsdt0} USDT0 x402 micropayment (EIP-3009 on Coston2) before running the full tool pack. Sign the pay card, then resend.`,
      cards,
      model: "x402-gate",
      paid: false,
    };
  }

  if (agentId === "signals" || agentId === "trade") {
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
    toolNotes.push(
      `FTSO ${snap.ftsoV2} @ ${snap.timestamp}: ${signal.highlights.join(" · ")}. Bias=${signal.bias}. ${signal.summary}`,
    );
  }

  if (agentId === "swap" || (agentId === "trade" && /swap|fxrp|buy/i.test(opts.message))) {
    const recipient = opts.wallet || "0x0000000000000000000000000000000000000000";
    if (recipient === "0x0000000000000000000000000000000000000000") {
      cards.push({
        type: "insufficient",
        title: "Connect wallet",
        summary: "Connect MetaMask on Coston2 so we can set the FXRP recipient for the swap card.",
        faucetHref: "https://faucet.flare.network/coston2",
      });
    } else {
      const prep = await prepareUsdt0ToFxrpSwap(
        { amountInUnits: extractAmount(opts.message), recipient },
        env,
      );
      cards.push({
        type: "swap_prepare",
        title: "Swap USDT0 → FXRP (SparkDEX)",
        tokenIn: prep.tokenIn,
        tokenOut: prep.tokenOut,
        router: prep.router,
        amountIn: prep.amountIn,
        amountOutMinimum: prep.amountOutMinimum,
        approveTo: prep.approveTo,
        swapTo: prep.swapTo,
        approveData: prep.approveData,
        swapData: prep.swapData,
        docs: prep.docs,
        warning:
          "Uses Coston2 USDT0 (faucet/SparkDEX), not Beacon MockUSDT0. Approve then exactInputSingle — you confirm both txs.",
      });
      toolNotes.push(
        `Prepared SparkDEX swap router=${SPARKDEX_SWAP_ROUTER} tokenIn=${COSTON2_USDT0} tokenOut=${prep.tokenOut} amountIn=${prep.amountIn}`,
      );
    }
  }

  if (agentId === "bridge") {
    cards.push({
      type: "bridge_intent",
      title: "Bridge planner · LayerZero / FXRP OFT",
      summary:
        "Flare lists LayerZero V2 + Stargate for omnichain assets. FXRP OFT adapters are documented primarily for mainnet routes. On Coston2 we plan the bridge; we do not fake a filled OFT send.",
      links: [
        {
          label: "LayerZero · Flare Testnet",
          href: "https://docs.layerzero.network/v2/deployments/chains/flare-testnet",
        },
        {
          label: "DevHub · Developer Tools (Coston2)",
          href: "https://dev.flare.network/network/developer-tools?network=coston2",
        },
        { label: "FXRP OFT overview", href: "https://dev.flare.network/fxrp/oft" },
        { label: "Stargate", href: "https://stargate.finance/" },
      ],
      honesty:
        "Confirm destination OFT + DVNs + liquidity before signing. Ask for mainnet bridge only when you are ready to leave testnet.",
    });
    toolNotes.push("Emitted honest LayerZero/OFT bridge intent card.");
  }

  if (agentId === "pay") {
    cards.push({
      type: "x402_quote",
      title: "x402 micropay",
      priceUsdt0: "0.10",
      resource: "/v1/agents/premium",
      payTo: env.X402_PAYEE_ADDRESS || "",
      token: env.X402_TOKEN_ADDRESS || "",
      facilitator: env.X402_FACILITATOR_ADDRESS || "",
      chainId: 114,
    });
    toolNotes.push("x402 quote card for 0.10 MockUSDT0.");
  }

  if (agentId === "desk") {
    cards.push({
      type: "desk_link",
      title: "Open Bound Work desk",
      href: "/app",
      summary: "Creative jobs with BeaconEscrow — pay only when acceptance passes on Coston2.",
    });
  }

  let text = "";
  let model = "local-heuristic";
  if (isAiConfigured(env)) {
    try {
      const narr = await chatCompletion(
        {
          model: env.AI_MODEL_GENERATOR || "claude-opus-5",
          temperature: 0.35,
          maxTokens: 700,
          messages: [
            {
              role: "system",
              content: `You are Beacon Flow on Flare Coston2. Be concise, product-useful, never invent tx hashes.
Agents: signals(FTSO), swap(SparkDEX USDT0→FXRP), bridge(LZ/OFT honest), pay(x402), trade, desk(escrow jobs).
Always remind: MockUSDT0 is for Beacon x402/escrow; SparkDEX uses Coston2 USDT0 ${COSTON2_USDT0}.
Tool notes:\n${toolNotes.join("\n") || "(none)"}`,
            },
            { role: "user", content: opts.message },
          ],
        },
        env,
      );
      text = narr.content;
      model = narr.model;
    } catch (err) {
      text = `${def.name} ran Flare tools. ${toolNotes.join(" ")} (${err instanceof Error ? err.message : "AI narrate skipped"})`;
    }
  } else {
    text = `${def.name}: ${toolNotes.join(" ") || "Ready. Ask for FTSO signals, USDT0→FXRP swap, bridge plan, or x402 pay."}`;
  }

  return { agentId, text, cards, model, paid: def.x402PriceUsdt0 === 0 || Boolean(opts.paidResource) };
}
