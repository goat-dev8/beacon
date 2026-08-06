import { explorerTx, explorerLabel } from "@/lib/explorers";
import type { ConvState } from "@/lib/flowTypes";

export type AgentCard = Record<string, unknown> & { type: string; title?: string };

/**
 * Mutable execution surface phases (product UX).
 * Prefer server `convState.phase` + event-backed tx status over local inference.
 */
export type ExecutionPhaseId =
  | "quote"
  | "authorization"
  | "source_tx"
  | "protocol_observe"
  | "destination_receipt"
  | "next_step";

export const EXECUTION_PHASES: { id: ExecutionPhaseId; label: string }[] = [
  { id: "quote", label: "Quote" },
  { id: "authorization", label: "Authorization" },
  { id: "source_tx", label: "Source tx" },
  { id: "protocol_observe", label: "Protocol observe" },
  { id: "destination_receipt", label: "Destination receipt" },
  { id: "next_step", label: "Next step" },
];

export type ActionableCardType =
  | "swap_prepare"
  | "bridge_prepare"
  | "x402_quote"
  | "media_result"
  | "swap_quote"
  | "bridge_quote"
  | "authorization_receipt";

const ACTIONABLE_TYPES = new Set<string>([
  "swap_prepare",
  "bridge_prepare",
  "x402_quote",
  "media_result",
  "swap_quote",
  "bridge_quote",
  "authorization_receipt",
]);

export type CardExecutionState = {
  approveStatus?: "idle" | "pending" | "confirmed" | "skipped";
  swapStatus?: "idle" | "pending" | "confirmed" | "failed";
  sendStatus?: "idle" | "pending" | "confirmed" | "failed";
  approveHash?: string | null;
  swapHash?: string | null;
  sendHash?: string | null;
  payBusy?: boolean;
};

export type ActiveExecution = {
  msgId: string;
  cardIndex: number;
  card: AgentCard;
  cardType: ActionableCardType;
  phase: ExecutionPhaseId;
  title: string;
  summary: string;
  chainId: number;
  explorerLinks: { label: string; href: string }[];
  steps: { label: string; status: string; hash?: string | null }[];
  /** When true, inspector should hide (work finished + next step acknowledged). */
  dismissible: boolean;
};

export function cardKey(msgId: string, cardIndex: number) {
  return `${msgId}:${cardIndex}`;
}

export function isActionableCard(type: string): type is ActionableCardType {
  return ACTIONABLE_TYPES.has(type);
}

function chainIdFromCard(card: AgentCard, cardType: ActionableCardType): number {
  if (typeof card.chainId === "number") return card.chainId;
  if (typeof card.chainId === "string" && card.chainId) return Number(card.chainId);
  if (cardType === "swap_prepare" || cardType === "swap_quote") return 14;
  return 114;
}

/** Map server conversation phase onto the execution surface when present. */
function phaseFromServer(convPhase: string | undefined): ExecutionPhaseId | null {
  if (!convPhase) return null;
  switch (convPhase) {
    case "await_confirm":
    case "quote":
      return "quote";
    case "ready_execute":
      return "authorization";
    case "clarify":
    case "idle":
      return null;
    default:
      return null;
  }
}

function phaseFromCard(
  cardType: ActionableCardType,
  exec: CardExecutionState | undefined,
  isSettled: boolean,
  serverPhase: ExecutionPhaseId | null,
): ExecutionPhaseId {
  if (cardType === "media_result") return "destination_receipt";

  if (cardType === "authorization_receipt") {
    return "authorization";
  }

  if (cardType === "swap_quote" || cardType === "bridge_quote") {
    return serverPhase ?? "quote";
  }

  if (cardType === "x402_quote") {
    if (isSettled) return "destination_receipt";
    if (exec?.payBusy) return "authorization";
    return serverPhase ?? "quote";
  }

  if (cardType === "swap_prepare") {
    if (exec?.swapStatus === "confirmed") return "destination_receipt";
    if (exec?.swapStatus === "failed") return "protocol_observe";
    if (exec?.swapStatus === "pending" || exec?.approveStatus === "pending") return "source_tx";
    if (exec?.approveStatus === "confirmed") return "source_tx";
    // Prefer server ready_execute → authorization before local wallet signing.
    return serverPhase ?? "authorization";
  }

  if (cardType === "bridge_prepare") {
    if (exec?.sendStatus === "confirmed") return "protocol_observe";
    if (exec?.sendStatus === "failed") return "protocol_observe";
    if (exec?.sendStatus === "pending" || exec?.approveStatus === "pending") return "source_tx";
    if (exec?.approveStatus === "confirmed") return "source_tx";
    return serverPhase ?? "authorization";
  }

  return serverPhase ?? "quote";
}

