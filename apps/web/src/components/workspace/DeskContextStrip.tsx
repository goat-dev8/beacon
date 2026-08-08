import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { api } from "@/lib/api";
import { shortAddress } from "@/lib/wallet";
import { useProductWallet } from "@/lib/productWallet";
import { cn } from "@/lib/utils";

/** Live Safe + Flare rails context for Agent Jobs (Safe prepaid or EIP-3009 wallet). */
export function DeskContextStrip({
  escrowLockedDisplay,
  lockTx,
}: {
  escrowLockedDisplay?: string | null;
  lockTx?: string | null;
}) {
  const { wallet } = useProductWallet();
  const vaultQuery = useQuery({
    queryKey: ["agent-vault-status", wallet ?? "none"],
    queryFn: () => api.getVaultStatus({ wallet: wallet ?? undefined }),
    enabled: Boolean(wallet),
    refetchInterval: 12_000,
  });

  const status = vaultQuery.data?.status;
  const live = status?.configured ? status : null;
  const loading = vaultQuery.isLoading;
  const needsCreate = Boolean(wallet && status && !status.configured);

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
            Flare Coston2 · Agent Jobs
          </p>
          <p className="mt-0.5 text-sm text-ink-muted">
            Prefer your personal Beacon Safe for job locks. Wallet EIP-3009 remains as fallback.
          </p>
        </div>
        <Link
          to="/flow/security"
          className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-ink hover:border-signal"
        >
          {needsCreate ? "Create Safe" : "Open Safe"}
        </Link>
      </div>

      <div className="grid gap-3 px-4 py-4 sm:grid-cols-3 sm:px-5">
        <Metric
          label="Your Safe"
          value={
            loading ? (
              <Loader2 className="size-4 animate-spin text-ink-muted" />
            ) : live ? (
              `${live.balanceDisplay} ${live.tokenSymbol}`
            ) : needsCreate ? (
              "Not created"
            ) : (
              "—"
            )
          }
          hint={live ? shortAddress(live.address) : wallet ? "Create on Safe page" : "Connect wallet"}
        />
        <Metric
          label="Policy window"
          value={
            live
              ? `${live.windowSpentDisplay} / ${live.rollingWindowBudgetDisplay}`
              : "—"
          }
          hint={live?.paused ? "Paused" : live ? "Active" : undefined}
        />
        <Metric
          label="Job lock"
          value={escrowLockedDisplay ? `${escrowLockedDisplay}` : "Ready"}
          hint={lockTx ? `${lockTx.slice(0, 10)}…` : "Safe prepaid or EIP-3009"}
        />
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-line/80 bg-paper/40 px-3 py-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">{label}</p>
      <div className="mt-1 text-sm font-medium text-ink">{value}</div>
      {hint ? <p className="mt-1 font-mono text-[10px] text-ink-muted">{hint}</p> : null}
    </div>
  );
}
