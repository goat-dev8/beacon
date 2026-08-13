import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, CheckCircle2, Clock } from "lucide-react";
import { executeSparkDexSwap, executeOftBridge } from "@/lib/wallet";
import { api } from "@/lib/api";
import { NETWORK } from "@/lib/chain";
import { explorerTx } from "@/lib/explorers";
import { cn } from "@/lib/utils";
import { formatNativeFeeDisplay, formatTokenAmount } from "@/lib/format";
import { ensureSafeAgentSession } from "@/lib/safeSession";
import { AgentText } from "@/components/AgentText";
import type { CardExecutionState, AgentCard } from "@/lib/executionPhases";
import type { AgentId, ConvState, PaidResendMeta } from "@/lib/flowTypes";
import type { Address, Hex } from "viem";

type OftDeliveryUi = {
  phase: string;
  note: string;
  guid: string | null;
  destTxHash: string | null;
  destExplorerUrl: string | null;
  layerZeroScanUrl: string;
  uiPhases: Array<{ id: string; label: string; status: string }>;
};

function FccHardwareStrip({ card }: { card: AgentCard }) {
  const status = card.teeSignedStatus;
  if (typeof status !== "number") return null;
  const allowed = status === 1;
  const href = typeof card.fccExplorer === "string" ? card.fccExplorer : null;
  const log = typeof card.fccLog === "string" ? card.fccLog : null;
  return (
    <div
      className={cn(
        "mt-3 rounded-xl border px-3 py-2 font-mono text-[11px]",
        allowed
          ? "border-signal/40 bg-signal/10 text-[var(--p-accent-text)]"
          : "border-[var(--p-danger)]/40 bg-[var(--p-danger)]/10 text-[var(--p-danger)]",
      )}
    >
      <p className="uppercase tracking-widest">
        Hardware TEE · {allowed ? "ALLOW status 1" : "DENY status 0"}
      </p>
      {card.amountUsdt0 != null && card.amountCapUsdt0 != null ? (
        <p className="mt-1 text-[var(--p-muted)]">
          {String(card.amountUsdt0)} USDT0 vs cap {String(card.amountCapUsdt0)}
        </p>
      ) : null}
      {log ? <p className="mt-1 text-[var(--p-muted)]">{log}</p> : null}
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-flex items-center gap-1 underline underline-offset-2"
        >
          Open FCC instruction <ExternalLink className="size-3" />
        </a>
      ) : null}
    </div>
  );
}