function buildExplorerLinks(
  card: AgentCard,
  cardType: ActionableCardType,
  exec: CardExecutionState | undefined,
  chainId: number,
): { label: string; href: string }[] {
  const links: { label: string; href: string }[] = [];
  const net = explorerLabel(chainId);

  if (cardType === "swap_prepare" && exec?.swapHash) {
    links.push({ label: `Swap · ${net}`, href: explorerTx(exec.swapHash, chainId) });
  }
  if (exec?.approveHash) {
    links.push({
      label: `Approve · ${explorerLabel(chainId)}`,
      href: explorerTx(exec.approveHash, chainId),
    });
  }
  if (cardType === "bridge_prepare" && exec?.sendHash) {
    // Bridge source always Coston2.
    links.push({ label: "Source tx · Coston2", href: explorerTx(exec.sendHash, 114) });
    const lzBase = String(card.layerZeroScanBase ?? "https://testnet.layerzeroscan.com/tx/");
    links.push({ label: "LayerZero Scan", href: `${lzBase}${exec.sendHash}` });
  }
  if (cardType === "media_result" && typeof card.paymentTxHint === "string" && card.paymentTxHint) {
    links.push({ label: "Settlement · Coston2", href: explorerTx(card.paymentTxHint, 114) });
  }

  return links;
}

function buildSteps(
  cardType: ActionableCardType,
  exec: CardExecutionState | undefined,
  card: AgentCard,
): { label: string; status: string; hash?: string | null }[] {
  if (cardType === "swap_prepare") {
    const symbolIn = String(card.symbolIn ?? "USDT0");
    return [
      { label: `Approve ${symbolIn}`, status: exec?.approveStatus ?? "idle", hash: exec?.approveHash },
      { label: "Swap", status: exec?.swapStatus ?? "idle", hash: exec?.swapHash },
    ];
  }
  if (cardType === "bridge_prepare") {
    return [
      { label: "Approve FXRP", status: exec?.approveStatus ?? "idle", hash: exec?.approveHash },
      { label: "OFT send", status: exec?.sendStatus ?? "idle", hash: exec?.sendHash },
    ];
  }
  if (cardType === "x402_quote") {
    return [{ label: "EIP-3009 pay", status: exec?.payBusy ? "pending" : "idle" }];
  }
  if (cardType === "media_result") {
    return [{ label: "Delivered", status: "confirmed" }];
  }
  if (cardType === "authorization_receipt") {
    return [
      {
        label: card.allowed === true ? "Policy allowed" : "Policy blocked",
        status: card.allowed === true ? "confirmed" : "failed",
      },
    ];
  }
  if (cardType === "swap_quote" || cardType === "bridge_quote") {
    return [{ label: "Await confirm", status: "idle" }];
  }
  return [];
}

function summaryForCard(card: AgentCard, cardType: ActionableCardType): string {
  if (cardType === "swap_prepare" || cardType === "swap_quote") {
    const symbolIn = String(card.symbolIn ?? "USDT0");
    const symbolOut = String(card.symbolOut ?? "FXRP");
    const est = String(card.estimatedOut ?? card.estimatedFxrp ?? "—");
    return `Swap ${String(card.amountInDisplay)} ${symbolIn} → ~${est} ${symbolOut}`;
  }
  if (cardType === "bridge_prepare" || cardType === "bridge_quote") {
    return `Bridge ${String(card.amountDisplay)} FXRP → ${String(card.destination)}`;
  }
  if (cardType === "x402_quote") {
    return `$${String(card.priceUsdt0)} · ${String(card.provider ?? "Beacon")}`;
  }
  if (cardType === "media_result") {
    return String(card.summary ?? "Result ready");
  }
  if (cardType === "authorization_receipt") {
    return String(card.reason ?? "Policy decision");
  }
  return String(card.title ?? "Execution");
}

function toActive(
  msgId: string,
  cardIndex: number,
  card: AgentCard,
  type: ActionableCardType,
  exec: CardExecutionState | undefined,
  isSettled: boolean,
  serverPhase: ExecutionPhaseId | null,
): ActiveExecution {
  const chainId = chainIdFromCard(card, type);
  const phase = phaseFromCard(type, exec, isSettled, serverPhase);
  return {
    msgId,
    cardIndex,
    card,
    cardType: type,
    phase,
    title: String(card.title ?? type.replace(/_/g, " ")),
    summary: summaryForCard(card, type),
    chainId,
    explorerLinks: buildExplorerLinks(card, type, exec, chainId),
    steps: buildSteps(type, exec, card),
    dismissible: phase === "destination_receipt" || phase === "next_step",
  };
}

