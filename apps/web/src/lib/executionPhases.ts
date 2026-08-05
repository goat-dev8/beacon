export type AgentCard = Record<string, unknown> & { type: string; title?: string };

export type ExecutionPhaseId =
  | "understanding"
  | "quote"
  | "risk"
  | "auth"
  | "execute"
  | "observe"
  | "receipt";

export const EXECUTION_PHASES: { id: ExecutionPhaseId; label: string }[] = [
  { id: "understanding", label: "Understanding" },
  { id: "quote", label: "Quote" },
  { id: "risk", label: "Risk" },
  { id: "auth", label: "Auth" },
  { id: "execute", label: "Execute" },
  { id: "observe", label: "Observe" },
  { id: "receipt", label: "Receipt" },
];

export type ActionableCardType = "swap_prepare" | "bridge_prepare" | "x402_quote" | "media_result";

const ACTIONABLE_TYPES = new Set<string>([
  "swap_prepare",
  "bridge_prepare",
  "x402_quote",
  "media_result",
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
  explorerLinks: { label: string; href: string }[];
  steps: { label: string; status: string; hash?: string | null }[];
};

export function cardKey(msgId: string, cardIndex: number) {
  return `${msgId}:${cardIndex}`;
}

export function isActionableCard(type: string): type is ActionableCardType {
  return ACTIONABLE_TYPES.has(type);
}

function explorerTx(hash: string) {
  return `https://coston2-explorer.flare.network/tx/${hash}`;
}

function phaseFromCard(
  cardType: ActionableCardType,
  exec: CardExecutionState | undefined,
  isSettled: boolean,
): ExecutionPhaseId {
  if (cardType === "media_result") return "receipt";

  if (cardType === "x402_quote") {
    if (isSettled) return "receipt";
    if (exec?.payBusy) return "auth";
    return "quote";
  }

  if (cardType === "swap_prepare") {
    if (exec?.swapStatus === "confirmed") return "receipt";
    if (exec?.swapStatus === "pending" || exec?.approveStatus === "pending") return "execute";
    if (exec?.approveStatus === "confirmed") return "execute";
    if (exec?.swapStatus === "failed") return "observe";
    return "risk";
  }

  if (cardType === "bridge_prepare") {
    if (exec?.sendStatus === "confirmed") return "observe";
    if (exec?.sendStatus === "pending" || exec?.approveStatus === "pending") return "execute";
    if (exec?.approveStatus === "confirmed") return "execute";
    if (exec?.sendStatus === "failed") return "observe";
    return "risk";
  }

  return "understanding";
}

function buildExplorerLinks(
  card: AgentCard,
  cardType: ActionableCardType,
  exec: CardExecutionState | undefined,
): { label: string; href: string }[] {
  const links: { label: string; href: string }[] = [];

  if (cardType === "swap_prepare" && exec?.swapHash) {
    links.push({ label: "Swap tx", href: explorerTx(exec.swapHash) });
  }
  if (exec?.approveHash) {
    links.push({ label: "Approve tx", href: explorerTx(exec.approveHash) });
  }
  if (cardType === "bridge_prepare" && exec?.sendHash) {
    links.push({ label: "Source tx", href: explorerTx(exec.sendHash) });
    const lzBase = String(card.layerZeroScanBase ?? "https://testnet.layerzeroscan.com/tx/");
    links.push({ label: "LayerZero Scan", href: `${lzBase}${exec.sendHash}` });
  }
  if (cardType === "media_result" && typeof card.paymentTxHint === "string" && card.paymentTxHint) {
    links.push({ label: "Settlement tx", href: explorerTx(card.paymentTxHint) });
  }

  return links;
}

function buildSteps(
  cardType: ActionableCardType,
  exec: CardExecutionState | undefined,
): { label: string; status: string; hash?: string | null }[] {
  if (cardType === "swap_prepare") {
    return [
      { label: "Approve USDT0", status: exec?.approveStatus ?? "idle", hash: exec?.approveHash },
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
  return [];
}

function summaryForCard(card: AgentCard, cardType: ActionableCardType): string {
  if (cardType === "swap_prepare") {
    return `Swap ${String(card.amountInDisplay)} USDT0 → ~${String(card.estimatedFxrp)} FXRP`;
  }
  if (cardType === "bridge_prepare") {
    return `Bridge ${String(card.amountDisplay)} FXRP → ${String(card.destination)}`;
  }
  if (cardType === "x402_quote") {
    return `$${String(card.priceUsdt0)} · ${String(card.provider ?? "Beacon")}`;
  }
  if (cardType === "media_result") {
    return String(card.summary ?? "Result ready");
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
): ActiveExecution {
  return {
    msgId,
    cardIndex,
    card,
    cardType: type,
    phase: phaseFromCard(type, exec, isSettled),
    title: String(card.title ?? type.replace(/_/g, " ")),
    summary: summaryForCard(card, type),
    explorerLinks: buildExplorerLinks(card, type, exec),
    steps: buildSteps(type, exec),
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
 * Prefer live work over settled catalog leftovers.
 * Catalog messages list every x402 quote; picking the last card made the drawer
 * stick on Research while the user was looking at a settled FTSO pack.
 */
export function findActiveExecution(
  messages: Array<{ id: string; role: string; cards?: AgentCard[] }>,
  executionStates: Record<string, CardExecutionState>,
  settledServiceIds: Set<string>,
): ActiveExecution | null {
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
      const active = toActive(msg.id, ci, card, type, exec, isSettled);

      if (isInFlight(type, exec) && !bestInFlight) {
        bestInFlight = active;
        continue;
      }

      if (type === "media_result" && !bestReceipt) {
        bestReceipt = active;
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
      // Only mark Paid when the delivered artifact names the exact service -
      // never blanket-settle every catalog quote after any media_result.
      if (card.type === "media_result") {
        const serviceId = typeof card.serviceId === "string" ? card.serviceId : "";
        if (serviceId) settled.add(serviceId);
      }
    }
  }
  return settled;
}
