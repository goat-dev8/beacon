import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { api } from "@/lib/api";
import { shortAddress } from "@/lib/wallet";
import { cn } from "@/lib/utils";

/** Live Safe + Flare rails context for Bound Work (honest: escrow ≠ Safe spend). */
export function DeskContextStrip({
  escrowLockedDisplay,
  lockTx,
}: {
  escrowLockedDisplay?: string | null;
  lockTx?: string | null;
}) {
  const vaultQuery = useQuery({
    queryKey: ["agent-vault-status"],
    queryFn: () => api.getVaultStatus(),
    refetchInterval: 12_000,
  });

  const live = vaultQuery.data?.status?.configured ? vaultQuery.data.status : null;
  const loading = vaultQuery.isLoading;

  return (
    <section
      className={cn(
        "mb-8 overflow-hidden rounded-2xl border border-line bg-surface",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
      )}
      aria-label="Beacon Safe and Flare rails"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-signal-deep">
            Flare Coston2 · Bound Work
          </p>
          <p className="mt-0.5 text-sm text-ink-muted">
            Escrow locks the job. Beacon Safe is the prepaid agent pool (separate rail).
          </p>
        </div>
        <Link
          to="/flow/security"
          className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[11px] text-ink-muted transition-colors hover:border-signal/40 hover:text-signal-deep"
        >
          Open Safe
        </Link>
      </div>

      <div className="grid gap-0 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Safe balance"
          value={
            loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : live ? (
              `${live.balanceDisplay} ${live.tokenSymbol}`
            ) : (
              "Not configured"
            )
          }
        />
        <Metric
          label="Remaining window"
          value={
            live
              ? `${live.windowRemainingDisplay ?? "—"} / ${live.rollingWindowBudgetDisplay}`
              : "—"
          }
          hint={live ? `Spent ${live.windowSpentDisplay}` : undefined}
        />
        <Metric
          label="Per trade · Session"
          value={
            live
              ? `${live.maxSpendPerTxDisplay} · ${live.sessionActive ? "Active" : "Blocked"}`
              : "—"
          }
          hint={
            live
              ? live.paused
                ? "PAUSED"
                : `Executor ${shortAddress(live.executor)}`
              : undefined
          }
          danger={live?.paused}
        />
        <Metric
          label="Job escrow"
          value={escrowLockedDisplay ? `${escrowLockedDisplay} locked` : lockTx ? "Locked" : "Not locked"}
          hint={lockTx ? `${lockTx.slice(0, 10)}…` : "EIP-3009 → BeaconEscrow"}
        />
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 font-mono text-[10px] text-ink-faint sm:px-5">
        <li>x402 / EIP-3009 auth</li>
        <li>BeaconEscrow</li>
        <li>Beacon Safe (policy)</li>
        <li>FTSO (Safe swaps)</li>
        <li className="text-ink-muted/70">FDC · LayerZero · FAssets: Flow only</li>
      </ul>
    </section>
  );
}

function Metric({
  label,
  value,
  hint,
  danger,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  danger?: boolean;
}) {
  return (
    <div className="border-b border-line px-4 py-3 sm:border-r sm:px-5 lg:border-b-0">
      <p className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">{label}</p>
      <p
        className={cn(
          "mt-1 font-display text-base font-semibold tracking-tight",
          danger ? "text-danger" : "text-ink",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 font-mono text-[10px] text-ink-faint">{hint}</p>}
    </div>
  );
}
