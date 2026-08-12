import { ArrowDownToLine, Loader2, Wallet } from "lucide-react";
import { SafeField, SafeSection } from "./safePrimitives";

export function DepositSection({
  amount,
  onAmountChange,
  onDeposit,
  onWithdraw,
  onMint,
  pending,
  busy,
  minting,
  wallet,
  isOwner,
  onConnect,
  connecting,
  txNote,
  tokenSymbol = "USDT0",
  walletBalance,
}: {
  amount: string;
  onAmountChange: (v: string) => void;
  onDeposit: () => void;
  onWithdraw: () => void;
  onMint?: () => void;
  pending: boolean;
  /** True only while deposit/withdraw is the in-flight vault action. */
  busy?: boolean;
  minting?: boolean;
  wallet: string | null;
  isOwner: boolean;
  onConnect: () => void;
  connecting: boolean;
  txNote: string | null;
  tokenSymbol?: string;
  walletBalance?: string | null;
}) {
  const amountOk = Number(amount) > 0;
  const canDeposit = Boolean(wallet) && !pending && amountOk;

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
            Sign once in MetaMask to approve Coston2 USDT0, then Beacon Safe pulls it with
            deposit(). Get testnet USDT0 from the official faucet (C2FLR + USDT0 + FXRP) — this
            is real USDT0 on Coston2, not mainnet USD₮0.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <div className="rounded-[var(--p-radius-sm)] border border-[var(--p-border)] bg-[var(--p-surface-2)] px-4 py-3">
          <div className="flex items-center gap-2 text-[var(--p-muted)]">
            <Wallet className="size-4" />
            <span className="font-mono text-[10px] uppercase tracking-wider">Your wallet</span>
          </div>
          <p className="mt-2 text-sm text-[var(--p-fg)]">
            {walletBalance != null ? `${walletBalance} ${tokenSymbol}` : "Connected balance stays yours"}
          </p>
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

      {!wallet ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-[var(--p-radius-sm)] border border-dashed border-[var(--p-border-strong)] bg-[var(--p-surface-2)] px-4 py-3">
          <p className="flex-1 text-sm text-[var(--p-muted)]">
            Connect MetaMask to fund Beacon Safe with {tokenSymbol}.
          </p>
          <button
            type="button"
            onClick={onConnect}
            disabled={connecting}
            className="rounded-full bg-[var(--p-accent)] px-4 py-2 text-sm font-medium text-[var(--p-on-accent)] disabled:opacity-50"
          >
            {connecting ? "Connecting…" : "Connect wallet"}
          </button>
        </div>
      ) : !isOwner ? (
        <p className="mt-4 rounded-[var(--p-radius-sm)] border border-[var(--p-accent)]/30 bg-[var(--p-accent-soft)] px-4 py-3 text-sm text-[var(--p-fg)]">
          You can deposit from this wallet. Withdraw and policy stay with the Safe owner.
        </p>
      ) : null}

      <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <SafeField
          label={`Amount (${tokenSymbol})`}
          value={amount}
          onChange={(v) => onAmountChange(String(v))}
          string
          disabled={!wallet || pending}
          hint="Approve USDT0, then deposit into the Safe"
        />
        <div className="flex flex-wrap gap-2">
          {onMint && (
            <button
              type="button"
              disabled={!wallet || minting || pending}
              onClick={onMint}
              className="rounded-full border border-[var(--p-border-strong)] px-4 py-2.5 text-sm disabled:opacity-40"
            >
              {minting ? "Opening faucet…" : `Get Coston2 ${tokenSymbol}`}
            </button>
          )}
          <button
            type="button"
            disabled={!canDeposit}
            onClick={onDeposit}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--p-accent)] px-5 py-2.5 text-sm font-medium text-[var(--p-on-accent)] transition-transform active:scale-[0.98] disabled:opacity-40"
          >
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Signing…
              </>
            ) : (
              "Deposit"
            )}
          </button>
          <button
            type="button"
            disabled={!isOwner || pending}
            onClick={onWithdraw}
            title={isOwner ? "Withdraw to owner" : "Owner only"}
            className="rounded-full border border-[var(--p-border-strong)] px-5 py-2.5 text-sm disabled:opacity-40"
          >
            Withdraw
          </button>
        </div>
      </div>
      {txNote && (
        <p
          className={`mt-3 text-sm ${
            /fail|revert|error|not enough|reject|denied|cancel/i.test(txNote)
              ? "text-[var(--p-danger)]"
              : "text-[var(--p-accent-text)]"
          }`}
        >
          {txNote}
        </p>
      )}
    </SafeSection>
  );
}
