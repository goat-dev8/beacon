import { motion, useReducedMotion } from "motion/react";
import {
  ArrowLeftRight,
  BarChart3,
  Boxes,
  Crosshair,
  Landmark,
  Layers,
  LineChart,
  Network,
  PieChart,
  Shield,
  Sparkles,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export type DiscoveryFeature = {
  id: string;
  title: string;
  blurb: string;
  prompt: string;
  icon: LucideIcon;
  accent?: boolean;
};

export const DISCOVERY_FEATURES: DiscoveryFeature[] = [
  {
    id: "swap",
    title: "Swap",
    blurb: "Quote and execute SparkDEX pairs with live pricing before you sign.",
    prompt: "Swap 50 USDT0 to FXRP",
    icon: ArrowLeftRight,
    accent: true,
  },
  {
    id: "bridge",
    title: "Bridge",
    blurb: "Move FXRP across chains with LayerZero OFT quotes and explorer receipts.",
    prompt: "Bridge FXRP to Base",
    icon: Network,
    accent: true,
  },
  {
    id: "x402",
    title: "x402",
    blurb: "Pay for agent work with EIP-3009 settle and an on-chain receipt.",
    prompt: "Pay using x402",
    icon: Wallet,
    accent: true,
  },
  {
    id: "portfolio",
    title: "Portfolio",
    blurb: "See balances, exposure, and next moves across your Flare rails.",
    prompt: "Analyze my Portfolio",
    icon: PieChart,
  },
  {
    id: "research",
    title: "Research",
    blurb: "Ask Beacon to brief a protocol, pair, or market path in plain language.",
    prompt: "Research SparkDEX",
    icon: Sparkles,
  },
  {
    id: "signals",
    title: "Signals",
    blurb: "Pull FTSO feeds so price and bias stay visible before any trade.",
    prompt: "Show FTSO signals for FXRP",
    icon: LineChart,
  },
  {
    id: "risk",
    title: "Risk",
    blurb: "Explain exposure, limits, and what could go wrong before you commit.",
    prompt: "Explain risk",
    icon: Shield,
  },
  {
    id: "yield",
    title: "Yield",
    blurb: "Find vault and liquidity paths that fit your size and risk posture.",
    prompt: "Find best yield",
    icon: BarChart3,
  },
  {
    id: "safe",
    title: "Safe",
    blurb: "Fund Beacon Safe from MetaMask, then set spend policy for the agent.",
    prompt: "Help me fund Beacon Safe and set spend policy",
    icon: Landmark,
    accent: true,
  },
  {
    id: "fassets",
    title: "FAssets",
    blurb: "Mint, redeem, and track FAssets status with documented Flare steps.",
    prompt: "Redeem FAssets",
    icon: Boxes,
  },
  {
    id: "crosschain",
    title: "Cross-chain",
    blurb: "Plan routes that start on Flare and land where your liquidity needs to be.",
    prompt: "Plan a cross-chain FXRP route",
    icon: Layers,
  },
  {
    id: "intel",
    title: "Intel",
    blurb: "Surface pair depth, route quality, and market context for the next decision.",
    prompt: "Give me market intelligence on FXRP",
    icon: Crosshair,
  },
];

type Props = {
  onTry: (prompt: string, mode?: "fill" | "send") => void;
  onOpenWhyFlare?: () => void;
};

export function FeatureDiscovery({ onTry, onOpenWhyFlare }: Props) {
  const reduce = useReducedMotion();

  return (
    <div className="mx-auto w-full max-w-[42rem] px-4 pb-2 pt-1 md:px-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-[18px] font-semibold tracking-tight text-[var(--p-fg)]">
            What Beacon can do
          </h2>
          <p className="mt-1 max-w-md text-[13px] leading-relaxed text-[var(--p-muted)]">
            Pick a rail to fill the composer, or send it straight into Flow.
          </p>
        </div>
        {onOpenWhyFlare && (
          <button
            type="button"
            onClick={onOpenWhyFlare}
            className="min-h-9 rounded-[var(--p-radius-sm)] border border-[var(--p-border)] bg-[var(--p-surface)] px-3 text-[12px] text-[var(--p-muted)] hover:text-[var(--p-fg)]"
          >
            Why Flare?
          </button>
        )}
      </div>

      <div className="grid grid-flow-dense gap-2 sm:grid-cols-2">
        {DISCOVERY_FEATURES.map((feature, i) => {
          const Icon = feature.icon;
          return (
            <motion.article
              key={feature.id}
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, delay: reduce ? 0 : i * 0.03, ease: [0.16, 1, 0.3, 1] }}
              className={
                feature.accent
                  ? "group flex flex-col rounded-[var(--p-radius)] border border-[var(--p-accent)]/35 bg-[var(--p-accent-soft)] p-3.5 transition-colors hover:border-[var(--p-accent)]/60"
                  : "group flex flex-col rounded-[var(--p-radius)] border border-[var(--p-border)] bg-[var(--p-card)] p-3.5 transition-colors hover:border-[var(--p-border-strong)] hover:bg-[var(--p-surface)]"
              }
            >
              <div className="flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-[var(--p-radius-sm)] bg-[var(--p-card)] text-[var(--p-accent-text)] ring-1 ring-[var(--p-border)]">
                  <Icon className="size-4" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="font-display text-[14px] font-semibold tracking-tight text-[var(--p-fg)]">
                    {feature.title}
                  </h3>
                  <p className="mt-1 text-[12px] leading-relaxed text-[var(--p-muted)]">{feature.blurb}</p>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => onTry(feature.prompt, "fill")}
                  className="min-h-8 flex-1 rounded-[var(--p-radius-sm)] border border-[var(--p-border)] bg-[var(--p-surface)] px-2.5 text-[12px] font-medium text-[var(--p-fg)] hover:bg-[var(--p-hover)]"
                >
                  Try now
                </button>
                <button
                  type="button"
                  onClick={() => onTry(feature.prompt, "send")}
                  className="min-h-8 rounded-[var(--p-radius-sm)] bg-signal px-2.5 text-[12px] font-medium text-[var(--p-on-accent)]"
                >
                  Send
                </button>
              </div>
            </motion.article>
          );
        })}
      </div>
    </div>
  );
}
