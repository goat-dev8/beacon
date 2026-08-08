import type { ReactNode } from "react";
import { Ban, Pause, Play, ShieldAlert } from "lucide-react";
import { OwnerGate, SafeSection } from "./safePrimitives";

export function EmergencySection({
  paused,
  pending,
  wallet,
  isOwner,
  onConnect,
  connecting,
  onPause,
  onUnpause,
  onRevoke,
  executor,
  busyAction,
}: {
  paused: boolean;
  pending: boolean;
  wallet: string | null;
  isOwner: boolean;
  onConnect: () => void;
  connecting: boolean;
  onPause: () => void;
  onUnpause: () => void;
  onRevoke: () => void;
  executor?: string | null;
  busyAction?: "pause" | "unpause" | "revoke" | null;
}) {
  const statusLabel = paused ? "PAUSED" : "LIVE";
  const statusHint = paused
    ? "No Safe spends can run until you Unpause."
    : "Executor may spend within your on-chain caps.";

  return (
    <SafeSection className="border-[var(--p-danger)]/20">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--p-danger)]">
        Emergency
      </p>
      <h2 className="mt-1 font-display text-xl font-semibold tracking-tight">
        Stop spend in one move
      </h2>
      <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-[var(--p-muted)]">
        Pause freezes Safe executions until you unpause. Revoke clears the executor so nothing can
        spend until you set one again. Recovery: Unpause restores caps; after Revoke, set a new
        executor from the owner wallet.
      </p>

      <div
        className={`mt-4 flex items-start gap-3 rounded-2xl border px-4 py-3 ${
          paused
            ? "border-[var(--p-danger)]/40 bg-[color-mix(in_oklab,var(--p-danger)_12%,transparent)]"
            : "border-[var(--p-accent)]/30 bg-[color-mix(in_oklab,var(--p-accent)_10%,transparent)]"
        }`}
      >
        <ShieldAlert className={`mt-0.5 size-4 shrink-0 ${paused ? "text-[var(--p-danger)]" : "text-[var(--p-accent-text)]"}`} />
        <div>
          <p className="font-mono text-[11px] uppercase tracking-wider">
            On-chain status · {statusLabel}
          </p>
          <p className="mt-1 text-sm text-[var(--p-muted)]">{statusHint}</p>
          {executor ? (
            <p className="mt-1 font-mono text-[11px] text-[var(--p-faint)]">
              Executor {executor.slice(0, 6)}…{executor.slice(-4)}
            </p>
          ) : null}
        </div>
      </div>

      <OwnerGate
        wallet={wallet}
        isOwner={isOwner}
        onConnect={onConnect}
        connecting={connecting}
      />

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <EmergencyAction
          title="Pause"
          consequence="Blocks all Safe spends immediately. Balance stays put."
          disabled={!isOwner || pending || paused}
          onClick={onPause}
          tone="danger"
          loading={busyAction === "pause"}
          icon={<Pause className="size-3.5" />}
        />
        <EmergencyAction
          title="Unpause"
          consequence="Restores spending under your existing policy caps."
          disabled={!isOwner || pending || !paused}
          onClick={onUnpause}
          loading={busyAction === "unpause"}
          icon={<Play className="size-3.5" />}
        />
        <EmergencyAction
          title="Revoke executor"
          consequence="Removes the spender key. Agents cannot pull funds until re-authorized."
          disabled={!isOwner || pending}
          onClick={onRevoke}
          loading={busyAction === "revoke"}
          icon={<Ban className="size-3.5" />}
        />
      </div>
    </SafeSection>
  );
}

function EmergencyAction({
  title,
  consequence,
  disabled,
  onClick,
  icon,
  tone,
  loading,
}: {
  title: string;
  consequence: string;
  disabled: boolean;
  onClick: () => void;
  icon: ReactNode;
  tone?: "danger";
  loading?: boolean;
}) {
  return (
    <div className="flex flex-col rounded-[var(--p-radius-sm)] border border-[var(--p-border)] bg-[var(--p-surface-2)] p-4 transition hover:border-[var(--p-border-strong)]">
      <p className="text-sm leading-relaxed text-[var(--p-muted)]">{consequence}</p>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={
          tone === "danger"
            ? "mt-auto inline-flex items-center justify-center gap-1.5 rounded-full border border-[var(--p-danger)]/45 px-4 py-2 text-sm text-[var(--p-danger)] transition enabled:hover:bg-[color-mix(in_oklab,var(--p-danger)_12%,transparent)] disabled:opacity-40 pt-4"
            : "mt-auto inline-flex items-center justify-center gap-1.5 rounded-full border border-[var(--p-border-strong)] px-4 py-2 text-sm transition enabled:hover:bg-[var(--p-surface)] disabled:opacity-40 pt-4"
        }
      >
        {loading ? (
          <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          icon
        )}{" "}
        {loading ? "Confirming…" : title}
      </button>
    </div>
  );
}
