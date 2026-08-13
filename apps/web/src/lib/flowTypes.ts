import type { AgentCard } from "@/lib/executionPhases";

export type AgentId =
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

export interface ChatMsg {
  id: string;
  role: "user" | "assistant" | "system";
  agentId?: AgentId;
  text: string;
  cards?: AgentCard[];
  displayModel?: string;
}

export type ConvState = {
  intent: string;
  phase: string;
  amountInUnits?: string;
  bridgeFrom?: string;
  bridgeTo?: string;
  serviceId?: string;
  creativeBrief?: string;
  quotePrice?: string;
} | null;

export type PaidResendMeta = {
  agentId?: AgentId;
  serviceId?: string;
  resource?: string;
  brief?: string;
};

export type FlowConv = {
  id: string;
  title: string;
  agent_id: string;
  pinned: boolean;
  updated_at: string;
  created_at: string;
};

export const WELCOME: ChatMsg = {
  id: "welcome",
  role: "system",
  text: "Beacon is Flare AI OS. Describe a move (swap, bridge, portfolio, yield, FAssets, x402) and I will quote, check policy, then leave an explorer receipt. Start from a capability below or type freely.",
};

/** Card types that belong to discovery / catalog (not the live execution path). */
export const DISCOVERY_CARD_TYPES = new Set([
  "swap_pairs",
  "bridge_routes",
  "ftso_signals",
  "portfolio_desk",
  "fassets_desk",
  "fassets_redeem_prep",
  "fassets_redeem_status",
  "yield_vaults",
  "market_intel",
  "bridge_intent",
  "desk_link",
]);

/** Card types that are interactive execution / quote surfaces. */
export const LIVE_CARD_TYPES = new Set([
  "swap_clarify",
  "swap_quote",
  "swap_prepare",
  "bridge_clarify",
  "bridge_quote",
  "bridge_prepare",
  "media_clarify",
  "x402_quote",
  "media_result",
  "authorization_receipt",
  "insufficient",
  "fdc_receipt",
  "fassets_redeem_prep",
  "fassets_redeem_status",
]);

/**
 * Only the latest assistant turn renders full interactive cards.
 * Older turns keep prose; discovery/catalog cards are omitted so they
 * never stack as an active wall beside quote/prepare.
 */
export function cardsForDisplay(
  msg: ChatMsg,
  msgIndex: number,
  messages: ChatMsg[],
): { card: AgentCard; index: number; mode: "live" | "compact" }[] {
  if (!msg.cards?.length || msg.role !== "assistant") return [];

  let latestAssistant = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      latestAssistant = i;
      break;
    }
  }

  const isLatest = msgIndex === latestAssistant;
  const out: { card: AgentCard; index: number; mode: "live" | "compact" }[] = [];

  msg.cards.forEach((card, index) => {
    if (isLatest) {
      out.push({ card, index, mode: "live" });
      return;
    }
    // Historical discovery catalogs: hide entirely.
    if (DISCOVERY_CARD_TYPES.has(card.type)) return;
    // Historical live cards: compact receipt chip only.
    if (LIVE_CARD_TYPES.has(card.type)) {
      out.push({ card, index, mode: "compact" });
    }
  });

  return out;
}