export function ActionCard({
  card,
  cardKey: execKey,
  wallet,
  convState,
  settledServiceIds,
  savedExec,
  onExecutionStateChange,
  onConnect,
  onMint,
  onPaidResend,
  onBalancesRefresh,
  onTxConfirmed,
  onQuickReply,
}: {
  card: AgentCard;
  cardKey: string;
  wallet: string | null;
  convState: ConvState;
  settledServiceIds: Set<string>;
  savedExec?: CardExecutionState;
  onExecutionStateChange: (key: string, state: CardExecutionState) => void;
  onConnect: () => void;
  onMint: () => void;
  onPaidResend: (payment: Record<string, unknown>, meta: PaidResendMeta) => void;
  onBalancesRefresh: () => void;
  onTxConfirmed?: (info: {
    kind: "swap" | "bridge";
    title: string;
    hash: string;
    explorerUrl: string;
    meta?: Record<string, unknown>;
  }) => void;
  onQuickReply: (text: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approveStatus, setApproveStatus] = useState<"idle" | "pending" | "confirmed" | "skipped" | "failed">(
    () => savedExec?.approveStatus ?? "idle",
  );
  const [swapStatus, setSwapStatus] = useState<"idle" | "pending" | "confirmed" | "failed">(
    () => savedExec?.swapStatus ?? "idle",
  );
  const [sendStatus, setSendStatus] = useState<"idle" | "pending" | "confirmed" | "failed">(
    () => savedExec?.sendStatus ?? "idle",
  );
  const [approveHash, setApproveHash] = useState<string | null>(() => savedExec?.approveHash ?? null);
  const [swapHash, setSwapHash] = useState<string | null>(() => savedExec?.swapHash ?? null);
  const [sendHash, setSendHash] = useState<string | null>(() => savedExec?.sendHash ?? null);
  const [oftDelivery, setOftDelivery] = useState<OftDeliveryUi | null>(null);

  useEffect(() => {
    if (card.type !== "bridge_prepare" || sendStatus !== "confirmed" || !sendHash) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const dstEid = typeof card.dstEid === "number" ? card.dstEid : Number(card.dstEid);
        const peer = typeof card.peer === "string" ? card.peer : undefined;
        const res = await api.agentBridgeDelivery({
          tx: sendHash,
          dstEid: Number.isFinite(dstEid) ? dstEid : undefined,
          peer,
        });
        if (!cancelled) {
          setOftDelivery({
            phase: res.delivery.phase,
            note: res.delivery.note,
            guid: res.delivery.guid,
            destTxHash: res.delivery.destTxHash,
            destExplorerUrl: res.delivery.destExplorerUrl,
            layerZeroScanUrl: res.delivery.layerZeroScanUrl,
            uiPhases: res.delivery.uiPhases,
          });
        }
      } catch {
        // Keep LZ Scan link; never invent dest fill.
      }
    };
    void poll();
    const id = window.setInterval(() => {
      void poll();
    }, 12_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [card.type, card.dstEid, card.peer, sendStatus, sendHash]);

  useEffect(() => {
    if (
      card.type === "swap_prepare" ||
      card.type === "bridge_prepare" ||
      card.type === "x402_quote" ||
      card.type === "media_result"
    ) {
      onExecutionStateChange(execKey, {
        approveStatus,
        swapStatus,
        sendStatus,
        approveHash,
        swapHash,
        sendHash,
        payBusy: busy && card.type === "x402_quote",
      });
    }
  }, [
    card.type,
    execKey,
    approveStatus,
    swapStatus,
    sendStatus,
    approveHash,
    swapHash,
    sendHash,
    busy,
    onExecutionStateChange,
  ]);

  if (card.type === "ftso_signals") {
    const feeds = (card.feeds as Array<{ symbol: string; value: number }>) ?? [];
    return (
      <div className="overflow-hidden rounded-2xl border border-[var(--p-border)] bg-[var(--p-surface)] shadow-[var(--p-shadow)] p-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-accent-text)]">{card.title}</p>
        <p className="mt-2 text-sm text-[var(--p-fg)]/90">{String(card.summary)}</p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {feeds.map((f) => (
            <div key={f.symbol} className="rounded-xl bg-[var(--p-bg)] px-3 py-2">
              <p className="font-mono text-[10px] text-[var(--p-muted)]">{f.symbol}</p>
              <p className="font-display text-lg text-[var(--p-fg)]">{f.value.toPrecision(5)}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 font-mono text-[10px] text-[var(--p-muted)]">bias · {String(card.bias)}</p>
      </div>
    );
  }

  if (card.type === "swap_clarify") {
    return (
      <div className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] p-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-muted)]">{card.title}</p>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div className="rounded-xl bg-[var(--p-surface-2)] px-3 py-2">
            <p className="font-mono text-[10px] text-[var(--p-muted)]">USDT0</p>
            <p className="font-display text-lg">{String(card.usdt0Balance ?? "-")}</p>
          </div>
          <div className="rounded-xl bg-[var(--p-surface-2)] px-3 py-2">
            <p className="font-mono text-[10px] text-[var(--p-muted)]">FXRP</p>
            <p className="font-display text-lg">{String(card.fxrpBalance ?? "-")}</p>
          </div>
        </dl>
        <div className="mt-3 flex flex-wrap gap-2">
          {["1", "5", "10", "all"].map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => onQuickReply(a === "all" ? "swap all" : `swap ${a}`)}
              className="rounded-full border border-[var(--p-border)] px-3 py-1.5 text-xs text-[var(--p-muted)] hover:border-signal/40"
            >
              {a === "all" ? "Swap all" : `${a} USDT0`}
            </button>
          ))}
          <a
            href={String(card.faucetHref)}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-[var(--p-border)] px-3 py-1.5 text-xs text-[var(--p-muted)]"
          >
            Faucet
          </a>
        </div>
      </div>
    );
  }

  if (card.type === "swap_quote") {
    const symbolIn = String(card.symbolIn ?? "USDT0");
    const symbolOut = String(card.symbolOut ?? "FXRP");
    const est = String(card.estimatedOut ?? card.estimatedFxrp);
    return (
      <div className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-surface)] shadow-[var(--p-shadow)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-accent-text)]">{card.title}</p>
          <span className="rounded-full border border-signal/40 px-2 py-0.5 font-mono text-[10px] text-signal">
            {String(card.flarePrimitive ?? "SparkDEX")}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-6">
          <div>
            <p className="font-mono text-[10px] text-[var(--p-muted)]">You pay</p>
            <p className="font-display text-2xl text-[var(--p-fg)]">
              {String(card.amountInDisplay)} {symbolIn}
            </p>
          </div>
          <div>
            <p className="font-mono text-[10px] text-[var(--p-muted)]">Est. receive</p>
            <p className="font-display text-2xl text-[var(--p-accent-text)]">
              ~{est} {symbolOut}
            </p>
          </div>
        </div>
        <p className="mt-2 text-xs text-[var(--p-muted)]">
          {String(card.network)}
          {card.chainId ? ` · chain ${String(card.chainId)}` : ""} · desk USDT0 {String(card.usdt0Balance)}
        </p>
        <p className="mt-1 text-xs text-[var(--p-muted)]">{String(card.note)}</p>
        {card.ftsoGuard ? (
          <p className="mt-2 text-xs text-signal/90">
            Live market data used to protect this execution
            {typeof (card.ftsoGuard as { feedAge?: number }).feedAge === "number"
              ? ` · FTSO age ${(card.ftsoGuard as { feedAge: number }).feedAge}s`
              : ""}
            .
          </p>
        ) : null}
        {card.honesty ? <p className="mt-2 text-xs text-amber-200/90">{String(card.honesty)}</p> : null}
        <FccHardwareStrip card={card} />
        <button
          type="button"
          onClick={() => onQuickReply("confirm")}
          className="mt-4 rounded-full bg-signal px-5 py-2 text-sm font-medium text-ink"
        >
          Confirm swap
        </button>
      </div>
    );
  }

  if (card.type === "swap_pairs") {
    const pairs = (card.pairs as Array<{
      symbolA: string;
      symbolB: string;
      bestFee: number;
      liquidity: string;
    }>) ?? [];
    return (
      <div className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-muted)]">{card.title}</p>
          <span className="rounded-full border border-signal/40 px-2 py-0.5 font-mono text-[10px] text-signal">
            {String(card.flarePrimitive)}
          </span>
        </div>
        <p className="mt-1 text-xs text-[var(--p-muted)]">
          {String(card.network)} · chain {String(card.chainId)}
        </p>
        <ul className="mt-3 space-y-2">
          {pairs.map((p) => (
            <li
              key={`${p.symbolA}-${p.symbolB}-${p.bestFee}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--p-surface-2)] px-3 py-2 text-sm"
            >
              <span className="font-display">
                {p.symbolA}/{p.symbolB}
              </span>
              <span className="font-mono text-[10px] text-[var(--p-muted)]">
                fee {p.bestFee} · liq {p.liquidity.slice(0, 12)}…
              </span>
              <button
                type="button"
                onClick={() => onQuickReply(`swap 1 ${p.symbolA} to ${p.symbolB}`)}
                className="rounded-full border border-[var(--p-border)] px-2 py-0.5 text-[10px] hover:border-signal/40"
              >
                Quote
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-amber-200/90">{String(card.honesty)}</p>
      </div>
    );
  }

  if (card.type === "portfolio_desk") {
    const positions = (card.positions as Array<{ symbol: string; balance: string; usdValue: number | null }>) ?? [];
    return (
      <div className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-muted)]">{card.title}</p>
          <span className="rounded-full border border-signal/40 px-2 py-0.5 font-mono text-[10px] text-signal">
            {String(card.flarePrimitive)}
          </span>
        </div>
        <p className="mt-2 font-display text-2xl text-[var(--p-fg)]">~${Number(card.totalUsd).toFixed(2)}</p>
        <ul className="mt-3 space-y-1.5 text-sm">
          {positions.map((p) => (
            <li key={p.symbol} className="flex justify-between gap-2">
              <span>{p.symbol}</span>
              <span className="text-[var(--p-muted)]">
                {p.balance}
                {p.usdValue != null ? ` · $${p.usdValue.toFixed(2)}` : ""}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-[var(--p-muted)]">{String(card.honesty)}</p>
      </div>
    );
  }

  if (card.type === "fdc_receipt") {
    const verified = card.onChainVerified === true;
    const submitted = Boolean(card.txHash);
    return (
      <div
        className={cn(
          "overflow-hidden rounded-2xl border px-4 py-4",
          verified
            ? "border-signal/40 bg-signal/10"
            : "border-[var(--p-border)] bg-[var(--p-card)]",
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--p-muted)]">
            {String(card.title)}
          </p>
          <span className="rounded-full border border-signal/40 px-2 py-0.5 font-mono text-[10px] text-signal">
            {verified ? "VERIFIED" : String(card.lifecycle)}
          </span>
        </div>
        <p className="mt-3 text-sm text-[var(--p-fg)]">
          AddressValidity · testXRP ·{" "}
          <span className="font-mono text-xs">{String(card.addressStr)}</span>
        </p>
        {card.votingRound != null ? (
          <p className="mt-1 font-mono text-[11px] text-[var(--p-muted)]">
            Voting round {String(card.votingRound)}
          </p>
        ) : null}
        {verified && card.isValid != null ? (
          <p className="mt-1 text-sm text-[var(--p-accent-text)]">isValid · {String(card.isValid)}</p>
        ) : null}
        <p className="mt-2 text-xs text-[var(--p-muted)]">{String(card.honesty)}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {typeof card.txExplorer === "string" && card.txExplorer ? (
            <a
              href={card.txExplorer}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-full border border-[var(--p-border)] px-3 py-1.5 text-xs text-[var(--p-muted)] hover:border-signal/40"
            >
              Open FdcHub tx <ExternalLink className="size-3" />
            </a>
          ) : null}
          {typeof card.roundExplorer === "string" && card.roundExplorer ? (
            <a
              href={card.roundExplorer}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-full border border-[var(--p-border)] px-3 py-1.5 text-xs text-[var(--p-muted)] hover:border-signal/40"
            >
              Open FDC round <ExternalLink className="size-3" />
            </a>
          ) : null}
          {typeof card.attestationExplorer === "string" && card.attestationExplorer ? (
            <a
              href={card.attestationExplorer}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-full border border-[var(--p-border)] px-3 py-1.5 text-xs text-[var(--p-muted)] hover:border-signal/40"
            >
              Attestation requests <ExternalLink className="size-3" />
            </a>
          ) : null}
        </div>
        {submitted && !verified ? (
          <button
            type="button"
            onClick={() => onQuickReply("Check FDC proof")}
            className="mt-3 rounded-full bg-signal px-5 py-2 text-sm font-medium text-ink"
          >
            Check FDC proof
          </button>
        ) : null}
      </div>
    );
  }

  if (card.type === "fassets_desk") {
    const managers = (card.managers as Array<{
      symbol: string;
      status: string;
      lotSize: number;
      minRedeem?: number | null;
      agentCount: number;
      availableAgents?: number;
      mint: string;
      redeem: string;
      bridge: string;
      mintHandoffSummary?: string;
    }>) ?? [];
    const unavailable = (card.unavailable as Array<{ symbol: string; note: string }>) ?? [];
    const lifecycle = String(card.lifecycleHonesty ?? "");
    return (
      <div className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-muted)]">{card.title}</p>
          <span className="rounded-full border border-signal/40 px-2 py-0.5 font-mono text-[10px] text-signal">
            {String(card.flarePrimitive)}
          </span>
        </div>
        <p className="mt-2 text-xs text-[var(--p-muted)]">
          XRP/USD ~${Number(card.xrpUsd).toFixed(4)}
          {card.lotValueUsd != null ? ` · lot ≈ $${Number(card.lotValueUsd).toFixed(2)}` : ""}
        </p>
        <ul className="mt-3 space-y-2">
          {managers.map((m) => (
            <li key={m.symbol} className="rounded-xl bg-[var(--p-surface-2)] px-3 py-2 text-sm">
              <p className="font-display">
                {m.symbol} · <span className="text-signal">{m.status}</span>
              </p>
              <p className="font-mono text-[10px] text-[var(--p-muted)]">
                lot {Number(m.lotSize).toFixed(4)}
                {m.minRedeem != null ? ` · min redeem ${Number(m.minRedeem).toFixed(4)}` : ""}
                {" · "}agents {m.agentCount}
                {m.availableAgents != null ? ` (${m.availableAgents} available)` : ""}
                {" · "}mint {m.mint} · redeem {m.redeem} · bridge {m.bridge}
              </p>
              {m.mint === "docs_handoff" || m.mintHandoffSummary ? (
                <p className="mt-1 text-xs text-amber-200/90">
                  {m.mintHandoffSummary ??
                    "Mint requires XRPL/Xaman agent flow: documented handoff, not an in-app mint button."}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
        {unavailable.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs text-amber-200/90">
            {unavailable.map((u) => (
              <li key={u.symbol}>
                {u.symbol}: {u.note}
              </li>
            ))}
          </ul>
        )}
        {lifecycle ? (
          <p className="mt-3 text-xs text-amber-100/90">{lifecycle}</p>
        ) : null}
        <p className="mt-2 text-xs text-[var(--p-muted)]">{String(card.honesty)}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => onQuickReply("@bridge")} className="rounded-full border border-[var(--p-border)] px-3 py-1 text-xs">
            Bridge FXRP
          </button>
          <button type="button" onClick={() => onQuickReply("@swap")} className="rounded-full border border-[var(--p-border)] px-3 py-1 text-xs">
            Swap
          </button>
          <button
            type="button"
            onClick={() =>
              onQuickReply("Prepare redeemAmount 5 FXRP to rSHYuiEvsYsKR8uUHhBTuGP5zjRcGt4nm")
            }
            className="rounded-full border border-[var(--p-border)] px-3 py-1 text-xs"
          >
            Prepare redeem (demo addr)
          </button>
          <a
            href="https://dev.flare.network/fassets/developer-guides/fassets-minting"
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-[var(--p-border)] px-3 py-1 text-xs text-[var(--p-muted)]"
          >
            Mint docs (handoff)
          </a>
        </div>
      </div>
    );
  }

  if (card.type === "fassets_redeem_prep") {
    const lifecycle = String(card.lifecycle ?? "PREPARED");
    return (
      <div className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-muted)]">
            {card.title ?? "FAssets redeem prepare"}
          </p>
          <span className="rounded-full border border-amber-400/50 px-2 py-0.5 font-mono text-[10px] text-amber-200">
            {lifecycle}
          </span>
        </div>
        <p className="mt-2 text-sm">
          {String(card.kind)} · {String(card.amountDisplay)} {String(card.symbol)} →{" "}
          <span className="font-mono text-xs">{String(card.underlyingAddress)}</span>
        </p>
        {card.destinationTag != null ? (
          <p className="mt-1 font-mono text-[10px] text-[var(--p-muted)]">
            destinationTag {String(card.destinationTag)}
          </p>
        ) : null}
        <p className="mt-2 font-mono text-[10px] text-[var(--p-muted)] break-all">
          approve → {String(card.approveTo)} · redeem → {String(card.redeemTo)}
        </p>
        <p className="mt-3 text-xs text-amber-100/90">
          {String(
            card.honesty ??
              "PREPARED only — wallet must submit. COMPLETED requires RedemptionPerformed with XRPL tx hash.",
          )}
        </p>
      </div>
    );
  }

  if (card.type === "fassets_redeem_status") {
    const lifecycle = String(card.lifecycle ?? "NOT_FOUND");
    const tone =
      lifecycle === "COMPLETED"
        ? "text-signal border-signal/40"
        : lifecycle === "DEFAULTED"
          ? "text-amber-200 border-amber-400/50"
          : lifecycle === "PENDING"
            ? "text-sky-200 border-sky-400/40"
            : "text-[var(--p-muted)] border-[var(--p-border)]";
    const xrplHash = card.xrplTransactionHash ? String(card.xrplTransactionHash) : "";
    const flareTx = card.flareTxHash ? String(card.flareTxHash) : "";
    const paymentRef = card.paymentReference ? String(card.paymentReference) : "";
    const paymentAddr = card.paymentAddress ? String(card.paymentAddress) : "";
    const xrplExplorer = card.explorerXrpl
      ? String(card.explorerXrpl)
      : xrplHash
        ? `https://testnet.xrpl.org/transactions/${xrplHash.replace(/^0x/i, "")}`
        : "";
    const flareExplorer = card.explorerFlare
      ? String(card.explorerFlare)
      : flareTx
        ? `https://coston2-explorer.flare.network/tx/${flareTx}`
        : "";
    return (
      <div className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-muted)]">
            {card.title ?? "FAssets redeem status"}
          </p>
          <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${tone}`}>
            {lifecycle}
          </span>
        </div>
        <p className="mt-2 font-mono text-xs text-[var(--p-muted)]">
          requestId {String(card.requestId)} · on-chain {String(card.onChainStatus)}
        </p>
        {paymentAddr ? (
          <p className="mt-1 font-mono text-[10px] text-[var(--p-muted)]">underlying {paymentAddr}</p>
        ) : null}
        {paymentRef ? (
          <p className="mt-1 break-all font-mono text-[10px] text-[var(--p-muted)]">
            paymentReference {paymentRef}
          </p>
        ) : null}
        {lifecycle === "COMPLETED" && xrplHash ? (
          <div className="mt-2 space-y-1">
            <p className="break-all font-mono text-[10px] text-signal">XRPL tx {xrplHash}</p>
            {xrplExplorer ? (
              <a href={xrplExplorer} target="_blank" rel="noreferrer" className="font-mono text-[10px] text-signal underline">
                XRPL explorer
              </a>
            ) : null}
            {flareExplorer ? (
              <a href={flareExplorer} target="_blank" rel="noreferrer" className="ml-3 font-mono text-[10px] text-signal underline">
                Flare RedemptionPerformed
              </a>
            ) : null}
          </div>
        ) : lifecycle === "COMPLETED" ? (
          <p className="mt-2 text-xs text-signal">On-chain SUCCESSFUL — RedemptionPerformed confirmed.</p>
        ) : (
          <p className="mt-2 text-xs text-amber-100/90">
            No XRPL payment evidence yet — not COMPLETED.
          </p>
        )}
        <p className="mt-3 text-xs text-[var(--p-muted)]">{String(card.honesty)}</p>
      </div>
    );
  }

  if (card.type === "yield_vaults") {
    const vaults = (card.vaults as Array<{
      id: string;
      vault: string;
      assetSymbol?: string;
      totalAssetsDisplay?: string;
      sharePriceDisplay?: string | null;
      userSharesDisplay?: string;
      explorer?: string;
      error?: string;
    }>) ?? [];
    return (
      <div className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-muted)]">{card.title}</p>
          <span className="rounded-full border border-signal/40 px-2 py-0.5 font-mono text-[10px] text-signal">
            {String(card.flarePrimitive)}
          </span>
        </div>
        <p className="mt-1 text-xs text-[var(--p-muted)]">
          {String(card.network)} · chain {String(card.chainId)} · no APY invented
        </p>
        <ul className="mt-3 space-y-2">
          {vaults.map((v) => (
            <li key={v.id} className="rounded-xl bg-[var(--p-surface-2)] px-3 py-2 text-sm">
              <p className="font-display capitalize">{v.id}</p>
              {v.error ? (
                <p className="text-xs text-amber-200/90">{v.error}</p>
              ) : (
                <p className="font-mono text-[10px] text-[var(--p-muted)]">
                  {v.assetSymbol ?? "asset"}
                  {v.totalAssetsDisplay != null ? ` · TVL ${v.totalAssetsDisplay}` : ""}
                  {v.sharePriceDisplay != null ? ` · share ${v.sharePriceDisplay}` : ""}
                  {v.userSharesDisplay != null ? ` · your shares ${v.userSharesDisplay}` : ""}
                </p>
              )}
              {v.explorer ? (
                <a href={v.explorer} target="_blank" rel="noreferrer" className="mt-1 inline-block font-mono text-[10px] text-signal">
                  Explorer
                </a>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-amber-200/90">{String(card.honesty)}</p>
      </div>
    );
  }

  if (card.type === "market_intel") {
    return (
      <div className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-surface)] p-4 shadow-[var(--p-shadow)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-accent-text)]">{card.title}</p>
          <span className="rounded-full border border-signal/40 px-2 py-0.5 font-mono text-[10px] text-signal">
            {String(card.flarePrimitive)}
          </span>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="rounded-xl bg-[var(--p-bg)] px-3 py-2">
            <p className="font-mono text-[10px] text-[var(--p-muted)]">P(risk-on)</p>
            <p className="font-display text-xl">{Number(card.probabilityRiskOn).toFixed(2)}</p>
          </div>
          <div className="rounded-xl bg-[var(--p-bg)] px-3 py-2">
            <p className="font-mono text-[10px] text-[var(--p-muted)]">Confidence</p>
            <p className="font-display text-xl">{Number(card.confidence).toFixed(2)}</p>
          </div>
          <div className="rounded-xl bg-[var(--p-bg)] px-3 py-2">
            <p className="font-mono text-[10px] text-[var(--p-muted)]">Risk</p>
            <p className="font-display text-xl">{String(card.risk)}</p>
          </div>
        </div>
        <p className="mt-3 text-sm text-[var(--p-fg)]">{String(card.recommendedAction)}</p>
        <p className="mt-2 text-xs text-amber-200/90">{String(card.honesty)}</p>
      </div>
    );
  }

  if (card.type === "swap_prepare") {
    const symbolIn = String(card.symbolIn ?? "USDT0");
    const symbolOut = String(card.symbolOut ?? "FXRP");
    const est = String(card.estimatedOut ?? card.estimatedFxrp);
    const isSafe = card.mode === "beacon_safe" || card.requiresMetaMask === false;
    const chainId = Number(card.chainId ?? (isSafe ? 114 : 14));
    if (!isSafe && (chainId === 14 || card.mode === "sparkdex_mainnet" || card.requiresChainSwitch)) {
      return (
        <div className="rounded-2xl border border-amber-500/30 bg-[var(--p-card)] p-4">
          <p className="font-mono text-[11px] uppercase tracking-widest text-amber-200">
            Mainnet path blocked
          </p>
          <p className="mt-2 text-sm text-[var(--p-fg)]">
            Beacon stays on <strong>Flare Testnet Coston2 (114)</strong>. We never ask MetaMask to
            switch to Mainnet for Flow swaps.
          </p>
          <p className="mt-2 text-xs text-[var(--p-muted)]">
            Fund Beacon Safe for USDT0→FXRP agent execution, or use another Coston2 rail.
          </p>
          <a
            href="/flow/security"
            className="mt-3 inline-flex rounded-full bg-signal px-4 py-2 text-sm font-medium text-ink"
          >
            Open Beacon Safe
          </a>
        </div>
      );
    }
    return (
      <div className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-accent-text)]">{card.title}</p>
          <span className="rounded-full border border-signal/40 px-2 py-0.5 font-mono text-[10px] text-signal">
            {String(card.flarePrimitive ?? (isSafe ? "Beacon Safe" : "SparkDEX"))}
          </span>
        </div>
        <p className="mt-2 text-sm text-[var(--p-fg)]/80">
          Swap <span className="text-[var(--p-fg)]">{String(card.amountInDisplay)} {symbolIn}</span>
          {" → "}
          <span className="text-[var(--p-accent-text)]">~{est} {symbolOut}</span>
          {" · "}
          {String(card.network ?? (isSafe ? "Flare Testnet Coston2" : "Flare Mainnet"))}
        </p>
        <p className="mt-1 text-xs text-[var(--p-muted)]">{String(card.warning)}</p>
        {card.honesty ? <p className="mt-1 text-xs text-amber-200/90">{String(card.honesty)}</p> : null}
        <FccHardwareStrip card={card} />
        {isSafe ? (
          <p className="mt-2 text-xs text-signal">
            Agent executor spends from Beacon Safe on Coston2 — no MetaMask, no Mainnet switch.
          </p>
        ) : card.requiresChainSwitch ? (
          <p className="mt-2 text-xs text-signal">MetaMask will switch to Flare Mainnet (chain 14) before signing.</p>
        ) : null}

        <div className="mt-4 space-y-2">
          {isSafe ? (
            <>
              <StatusRow label="Safe spend" status={approveStatus} hash={approveHash} chainId={chainId} />
              <StatusRow label="Desk fulfill" status={swapStatus} hash={swapHash} chainId={chainId} />
            </>
          ) : (
            <>
              <StatusRow label={`Approve ${symbolIn}`} status={approveStatus} hash={approveHash} chainId={chainId} />
              <StatusRow label="Swap" status={swapStatus} hash={swapHash} chainId={chainId} />
            </>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {!wallet && (
            <button type="button" onClick={onConnect} className="rounded-full bg-signal px-4 py-2 text-sm text-[var(--p-fg)]">
              Connect wallet
            </button>
          )}
          {wallet && swapStatus !== "confirmed" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    if (isSafe) {
                      setApproveStatus("pending");
                      const session = await ensureSafeAgentSession(wallet);
                      const result = await api.executeSafeSwap({
                        wallet,
                        amountInUnits: String(card.amountInDisplay),
                        recipient: wallet,
                        slippageBps: Number(card.slippageBps ?? 100),
                        sessionToken: session.token,
                      });
                      if (!("spendHash" in result) || !result.spendHash) {
                        throw new Error((result as { error?: string }).error || "Safe swap failed");
                      }
                      setApproveHash(result.spendHash);
                      setApproveStatus("confirmed");
                      setSwapHash(result.fulfillHash);
                      setSwapStatus("confirmed");
                      onBalancesRefresh();
                      onTxConfirmed?.({
                        kind: "swap",
                        title: `Beacon Safe ${symbolIn}→${symbolOut} · ${String(card.amountInDisplay ?? "")}`,
                        hash: result.fulfillHash,
                        explorerUrl: explorerTx(result.fulfillHash, chainId),
                        meta: { flarePrimitive: "Beacon Safe · Coston2", chainId },
                      });
                    } else {
                      const result = await executeSparkDexSwap({
                        approveTo: card.approveTo as Address,
                        approveData: card.approveData as Hex,
                        swapTo: card.swapTo as Address,
                        swapData: card.swapData as Hex,
                        chainId,
                        onStep: (s) => {
                          if (s.step === "approve") {
                            setApproveStatus(s.status);
                            if (s.hash) setApproveHash(s.hash);
                          }
                          if (s.step === "swap") {
                            setSwapStatus(s.status);
                            if (s.hash) setSwapHash(s.hash);
                          }
                        },
                      });
                      if (result.approveHash) setApproveHash(result.approveHash);
                      setSwapHash(result.swapHash);
                      setSwapStatus("confirmed");
                      onBalancesRefresh();
                      onTxConfirmed?.({
                        kind: "swap",
                        title: `SparkDEX ${symbolIn}→${symbolOut} · ${String(card.amountInDisplay ?? "")}`,
                        hash: result.swapHash,
                        explorerUrl: explorerTx(result.swapHash, chainId),
                        meta: { flarePrimitive: "SparkDEX · Flare Mainnet", chainId },
                      });
                    }
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Swap failed");
                    setSwapStatus((prev) => (prev === "pending" ? "failed" : prev));
                    setApproveStatus((prev) => (prev === "pending" ? "failed" : prev));
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
              className="rounded-full bg-signal px-4 py-2 text-sm font-medium text-ink disabled:opacity-50"
            >
              {busy
                ? isSafe
                  ? "Executing…"
                  : "Signing…"
                : isSafe
                  ? "Execute from Beacon Safe"
                  : card.requiresChainSwitch
                    ? "Switch + Approve + Swap"
                    : "Approve + Swap"}
            </button>
          )}
          <a
            href={NETWORK.faucet}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-[var(--p-border)] px-4 py-2 text-sm text-[var(--p-muted)]"
          >
            Coston2 faucet
          </a>
        </div>
        {error && (
          <div className="mt-2 space-y-2">
            <p className="text-xs text-[var(--p-danger)]">{error}</p>
            {/per-job app limit|daily app budget|app limits/i.test(error) ? (
              <Link
                to="/flow/security"
                className="inline-flex rounded-full border border-[var(--p-border-strong)] px-3 py-1.5 text-xs text-[var(--p-muted)] hover:border-[var(--p-accent)]/45 hover:text-[var(--p-fg)]"
              >
                Open Safe → App limits
              </Link>
            ) : null}
          </div>
        )}
        {swapStatus === "confirmed" && swapHash && (
          <p className="mt-3 text-sm text-[var(--p-accent-text)]">
            Swap confirmed.{" "}
            <a
              href={explorerTx(swapHash, chainId)}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              View on explorer
            </a>
          </p>
        )}
      </div>
    );
  }

  if (card.type === "bridge_quote") {
    const fee = formatNativeFeeDisplay(String(card.nativeFeeDisplay ?? ""));
    const amount = formatTokenAmount(String(card.amountDisplay ?? ""), "FXRP");
    return (
      <div className="overflow-hidden rounded-2xl border border-[var(--p-border)] bg-[var(--p-surface)]">
        <div className="border-b border-[var(--p-border)] bg-signal/10 px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--p-accent-text)]">Live quote · LayerZero</p>
          <p className="mt-1 font-display text-lg font-semibold tracking-tight">{String(card.title)}</p>
        </div>
        <div className="grid gap-0 sm:grid-cols-3">
          <div className="border-b border-[var(--p-border)] px-4 py-4 sm:border-b-0 sm:border-r">
            <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--p-muted)]">Amount</p>
            <p className="mt-1 font-display text-2xl font-semibold tabular-nums">{amount}</p>
          </div>
          <div className="border-b border-[var(--p-border)] px-4 py-4 sm:border-b-0 sm:border-r">
            <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--p-muted)]">Destination</p>
            <p className="mt-1 font-display text-2xl font-semibold">{String(card.destination)}</p>
            <p className="mt-0.5 font-mono text-[10px] text-[var(--p-muted)]">EID {String(card.dstEid)}</p>
          </div>
          <div className="px-4 py-4">
            <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--p-muted)]">Messaging fee</p>
            <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-[var(--p-accent-text)]">{fee}</p>
            <p className="mt-0.5 font-mono text-[10px] text-[var(--p-muted)]">quoteSend · Coston2</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--p-border)] px-4 py-3">
          <p className="text-xs text-[var(--p-muted)]">
            Balance {formatTokenAmount(String(card.fxrpBalance ?? ""), "FXRP")} · {String(card.network)}
          </p>
          <button
            type="button"
            onClick={() => onQuickReply("confirm")}
            className="rounded-full bg-signal px-5 py-2 text-sm font-medium text-ink transition active:scale-[0.98]"
          >
            Confirm bridge
          </button>
        </div>
      </div>
    );
  }

  if (card.type === "bridge_prepare") {
    const lzScanBase = String(card.layerZeroScanBase ?? "https://testnet.layerzeroscan.com/tx/");
    const fee = formatNativeFeeDisplay(String(card.nativeFeeDisplay ?? ""));
    const isAgent = card.mode === "beacon_agent" || card.requiresMetaMask === false;
    return (
      <div className="overflow-hidden rounded-2xl border border-[var(--p-border)] bg-[var(--p-surface)]">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--p-border)] px-4 py-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--p-accent-text)]">
              {isAgent ? "Beacon Agent · Coston2" : "Confirm in wallet"}
            </p>
            <p className="mt-1 font-display text-base font-semibold">
              {formatTokenAmount(String(card.amountDisplay ?? ""), "FXRP")}
              <span className="mx-2 text-[var(--p-muted)]">→</span>
              {String(card.destination)}
            </p>
          </div>
          <div className="rounded-xl border border-signal/30 bg-signal/10 px-3 py-2 text-right">
            <p className="font-mono text-[10px] text-[var(--p-muted)]">Fee</p>
            <p className="font-display text-lg font-semibold tabular-nums text-[var(--p-accent-text)]">{fee}</p>
          </div>
        </div>

        {isAgent ? (
          <p className="px-4 pt-3 text-xs text-signal">
            Agent executor signs OFT on Coston2 — no MetaMask.
            {card.fromSafe ? " Safe USDT0 tops up FXRP first." : ""}
          </p>
        ) : null}
        {card.honesty ? <p className="px-4 pt-2 text-xs text-amber-200/90">{String(card.honesty)}</p> : null}

        <div className="space-y-2 px-4 py-4">
          <StatusRow label="Approve FXRP" status={approveStatus} hash={approveHash} chainId={114} />
          <StatusRow label="OFT send" status={sendStatus} hash={sendHash} chainId={114} />
        </div>

        <div className="flex flex-wrap gap-2 border-t border-[var(--p-border)] px-4 py-3">
          {!wallet && (
            <button type="button" onClick={onConnect} className="rounded-full bg-signal px-4 py-2 text-sm font-medium text-ink">
              Connect wallet
            </button>
          )}
          {wallet && sendStatus !== "confirmed" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    if (isAgent) {
                      setApproveStatus("pending");
                      const session = await ensureSafeAgentSession(wallet);
                      const result = await api.executeAgentBridge({
                        wallet,
                        amountFxrpUnits: String(card.amountDisplay),
                        recipient: wallet,
                        destination: String(card.destination),
                        sessionToken: session.token,
                      });
                      if (!result.sendHash) throw new Error("Agent bridge failed");
                      if (result.approveHash) {
                        setApproveHash(result.approveHash);
                        setApproveStatus("confirmed");
                      } else {
                        setApproveStatus("skipped");
                      }
                      setSendHash(result.sendHash);
                      setSendStatus("confirmed");
                      onBalancesRefresh();
                      onTxConfirmed?.({
                        kind: "bridge",
                        title: `Agent OFT FXRP → ${String(card.destination ?? "peer")}`,
                        hash: result.sendHash,
                        explorerUrl: explorerTx(result.sendHash, 114),
                        meta: {
                          flarePrimitive: "Beacon Agent · LayerZero OFT",
                          layerZeroScan: result.layerZeroScanUrl ?? `${lzScanBase}${result.sendHash}`,
                          destination: card.destination,
                        },
                      });
                    } else {
                      const result = await executeOftBridge({
                        approveTo: card.approveTo as Address,
                        approveData: card.approveData as Hex,
                        sendTo: card.sendTo as Address,
                        sendData: card.sendData as Hex,
                        nativeFee: BigInt(String(card.nativeFee)),
                        onStep: (s) => {
                          if (s.step === "approve") {
                            setApproveStatus(s.status);
                            if (s.hash) setApproveHash(s.hash);
                          }
                          if (s.step === "send") {
                            setSendStatus(s.status);
                            if (s.hash) setSendHash(s.hash);
                          }
                        },
                      });
                      if (result.approveHash) setApproveHash(result.approveHash);
                      setSendHash(result.sendHash);
                      setSendStatus("confirmed");
                      onBalancesRefresh();
                      onTxConfirmed?.({
                        kind: "bridge",
                        title: `FXRP OFT → ${String(card.destination ?? "peer")}`,
                        hash: result.sendHash,
                        explorerUrl: explorerTx(result.sendHash, 114),
                        meta: {
                          flarePrimitive: "LayerZero OFT · FAssets FXRP",
                          layerZeroScan: `${lzScanBase}${result.sendHash}`,
                          destination: card.destination,
                        },
                      });
                    }
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Bridge send failed");
                    setSendStatus((prev) => (prev === "pending" ? "failed" : prev));
                    setApproveStatus((prev) => (prev === "pending" ? "failed" : prev));
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
              className="rounded-full bg-signal px-4 py-2 text-sm font-medium text-ink disabled:opacity-50"
            >
              {busy
                ? isAgent
                  ? "Executing…"
                  : "Confirm in wallet…"
                : isAgent
                  ? "Execute with Beacon Agent"
                  : "Approve + Send"}
            </button>
          )}
        </div>
        {error && <p className="px-4 pb-3 text-xs text-[var(--p-danger)]">{error}</p>}
        {sendStatus === "confirmed" && sendHash && (
          <div className="space-y-2 border-t border-[var(--p-border)] bg-signal/5 px-4 py-3 text-sm">
            <p className="font-medium text-[var(--p-accent-text)]">Source tx confirmed on Coston2</p>
            {oftDelivery?.uiPhases && (
              <div className="flex flex-wrap gap-2">
                {oftDelivery.uiPhases.map((p) => (
                  <span
                    key={p.id}
                    className={cn(
                      "rounded-full px-2 py-0.5 font-mono text-[10px]",
                      p.status === "done"
                        ? "bg-signal/20 text-[var(--p-accent-text)]"
                        : p.status === "active"
                          ? "bg-signal/10 text-[var(--p-accent-text)]"
                          : p.status === "failed"
                            ? "bg-[var(--p-danger)]/15 text-[var(--p-danger)]"
                            : "bg-[var(--p-bg)] text-[var(--p-muted)]",
                    )}
                  >
                    {p.label} · {p.status}
                  </span>
                ))}
              </div>
            )}
            {oftDelivery?.guid && (
              <p className="font-mono text-[10px] text-[var(--p-muted)]">GUID {oftDelivery.guid.slice(0, 18)}…</p>
            )}
            <div className="flex flex-wrap gap-2">
              <a
                href={explorerTx(sendHash, 114)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-[var(--p-border)] px-3 py-1 text-xs hover:border-signal/40"
              >
                Coston2 explorer <ExternalLink className="size-3" />
              </a>
              <a
                href={oftDelivery?.layerZeroScanUrl ?? `${lzScanBase}${sendHash}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-signal/40 bg-signal/10 px-3 py-1 text-xs text-[var(--p-accent-text)]"
              >
                LayerZero Scan <ExternalLink className="size-3" />
              </a>
              {oftDelivery?.destTxHash && oftDelivery.destExplorerUrl && (
                <a
                  href={oftDelivery.destExplorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-signal/40 bg-signal/10 px-3 py-1 text-xs text-[var(--p-accent-text)]"
                >
                  Dest receipt <ExternalLink className="size-3" />
                </a>
              )}
            </div>
            <p className="text-xs text-[var(--p-muted)]">
              {oftDelivery?.note ??
                "Source → protocol observe → dest receipt. Beacon never invents fills."}
            </p>
          </div>
        )}
      </div>
    );
  }

  if (card.type === "bridge_clarify" || card.type === "media_clarify") {
    const prompts = (card.prompts as string[]) ?? [];
    const isVideo = false;
    const isImage = card.kind === "image" || card.type === "media_clarify";
    return (
      <div className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] p-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-muted)]">{card.title}</p>
        <ul className="mt-3 space-y-1.5 text-sm text-[var(--p-muted)]">
          {prompts.map((p) => (
            <li key={p} className="flex gap-2">
              <span className="text-[var(--p-accent-text)]">·</span>
              {p}
            </li>
          ))}
        </ul>
        {isVideo && (
          <div className="mt-3 flex flex-wrap gap-2">
            {["15", "30", "60"].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => onQuickReply(`${d} sec, 9:16, cinematic`)}
                className="rounded-full border border-[var(--p-border)] px-3 py-1.5 text-xs text-[var(--p-muted)] hover:border-signal/40"
              >
                {d}s
              </button>
            ))}
          </div>
        )}
        {isImage && !isVideo && (
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              { label: "Minimal green", text: "Company Beacon, colors green + black, minimal geometric, transparent yes" },
              { label: "Bold mark", text: "Bold logo mark, high contrast, no serif, transparent background" },
              { label: "Skip to quote", text: "Name Beacon OS, colors signal green, style minimal, transparent yes" },
            ].map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={() => onQuickReply(c.text)}
                className="rounded-full border border-[var(--p-border)] px-3 py-1.5 text-xs text-[var(--p-muted)] hover:border-signal/40"
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
        {typeof card.deskHref === "string" && card.deskHref ? (
          <Link to={card.deskHref} className="mt-3 inline-flex text-sm text-[var(--p-accent-text)] underline-offset-2 hover:underline">
            Open Agent Jobs
          </Link>
        ) : null}
      </div>
    );
  }

  if (card.type === "bridge_routes") {
    const routes =
      (card.routes as Array<{
        chain: string;
        eid: number;
        asset: string;
        status: string;
        live?: boolean;
        eta: string;
        fees: string;
      }>) ?? [];
    const docs = (card.docs as Array<{ label: string; href: string }>) ?? [];
    const unavailable = (card.unavailable as string[]) ?? [];
    const routesSource = typeof card.routesSource === "string" ? card.routesSource : "";
    const isFallback = routesSource === "fallback";
    return (
      <div className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-surface)] shadow-[var(--p-shadow)] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-accent-text)]">{card.title}</p>
          <span className="rounded-full bg-signal/15 px-2 py-0.5 font-mono text-[10px] text-[var(--p-accent-text)]">
            LayerZero OFT · FAssets
          </span>
          {isFallback && (
            <span className="rounded-full bg-[var(--p-warn)]/20 px-2 py-0.5 font-mono text-[10px] text-[var(--p-warn)]">
              Fallback snapshot - not live
            </span>
          )}
        </div>
        <p className="mt-2 text-xs text-[var(--p-muted)]">Source · {String(card.source)}</p>
        <div className="mt-3 space-y-2">
          {routes.map((r) => {
            const live = r.live === true && r.status === "live";
            return (
              <div key={r.eid} className="rounded-xl bg-[var(--p-bg)] px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-[var(--p-fg)]">{r.chain}</span>
                  <span
                    className={`font-mono text-[10px] ${live ? "text-[var(--p-accent-text)]" : "text-[var(--p-warn)]"}`}
                  >
                    {live ? "live peer" : r.status || "fallback-snapshot"}
                  </span>
                </div>
                <p className="mt-1 font-mono text-[11px] text-[var(--p-muted)]">
                  {r.asset} · EID {r.eid} · ETA {r.eta}
                </p>
                <p className="text-[11px] text-[var(--p-muted)]">{r.fees}</p>
                {live ? (
                  <button
                    type="button"
                    onClick={() => onQuickReply(`bridge FXRP to ${r.chain}`)}
                    className="mt-2 rounded-full border border-[var(--p-border)] px-3 py-1 text-[11px] text-[var(--p-muted)] hover:border-signal/40"
                  >
                    Plan this route
                  </button>
                ) : (
                  <p className="mt-2 font-mono text-[10px] text-[var(--p-warn)]">
                    Snapshot only - re-sync peers before planning
                  </p>
                )}
              </div>
            );
          })}
        </div>
        {unavailable.length > 0 && (
          <p className="mt-3 text-xs text-[var(--p-warn)]">Unavailable: {unavailable.join(" · ")}</p>
        )}
        <p className="mt-2 text-xs text-[var(--p-muted)]">{String(card.honesty)}</p>
        {routesSource && (
          <p className="mt-1 font-mono text-[10px] text-[var(--p-accent-text)]">
            Peers · {routesSource}
            {typeof card.discoveredAt === "number"
              ? ` · synced ${new Date(card.discoveredAt).toLocaleTimeString()}`
              : ""}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {docs.map((l) => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-[var(--p-border)] px-3 py-1.5 text-xs text-[var(--p-muted)] hover:border-signal/40"
            >
              {l.label}
            </a>
          ))}
        </div>
      </div>
    );
  }

  if (card.type === "bridge_intent") {
    const links = (card.links as Array<{ label: string; href: string }>) ?? [];
    return (
      <div className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] p-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-accent-text)]">{card.title}</p>
        <p className="mt-2 text-sm text-[var(--p-fg)]/90">{String(card.summary)}</p>
        <p className="mt-2 text-xs text-[var(--p-warn)]">{String(card.honesty)}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-[var(--p-border)] px-3 py-1.5 text-xs text-[var(--p-muted)] hover:border-signal/40"
            >
              {l.label}
            </a>
          ))}
        </div>
      </div>
    );
  }

  if (card.type === "authorization_receipt") {
    const allowed = card.allowed === true;
    return (
      <div
        className={cn(
          "overflow-hidden rounded-2xl border px-4 py-4",
          allowed
            ? "border-signal/40 bg-signal/10"
            : "border-[var(--p-danger)]/40 bg-[var(--p-danger)]/5",
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--p-muted)]">
            {String(card.title ?? "Authorization Receipt")}
          </p>
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 font-mono text-[10px]",
              allowed
                ? "bg-signal/20 text-[var(--p-accent-text)]"
                : "bg-[var(--p-danger)]/15 text-[var(--p-danger)]",
            )}
          >
            {allowed ? "ALLOWED" : "BLOCKED"}
          </span>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-[var(--p-fg)]">
          {String(card.reason ?? "Policy decision")}
        </p>
        <FccHardwareStrip card={card} />
        <dl className="mt-3 space-y-1 font-mono text-[11px] text-[var(--p-muted)]">
          {card.serviceId != null && (
            <div>
              Service · {String(card.serviceId)}
              {card.priceUsdt0 != null ? ` · $${String(card.priceUsdt0)}` : ""}
            </div>
          )}
          <div>{String(card.flarePrimitive ?? "Security Policy · server-enforced")}</div>
          {card.fccMode === "simulated" && (
            <div className="mt-2 inline-flex rounded-full border border-signal/35 bg-signal/10 px-2.5 py-0.5 font-mono text-[10px] text-[var(--p-accent-text)]">
              Confidential policy (simulated TEE)
            </div>
          )}
          {card.fccMode === "verified" && (
            <div className="mt-2 inline-flex rounded-full border border-signal/35 bg-signal/10 px-2.5 py-0.5 font-mono text-[10px] text-[var(--p-accent-text)]">
              Confidential policy (hardware TEE)
            </div>
          )}
          <div className="mt-1">Server policy · Coston2 · pause anytime in Safe</div>
        </dl>
        {!allowed && (
          <a
            href="/flow/security"
            className="mt-3 inline-flex rounded-full border border-[var(--p-border)] px-3 py-1.5 text-xs text-[var(--p-muted)] hover:border-signal/40"
          >
            Adjust spend policy
          </a>
        )}
      </div>
    );
  }

  if (card.type === "x402_quote") {
    const serviceId = typeof card.serviceId === "string" ? card.serviceId : "";
    const isSettled = serviceId ? settledServiceIds.has(serviceId) : false;
    return (
      <div className="overflow-hidden rounded-2xl border border-[var(--p-border)] bg-[var(--p-surface)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--p-border)] px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--p-muted)]">{card.title}</p>
            <span className="rounded-full bg-signal/15 px-2 py-0.5 font-mono text-[10px] text-[var(--p-accent-text)]">
              {String(card.flarePrimitive ?? "x402")}
            </span>
          </div>
          {isSettled ? (
            <span className="rounded-full bg-signal/20 px-2.5 py-0.5 font-mono text-[10px] text-[var(--p-accent-text)]">
              Last run settled
            </span>
          ) : (
            <span className="rounded-full border border-[var(--p-border)] px-2.5 py-0.5 font-mono text-[10px] text-[var(--p-muted)]">
              Unpaid
            </span>
          )}
        </div>
        <div className="px-4 py-4">
        <p className="font-display text-3xl font-semibold tabular-nums text-[var(--p-fg)]">${String(card.priceUsdt0)}</p>
        <dl className="mt-3 space-y-1.5 text-sm text-[var(--p-muted)]">
          <div>
            <span className="text-[var(--p-muted)]">Provider · </span>
            {String(card.provider ?? "Beacon")}
          </div>
          <div>
            <span className="text-[var(--p-muted)]">Why · </span>
            {String(card.reason ?? "Paid resource")}
          </div>
          <div>
            <span className="text-[var(--p-muted)]">ETA · </span>~{String(card.etaSeconds ?? 30)}s
          </div>
          <div className="font-mono text-[11px] text-[var(--p-muted)]">
            USDT0 · ERC-20 pull · chain {String(card.chainId)} · {String(card.resource)}
          </div>
        </dl>
        {isSettled && (
          <p className="mt-3 text-xs leading-relaxed text-[var(--p-muted)]">
            Settled means the last payment delivered. Pay again anytime. Each run approves a fresh
            USDT0 amount and unlocks a new resource (not a one-time lock).
          </p>
        )}
        </div>
        <div className="flex flex-wrap gap-2 border-t border-[var(--p-border)] px-4 py-3">
          <button type="button" onClick={onMint} className="rounded-full border border-[var(--p-border)] px-4 py-2 text-sm text-[var(--p-muted)] hover:border-signal/40">
            Get Coston2 USDT0
          </button>
          <button
            type="button"
            disabled={!wallet || busy}
            onClick={() => {
              void (async () => {
                if (!wallet) return onConnect();
                setBusy(true);
                setError(null);
                try {
                  const { signX402Payment } = await import("@/lib/x402Pay");
                  const payment = await signX402Payment({
                    amountUsdt0: String(card.priceUsdt0),
                    payTo: String(card.payTo),
                    token: String(card.token),
                  });
                  onPaidResend(payment, {
                    agentId: (card.agentId as AgentId | undefined) ?? undefined,
                    serviceId: serviceId || undefined,
                    resource: typeof card.resource === "string" ? card.resource : undefined,
                    brief:
                      (typeof card.brief === "string" && card.brief) ||
                      convState?.creativeBrief ||
                      undefined,
                  });
                } catch (e) {
                  setError(e instanceof Error ? e.message : "pay failed");
                } finally {
                  setBusy(false);
                }
              })();
            }}
            className="rounded-full bg-signal px-5 py-2 text-sm font-medium text-ink disabled:opacity-40"
          >
            {busy ? "Approving…" : isSettled ? "Pay again" : "Pay & run"}
          </button>
        </div>
        {error && <p className="px-4 pb-3 text-xs text-[var(--p-danger)]">{error}</p>}
      </div>
    );
  }

  if (card.type === "media_result") {
    const summary = typeof card.summary === "string" ? card.summary : "";
    const content = typeof card.content === "string" ? card.content : "";
    const isImage = content.startsWith("data:image");
    const isResearch = card.kind === "research";
    // Avoid triple-paste: chat line + summary + content when they are the same stub.
    const showSummary =
      Boolean(summary) &&
      (!content || summary.trim() !== content.trim()) &&
      !/paid research brief unlocked/i.test(summary);

    return (
      <div className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-surface)] p-4 shadow-[var(--p-shadow)]">
        <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-accent-text)]">{card.title}</p>
        {showSummary && <p className="mt-2 text-sm text-[var(--p-muted)]">{summary}</p>}
        {typeof card.paymentTxHint === "string" && card.paymentTxHint && (
          <a
            href={explorerTx(card.paymentTxHint, 114)}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 font-mono text-[11px] text-[var(--p-accent-text)] hover:underline"
          >
            Settlement tx · {card.paymentTxHint.slice(0, 10)}…
            <ExternalLink className="size-3" />
          </a>
        )}
        {isImage && (
          <img src={content} alt="Beacon result" className="mt-3 max-h-72 rounded-xl border border-[var(--p-border)]" />
        )}
        {isResearch && content && (
          <div className="mt-3 border-t border-[var(--p-border)] pt-3">
            <AgentText text={content} />
          </div>
        )}
      </div>
    );
  }

  if (card.type === "desk_link") {
    const cta = String(card.href).includes("/security") ? "Open Safe" : "Open desk";
    return (
      <div className="rounded-2xl border border-[var(--p-border)] p-4">
        <p className="font-medium text-[var(--p-fg)]">{card.title}</p>
        <p className="mt-1 text-sm text-[var(--p-muted)]">{String(card.summary)}</p>
        <Link to={String(card.href)} className="mt-3 inline-flex rounded-full bg-signal px-4 py-2 text-sm font-medium text-ink">
          {cta}
        </Link>
      </div>
    );
  }

  if (card.type === "insufficient") {
    const summary = String(card.summary);
    const inventoryIssue = /inventory|seed the desk/i.test(summary);
    const href = typeof card.faucetHref === "string" ? card.faucetHref : "";
    const internalHref = href.startsWith("/");
    return (
      <div className="rounded-2xl border border-[var(--p-warn)]/35 bg-[var(--p-warn)]/10 p-4">
        <p className="font-medium text-[var(--p-fg)]">{card.title}</p>
        <p className="mt-1 text-sm text-[var(--p-muted)]">{summary}</p>
        {inventoryIssue ? (
          <p className="mt-2 text-xs text-[var(--p-muted)]">
            The wallet and Safe are connected. Desk FXRP liquidity—not your connection—is blocking
            this quote.
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {!wallet ? (
            <button type="button" onClick={onConnect} className="rounded-full bg-signal px-4 py-2 text-sm text-[var(--p-fg)]">
              Connect wallet
            </button>
          ) : inventoryIssue ? (
            <button
              type="button"
              onClick={() => onQuickReply("retry the same swap quote")}
              className="rounded-full bg-signal px-4 py-2 text-sm font-medium text-ink active:scale-[0.98]"
            >
              Retry quote
            </button>
          ) : internalHref ? (
            <Link
              to={href}
              className="rounded-full bg-signal px-4 py-2 text-sm font-medium text-ink"
            >
              Open Beacon Safe
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => onQuickReply("retry my last request with my connected wallet")}
              className="rounded-full bg-signal px-4 py-2 text-sm font-medium text-ink active:scale-[0.98]"
            >
              Retry with wallet
            </button>
          )}
          {href && !internalHref && !inventoryIssue ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-[var(--p-border-strong)] px-4 py-2 text-sm text-[var(--p-muted)]"
            >
              Faucet
            </a>
          ) : null}
        </div>
      </div>
    );
  }

  return null;
}

function StatusRow({
  label,
  status,
  hash,
  chainId = 114,
}: {
  label: string;
  status: string;
  hash: string | null;
  chainId?: number;
}) {
  const icon =
    status === "confirmed" || status === "skipped" ? (
      <CheckCircle2 className="size-3.5 text-[var(--p-accent-text)]" />
    ) : status === "pending" ? (
      <Clock className="size-3.5 animate-pulse text-[var(--p-warn)]" />
    ) : status === "failed" ? (
      <span className="size-3.5 rounded-full bg-red-400" />
    ) : (
      <span className="size-3.5 rounded-full border border-[var(--p-border)]" />
    );
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--p-surface-2)] px-3 py-2 text-xs">
      <span className="flex items-center gap-2 text-[var(--p-muted)]">
        {icon}
        {label}
        <span className="font-mono text-[var(--p-muted)]">{status === "idle" ? "ready" : status}</span>
      </span>
      {hash && (
        <a href={explorerTx(hash, chainId)} target="_blank" rel="noreferrer" className="font-mono text-[var(--p-accent-text)] hover:underline">
          {hash.slice(0, 10)}…
        </a>
      )}
    </div>
  );
}
