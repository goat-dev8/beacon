import { cn } from "@/lib/utils";

export const FLOW_SUGGESTIONS = [
  "Swap 50 USDT0 to FXRP",
  "Bridge FXRP to Base",
  "Redeem FAssets",
  "Pay using x402",
  "Analyze my Portfolio",
  "Research SparkDEX",
  "Find best yield",
  "Explain risk",
] as const;

type Props = {
  onSelect: (text: string) => void;
  disabled?: boolean;
  className?: string;
};

export function SuggestionChips({ onSelect, disabled, className }: Props) {
  return (
    <div className={cn("mb-2.5", className)}>
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FLOW_SUGGESTIONS.map((label) => (
          <button
            key={label}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(label)}
            className="shrink-0 rounded-full border border-[var(--p-border)] bg-[var(--p-surface)] px-3 py-1.5 text-[12px] text-[var(--p-muted)] transition-colors hover:border-[var(--p-border-strong)] hover:text-[var(--p-fg)] disabled:opacity-40"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
