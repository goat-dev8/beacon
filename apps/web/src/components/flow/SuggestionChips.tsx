import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  BarChart3,
  Boxes,
  Landmark,
  LineChart,
  Network,
  PieChart,
  Shield,
  Sparkles,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type FlowFeature = {
  id: string;
  label: string;
  prompt: string;
  icon: LucideIcon;
};

/** Compact rail chips: short labels, full prompts on select. */
export const FLOW_FEATURES: FlowFeature[] = [
  { id: "swap", label: "Swap", prompt: "Swap 50 USDT0 to FXRP", icon: ArrowLeftRight },
  { id: "bridge", label: "Bridge", prompt: "Bridge FXRP to Base", icon: Network },
  { id: "x402", label: "x402", prompt: "Pay using x402", icon: Wallet },
  { id: "fassets", label: "FAssets", prompt: "Redeem FAssets", icon: Boxes },
  { id: "portfolio", label: "Portfolio", prompt: "Analyze my Portfolio", icon: PieChart },
  { id: "signals", label: "Signals", prompt: "Show FTSO signals for FXRP", icon: LineChart },
  { id: "yield", label: "Yield", prompt: "Find best yield", icon: BarChart3 },
  { id: "research", label: "Research", prompt: "Research SparkDEX", icon: Sparkles },
  { id: "risk", label: "Risk", prompt: "Explain risk", icon: Shield },
  { id: "safe", label: "Safe", prompt: "Help me fund Beacon Safe and set spend policy", icon: Landmark },
];

type Props = {
  onSelect: (text: string) => void;
  disabled?: boolean;
  className?: string;
};

export function SuggestionChips({ onSelect, disabled, className }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  function updateArrows() {
    const el = scrollerRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }

  useEffect(() => {
    updateArrows();
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => updateArrows();
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(updateArrows);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, []);

  function scrollByDir(dir: -1 | 1) {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.6), behavior: "smooth" });
  }

  return (
    <div className={cn("mb-2", className)}>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Previous features"
          disabled={!canLeft || disabled}
          onClick={() => scrollByDir(-1)}
          className="grid size-7 shrink-0 place-items-center rounded-full border border-[var(--p-border)] bg-[var(--p-surface)] text-[var(--p-muted)] transition-colors hover:border-[var(--p-accent)]/50 hover:text-[var(--p-fg)] disabled:opacity-25"
        >
          <ArrowLeft className="size-3.5" strokeWidth={2} />
        </button>
        <div
          ref={scrollerRef}
          className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto scroll-smooth px-0.5 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {FLOW_FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <button
                key={feature.id}
                type="button"
                disabled={disabled}
                onClick={() => onSelect(feature.prompt)}
                title={feature.prompt}
                className="group inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--p-border)] bg-[var(--p-surface)] px-2.5 py-1 text-[12px] font-medium text-[var(--p-muted)] transition-colors hover:border-[var(--p-accent)]/50 hover:bg-[var(--p-accent-soft)] hover:text-[var(--p-fg)] disabled:opacity-40"
              >
                <span className="grid size-5 place-items-center rounded-full bg-[var(--p-accent-soft)] text-[var(--p-accent-text)] transition-colors group-hover:bg-[var(--p-accent)] group-hover:text-[var(--p-on-accent)]">
                  <Icon className="size-3" strokeWidth={2} />
                </span>
                {feature.label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          aria-label="Next features"
          disabled={!canRight || disabled}
          onClick={() => scrollByDir(1)}
          className="grid size-7 shrink-0 place-items-center rounded-full border border-[var(--p-border)] bg-[var(--p-surface)] text-[var(--p-muted)] transition-colors hover:border-[var(--p-accent)]/50 hover:text-[var(--p-fg)] disabled:opacity-25"
        >
          <ArrowRight className="size-3.5" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
