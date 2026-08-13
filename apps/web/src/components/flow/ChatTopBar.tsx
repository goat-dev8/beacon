import { PanelLeft } from "lucide-react";
import { shortAddress } from "@/lib/wallet";

type Balances = {
  usdt0: { formatted: string };
  fxrp: { formatted: string };
} | null;

type Props = {
  agentName: string;
  displayModel?: string | null;
  wallet: string | null;
  connecting: boolean;
  balances: Balances;
  onConnect: () => void;
  onOpenHistory: () => void;
  historyOpen: boolean;
  onOpenWhyFlare: () => void;
};

export function ChatTopBar({
  agentName,
  displayModel,
  wallet,
  connecting,
  balances,
  onConnect,
  onOpenHistory,
  historyOpen,
  onOpenWhyFlare,
}: Props) {
  return (
    <header className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--p-border)] bg-[var(--p-bg)] px-3 py-2.5 md:gap-3 md:px-6">
      <div className="flex min-w-0 items-center gap-2.5">
        {!historyOpen && (
          <button
            type="button"
            onClick={onOpenHistory}
            className="grid size-9 shrink-0 place-items-center rounded-[var(--p-radius-sm)] text-[var(--p-faint)] hover:bg-[var(--p-hover)] hover:text-[var(--p-fg)] md:hidden"
            aria-label="Open conversation history"
          >
            <PanelLeft className="size-[18px]" strokeWidth={1.75} />
          </button>
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate font-display text-[15px] font-semibold tracking-tight text-[var(--p-fg)]">
              {agentName}
            </h1>
            <span className="rounded-[var(--p-radius-sm)] border border-[var(--p-border)] bg-[var(--p-surface)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--p-faint)]">
              Coston2
            </span>
            {displayModel && (
              <span
                className="hidden truncate rounded-[var(--p-radius-sm)] border border-[var(--p-border)] bg-[var(--p-surface)] px-2 py-0.5 font-mono text-[10px] text-[var(--p-muted)] sm:inline"
                title={displayModel}
              >
                {displayModel}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onOpenWhyFlare}
          className="hidden min-h-9 rounded-[var(--p-radius-sm)] border border-[var(--p-border)] bg-[var(--p-surface)] px-3 text-[12px] text-[var(--p-muted)] hover:text-[var(--p-fg)] sm:inline-flex sm:items-center"
        >
          Why Flare
        </button>
        {wallet && balances && (
          <div className="hidden items-center gap-2 rounded-[var(--p-radius-sm)] border border-[var(--p-border)] bg-[var(--p-surface)] px-2.5 py-1.5 font-mono text-[10px] text-[var(--p-muted)] xl:flex">
            <span>
              <span className="text-[var(--p-faint)]">USDT0</span> {balances.usdt0.formatted}
            </span>
            <span className="text-[var(--p-faint)]">·</span>
            <span>
              <span className="text-[var(--p-faint)]">FXRP</span> {balances.fxrp.formatted}
            </span>
          </div>
        )}
        {wallet ? (
          <span className="max-w-[7.5rem] truncate rounded-[var(--p-radius-sm)] border border-[var(--p-border)] px-2.5 py-1.5 font-mono text-[12px] text-[var(--p-muted)] sm:max-w-none sm:px-3">
            {shortAddress(wallet)}
          </span>
        ) : (
          <button
            type="button"
            onClick={onConnect}
            disabled={connecting}
            className="min-h-9 rounded-[var(--p-radius-sm)] bg-signal px-4 py-1.5 text-[13px] font-medium text-[var(--p-on-accent)] disabled:opacity-50"
          >
            {connecting ? "Connecting…" : "Connect"}
          </button>
        )}
      </div>
    </header>
  );
}
