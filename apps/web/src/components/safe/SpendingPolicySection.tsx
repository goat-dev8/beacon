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
  /** True only while this section's save tx is in flight (not deposit/emergency). */
  busy?: boolean;
  wallet: string | null;
  isOwner: boolean;
  onConnect: () => void;
  connecting: boolean;
}) {
  return (
    <SafeSection>
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--p-accent-text)]">
        Spending policy
      </p>
      <h2 className="mt-1 font-display text-xl font-semibold tracking-tight">
        What the AI is allowed to spend
      </h2>
      <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-[var(--p-muted)]">
        These on-chain caps live in Beacon Safe. Change them anytime as the owner.
      </p>

      <OwnerGate
        wallet={wallet}
        isOwner={isOwner}
        onConnect={onConnect}
        connecting={connecting}
      />

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <SafeField
          label="Per trade limit (USDT0)"
          value={maxSpend}
          onChange={(v) => onMaxSpend(String(v))}
          string
          disabled={!isOwner}
          hint="Hard ceiling on a single execution"
        />
        <SafeField
          label="Daily budget (USDT0)"
          value={windowBudget}
          onChange={(v) => onWindowBudget(String(v))}
          string
          disabled={!isOwner}
          hint="Total spend allowed in the rolling period"
        />
        <SafeField
          label="Rolling period (hours)"
          value={windowHours}
          onChange={(v) => onWindowHours(Number(v) || 0)}
          disabled={!isOwner}
          hint="How long the daily budget window runs"
        />
        <SafeField
          label="Session length (hours)"
          value={sessionHours}
          onChange={(v) => onSessionHours(Number(v) || 0)}
          disabled={!isOwner}
          hint="0 means no session expiry"
        />
      </div>

      <button
        type="button"
        disabled={!isOwner || pending}
        onClick={onSave}
        className="mt-5 inline-flex items-center gap-2 rounded-full bg-[var(--p-accent)] px-5 py-2.5 text-sm font-medium text-[var(--p-on-accent)] disabled:opacity-40"
      >
        {busy ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Saving…
          </>
        ) : (
          "Save spending policy"
        )}
      </button>
    </SafeSection>
  );
}