function isInFlight(type: ActionableCardType, exec: CardExecutionState | undefined): boolean {
  if (!exec) return false;
  if (type === "x402_quote" && exec.payBusy) return true;
  if (type === "swap_prepare") {
    return exec.approveStatus === "pending" || exec.swapStatus === "pending";
  }
  if (type === "bridge_prepare") {
    return exec.approveStatus === "pending" || exec.sendStatus === "pending";
  }
  return false;
}

/**
 * Prefer live / in-flight work. Uses server convState.phase when available
 * so local status does not invent completion ahead of the backend.
 */
export function findActiveExecution(
  messages: Array<{ id: string; role: string; cards?: AgentCard[] }>,
  executionStates: Record<string, CardExecutionState>,
  settledServiceIds: Set<string>,
  convState?: ConvState,
): ActiveExecution | null {
  const serverPhase = phaseFromServer(convState?.phase);

  let latestDeliveredServiceId = "";
  for (let mi = messages.length - 1; mi >= 0 && !latestDeliveredServiceId; mi--) {
    const msg = messages[mi];
    if (msg.role !== "assistant" || !msg.cards?.length) continue;
    for (let ci = msg.cards.length - 1; ci >= 0; ci--) {
      const card = msg.cards[ci];
      if (card.type !== "media_result") continue;
      const serviceId = typeof card.serviceId === "string" ? card.serviceId : "";
      if (serviceId) {
        latestDeliveredServiceId = serviceId;
        break;
      }
    }
  }

  let bestReceipt: ActiveExecution | null = null;
  let bestUnpaid: ActiveExecution | null = null;
  let bestSettledMatching: ActiveExecution | null = null;
  let bestSettledAny: ActiveExecution | null = null;
  let bestInFlight: ActiveExecution | null = null;
  let bestQuote: ActiveExecution | null = null;

  for (let mi = messages.length - 1; mi >= 0; mi--) {
    const msg = messages[mi];
    if (msg.role !== "assistant" || !msg.cards?.length) continue;

    for (let ci = msg.cards.length - 1; ci >= 0; ci--) {
      const card = msg.cards[ci];
      const type = card.type;
      if (!isActionableCard(type)) continue;

      const key = cardKey(msg.id, ci);
      const exec = executionStates[key];
      const serviceId = typeof card.serviceId === "string" ? card.serviceId : "";
      const isSettled = type === "x402_quote" && serviceId ? settledServiceIds.has(serviceId) : false;
      const active = toActive(msg.id, ci, card, type, exec, isSettled, serverPhase);

      if (isInFlight(type, exec) && !bestInFlight) {
        bestInFlight = active;
        continue;
      }

      if (type === "media_result" && !bestReceipt) {
        bestReceipt = active;
        continue;
      }

      if (type === "authorization_receipt" && !bestUnpaid) {
        bestUnpaid = active;
        continue;
      }

      if ((type === "swap_quote" || type === "bridge_quote") && !bestQuote) {
        bestQuote = active;
        continue;
      }

      if (type === "x402_quote" && !isSettled && !bestUnpaid) {
        bestUnpaid = active;
        continue;
      }

      if (type === "x402_quote" && isSettled) {
        if (!bestSettledAny) bestSettledAny = active;
        if (serviceId && serviceId === latestDeliveredServiceId && !bestSettledMatching) {
          bestSettledMatching = active;
        }
        continue;
      }

      if (type === "swap_prepare" || type === "bridge_prepare") {
        const done =
          (type === "swap_prepare" && exec?.swapStatus === "confirmed") ||
          (type === "bridge_prepare" && exec?.sendStatus === "confirmed");
        if (done) {
          if (!bestReceipt) bestReceipt = active;
        } else if (!bestUnpaid) {
          bestUnpaid = active;
        }
      }
    }
  }

  return (
    bestInFlight ??
    bestUnpaid ??
    bestQuote ??
    bestReceipt ??
    bestSettledMatching ??
    bestSettledAny
  );
}

export function inferSettledServiceIds(
  messages: Array<{ role: string; cards?: AgentCard[] }>,
): Set<string> {
  const settled = new Set<string>();
  for (const msg of messages) {
    if (msg.role !== "assistant" || !msg.cards) continue;
    for (const card of msg.cards) {
      if (card.type === "media_result") {
        const serviceId = typeof card.serviceId === "string" ? card.serviceId : "";
        if (serviceId) settled.add(serviceId);
      }
    }
  }
  return settled;
}
