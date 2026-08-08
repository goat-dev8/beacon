import { ExternalLink, Loader2 } from "lucide-react";
import type { AgentVaultStatus } from "@/lib/api";
import { shortAddress } from "@/lib/wallet";
import { cn } from "@/lib/utils";

function formatWindowHours(seconds: string): string {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return "n/a";
  const hours = n / 3600;
  if (hours >= 24 && hours % 24 === 0) return `${hours / 24}d rolling`;
  if (Number.isInteger(hours)) return `${hours}h rolling`;
  return `${hours.toFixed(1)}h rolling`;
}

export function VaultPassCard({
  status,
  loading,
  sessionLabel,
}: {
  status: AgentVaultStatus | undefined;
  loading: boolean;
  sessionLabel: string | null;
}) {
  const live = status?.configured ? status : null;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-[var(--p-border)] p-5 sm:p-6",
        "bg-[linear-gradient(145deg,var(--p-surface)_0%,var(--p-surface-2)_55%,color-mix(in_oklab,var(--p-accent)_12%,var(--p-surface))_100%)]",
        "shadow-[var(--p-shadow)]",
      )}
    >
      <div
        className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full opacity-40"
        style={{
          background:
            "radial-gradient(circle, color-mix(in oklab, var(--p-accent) 35%, transparent), transparent 70%)",
        }}
      />

      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--p-accent-text)]">
            Beacon Safe pass
          </p>
          <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight text-[var(--p-fg)]">
            {live
              ? "Your prepaid AI budget"
              : status && !status.configured && status.code === "SAFE_NOT_CREATED"
                ? "Safe not created yet"
                : "Create your Beacon Safe"}
          </h2>
        </div>
        {live && (
          <a
            href={live.explorer}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-full border border-[var(--p-border)] bg-[var(--p-card)]/80 px-3 py-1.5 font-mono text-[11px] text-[var(--p-muted)] backdrop-blur-sm hover:text-[var(--p-accent-text)]"
          >
            Explorer <ExternalLink className="size-3" />
          </a>
        )}
      </div>

      {loading && (
        <p className="relative mt-6 flex items-center gap-2 text-sm text-[var(--p-muted)]">
          <Loader2 className="size-4 animate-spin" /> Reading Coston2…
        </p>
      )}

      {status && !status.configured && (
        <div className="relative mt-5 space-y-2 text-sm text-[var(--p-muted)]">
          <p>{status.note}</p>
          {status && !status.configured && status.code === "SAFE_NOT_CREATED" ? (
            <p className="text-xs text-[var(--p-accent-text)]">
              Use <strong>Create Beacon Safe</strong> below — this wallet starts with an empty personal Safe.
            </p>
          ) : (
            <p className="font-mono text-[11px] text-[var(--p-faint)]">
              Factory / Safe not ready on Coston2 yet. No fake balances.
            </p>
          )}
          <p className="text-xs">{status.distinction}</p>
        </div>
      )}

      {live && (
        <div className="relative mt-6 space-y-5">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--p-muted)]">
              Available
            </p>
            <p className="mt-1 font-display text-4xl font-semibold tracking-tight text-[var(--p-fg)] sm:text-5xl">
              {live.balanceDisplay}
              <span className="ml-2 text-lg font-normal text-[var(--p-muted)] sm:text-xl">
                {live.tokenSymbol}
              </span>
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <PassMetric
              label="Remaining in window"
              value={`${live.windowRemainingDisplay ?? Math.max(0, Number(live.rollingWindowBudgetDisplay) - Number(live.windowSpentDisplay)).toFixed(6)} ${live.tokenSymbol}`}
              hint={
                live.windowResetsAtIso
                  ? `Resets ${new Date(live.windowResetsAtIso).toLocaleString()}`
                  : formatWindowHours(live.rollingWindowSeconds)
              }
            />
            <PassMetric
              label="Used / budget"
              value={`${live.windowSpentDisplay} / ${live.rollingWindowBudgetDisplay}`}
              hint={formatWindowHours(live.rollingWindowSeconds)}
            />
            <PassMetric
              label="Per trade limit"
              value={`${live.maxSpendPerTxDisplay} ${live.tokenSymbol}`}
            />
            <PassMetric
              label="Session"
              value={sessionLabel ?? "n/a"}
              hint={live.sessionActive ? "Active" : "Expired or blocked"}
            />
            <PassMetric
              label="Paused"
              value={live.paused ? "Yes" : "No"}
              hint={
                live.executor === "0x0000000000000000000000000000000000000000"
                  ? "Executor revoked"
                  : `Executor ${shortAddress(live.executor)}`
              }
              danger={live.paused}
            />
          </div>

          {Number(live.balanceDisplay) > 0 &&
            (Number(live.maxSpendPerTxDisplay) <= 0 ||
              Number(live.rollingWindowBudgetDisplay) <= 0) && (
              <p className="rounded-[var(--p-radius-sm)] border border-amber-500/35 bg-amber-500/10 px-3.5 py-3 text-sm text-amber-100">
                Funds are in Beacon Safe, but spend caps are still{" "}
                <span className="font-mono">0</span>. The owner must set per-trade and daily
                limits below before AI can spend this pool.
              </p>
            )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--p-border)] pt-4 font-mono text-[11px] text-[var(--p-faint)]">
            <span>Owner {shortAddress(live.owner)}</span>
            <span>
              {live.allowlists.targets.length} targets · {live.allowlists.selectors.length} selectors
            </span>
          </div>
          <p className="text-xs text-[var(--p-muted)]">{live.distinction}</p>
        </div>
      )}
    </div>
  );
}

function PassMetric({
  label,
  value,
  hint,
  danger,
}: {
  label: string;
  value: string;
  hint?: string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-[var(--p-radius-sm)] border border-[var(--p-border)] bg-[var(--p-card)]/70 px-3.5 py-3 backdrop-blur-sm">
      <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--p-muted)]">{label}</p>
      <p
        className={cn(
          "mt-1 font-display text-lg font-medium tracking-tight",
          danger ? "text-[var(--p-danger)]" : "text-[var(--p-fg)]",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-[var(--p-faint)]">{hint}</p>}
    </div>
  );
}
