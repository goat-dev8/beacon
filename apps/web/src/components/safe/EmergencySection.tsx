import type { ReactNode } from "react";
import { Ban, Pause, Play } from "lucide-react";
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
}) {
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
        spend until you set one again.
      </p>

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
          icon={<Pause className="size-3.5" />}
        />
        <EmergencyAction
          title="Unpause"
          consequence="Restores spending under your existing policy caps."
          disabled={!isOwner || pending || !paused}
          onClick={onUnpause}
          icon={<Play className="size-3.5" />}
        />
        <EmergencyAction
          title="Revoke executor"
          consequence="Removes the spender key. Agents cannot pull funds until re-authorized."
          disabled={!isOwner || pending}
          onClick={onRevoke}
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
}: {
  title: string;
  consequence: string;
  disabled: boolean;
  onClick: () => void;
  icon: ReactNode;
  tone?: "danger";
}) {
  return (
    <div className="flex flex-col rounded-[var(--p-radius-sm)] border border-[var(--p-border)] bg-[var(--p-surface-2)] p-4">
      <p className="text-sm leading-relaxed text-[var(--p-muted)]">{consequence}</p>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={
          tone === "danger"
            ? "mt-auto inline-flex items-center justify-center gap-1.5 rounded-full border border-[var(--p-danger)]/45 px-4 py-2 text-sm text-[var(--p-danger)] disabled:opacity-40 pt-4"
            : "mt-auto inline-flex items-center justify-center gap-1.5 rounded-full border border-[var(--p-border-strong)] px-4 py-2 text-sm disabled:opacity-40 pt-4"
        }
      >
        {icon} {title}
      </button>
    </div>
  );
}
