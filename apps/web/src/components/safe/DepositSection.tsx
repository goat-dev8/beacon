import { ArrowDownToLine, Loader2, Wallet } from "lucide-react";
import { OwnerGate, SafeField, SafeSection } from "./safePrimitives";

export function DepositSection({
  amount,
  onAmountChange,
  onDeposit,
  onWithdraw,
  pending,
  wallet,
  isOwner,
  onConnect,
  connecting,
  txNote,
  tokenSymbol = "USDT0",
}: {
  amount: string;
  onAmountChange: (v: string) => void;
  onDeposit: () => void;
  onWithdraw: () => void;
  pending: boolean;
  wallet: string | null;
  isOwner: boolean;
  onConnect: () => void;
  connecting: boolean;
  txNote: string | null;
  tokenSymbol?: string;
}) {
  return (
    <SafeSection>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--p-accent-text)]">
            Deposit
          </p>
          <h2 className="mt-1 font-display text-xl font-semibold tracking-tight">
            Fund the Safe
          </h2>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-[var(--p-muted)]">
            Move {tokenSymbol} from your wallet into Beacon Safe. The AI spends only from this pool,
            never from your full balance.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <div className="rounded-[var(--p-radius-sm)] border border-[var(--p-border)] bg-[var(--p-surface-2)] px-4 py-3">
          <div className="flex items-center gap-2 text-[var(--p-muted)]">
            <Wallet className="size-4" />
            <span className="font-mono text-[10px] uppercase tracking-wider">Your wallet</span>
          </div>
          <p className="mt-2 text-sm text-[var(--p-fg)]">Connected balance stays yours</p>
        </div>
        <div className="flex justify-center">
          <span className="inline-flex size-9 items-center justify-center rounded-full bg-[var(--p-accent-soft)] text-[var(--p-accent-text)]">
            <ArrowDownToLine className="size-4" />
          </span>
        </div>
        <div className="rounded-[var(--p-radius-sm)] border border-[var(--p-accent)]/35 bg-[var(--p-accent-soft)] px-4 py-3">
          <div className="flex items-center gap-2 text-[var(--p-accent-text)]">
            <ArrowDownToLine className="size-4" />
            <span className="font-mono text-[10px] uppercase tracking-wider">Beacon Safe</span>
          </div>
          <p className="mt-2 text-sm text-[var(--p-fg)]">Prepaid AI spend envelope</p>
        </div>
      </div>

      <OwnerGate
        wallet={wallet}
        isOwner={isOwner}
        onConnect={onConnect}
        connecting={connecting}
      />

      <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <SafeField
          label={`Amount (${tokenSymbol})`}
          value={amount}
          onChange={(v) => onAmountChange(String(v))}
          string
          disabled={!isOwner}
          hint="Approve + deposit in one wallet flow"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!isOwner || pending}
            onClick={onDeposit}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--p-accent)] px-5 py-2.5 text-sm font-medium text-[var(--p-on-accent)] transition-transform active:scale-[0.98] disabled:opacity-40"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Deposit
          </button>
          <button
            type="button"
            disabled={!isOwner || pending}
            onClick={onWithdraw}
            className="rounded-full border border-[var(--p-border-strong)] px-5 py-2.5 text-sm disabled:opacity-40"
          >
            Withdraw
          </button>
        </div>
      </div>
      {txNote && <p className="mt-3 text-sm text-[var(--p-accent-text)]">{txNote}</p>}
    </SafeSection>
  );
}
