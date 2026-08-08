import { Loader2 } from "lucide-react";
import { OwnerGate, SafeField, SafeSection } from "./safePrimitives";

export function SpendingPolicySection({
  maxSpend,
  windowBudget,
  windowHours,
  sessionHours,
  onMaxSpend,
  onWindowBudget,
  onWindowHours,
  onSessionHours,
  onSave,
  pending,
  busy,
  wallet,
  isOwner,
  onConnect,
  connecting,
  remainingDisplay,
  spentDisplay,
  budgetDisplay,
  resetsAtIso,
  sessionLabel,
  paused,
}: {
  maxSpend: string;
  windowBudget: string;
  windowHours: number;
  sessionHours: number;
  onMaxSpend: (v: string) => void;
  onWindowBudget: (v: string) => void;
  onWindowHours: (v: number) => void;
  onSessionHours: (v: number) => void;
  onSave: () => void;
  pending: boolean;
  busy?: boolean;
  wallet: string | null;
  isOwner: boolean;
  onConnect: () => void;
  connecting: boolean;
  remainingDisplay?: string | null;
  spentDisplay?: string | null;
  budgetDisplay?: string | null;
  resetsAtIso?: string | null;
  sessionLabel?: string | null;
  paused?: boolean;
}) {
  const spent = Number(spentDisplay ?? 0);
  const budget = Number(budgetDisplay ?? windowBudget ?? 0);
  const remaining = Number(remainingDisplay ?? Math.max(0, budget - spent));
  const pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;

  return (
    <SafeSection>
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--p-accent-text)]">
        Spending policy
      </p>
      <h2 className="mt-1 font-display text-xl font-semibold tracking-tight">
        What the AI is allowed to spend
      </h2>
      <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-[var(--p-muted)]">
        On-chain caps in Beacon Safe. Example: per trade 1 USDT0 and rolling budget 10 USDT0 over
        168h means the agent can run many small Safe swaps, but never more than 1 USDT0 in one call
        or 10 USDT0 in the window.
      </p>

      <OwnerGate
        wallet={wallet}
        isOwner={isOwner}
        onConnect={onConnect}
        connecting={connecting}
      />

      <div className="mt-5 overflow-hidden rounded-2xl border border-[var(--p-border)] bg-[var(--p-surface-2)] p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--p-muted)]">
              Rolling window usage
            </p>
            <p className="mt-1 font-display text-2xl font-semibold tabular-nums">
              {spentDisplay ?? "—"}{" "}
              <span className="text-base font-normal text-[var(--p-muted)]">
                / {budgetDisplay ?? windowBudget} USDT0
              </span>
            </p>
            <p className="mt-1 text-xs text-[var(--p-muted)]">
              Remaining{" "}
              <span className="text-[var(--p-accent-text)]">{remainingDisplay ?? remaining.toFixed(1)}</span>
              {resetsAtIso
                ? ` · resets ${new Date(resetsAtIso).toLocaleString()}`
                : " · window not started"}
            </p>
          </div>
          <div className="text-right text-xs text-[var(--p-muted)]">
            <p>Session · {sessionLabel ?? "—"}</p>
            <p className="mt-1">Safe · {paused ? "Paused" : "Active"}</p>
          </div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--p-border)]">
          <div
            className="h-full rounded-full bg-[var(--p-accent)] transition-[width] duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <SafeField
          label="Per trade limit (USDT0)"
          value={maxSpend}
          onChange={(v) => onMaxSpend(String(v))}
          string
          disabled={!isOwner}
          hint="Example: 1.0 blocks any single Safe swap above 1 USDT0"
        />
        <SafeField
          label="Rolling budget (USDT0)"
          value={windowBudget}
          onChange={(v) => onWindowBudget(String(v))}
          string
          disabled={!isOwner}
          hint="Total the agent may spend before the window resets"
        />
        <SafeField
          label="Rolling period (hours)"
          value={windowHours}
          onChange={(v) => onWindowHours(Number(v) || 0)}
          disabled={!isOwner}
          hint="168 = one week. Spent total resets when this window ends."
        />
        <SafeField
          label="Session length (hours)"
          value={sessionHours}
          onChange={(v) => onSessionHours(Number(v) || 0)}
          disabled={!isOwner}
          hint="0 = no session expiry. Otherwise executor stops after this many hours."
        />
      </div>

      <button
        type="button"
        disabled={!isOwner || pending}
        onClick={onSave}
        className="mt-5 inline-flex items-center gap-2 rounded-full bg-[var(--p-accent)] px-5 py-2.5 text-sm font-medium text-[var(--p-on-accent)] transition hover:brightness-110 disabled:opacity-40"
      >
        {busy ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Saving on-chain…
          </>
        ) : (
          "Save spending policy"
        )}
      </button>
    </SafeSection>
  );
}
