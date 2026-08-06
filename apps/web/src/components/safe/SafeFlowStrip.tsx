import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, Wallet, Shield, ScrollText, Sparkles, Play, Receipt } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  { id: "wallet", label: "Wallet", icon: Wallet, blurb: "Your funds stay in your custody until you deposit." },
  { id: "safe", label: "Beacon Safe", icon: Shield, blurb: "Deposit a prepaid budget the AI can draw from." },
  { id: "policy", label: "Policy", icon: ScrollText, blurb: "Caps, session, and pause rules you set." },
  { id: "ai", label: "AI", icon: Sparkles, blurb: "Agents propose work within those bounds." },
  { id: "exec", label: "Execution", icon: Play, blurb: "On-chain calls only if policy allows." },
  { id: "receipt", label: "Receipt", icon: Receipt, blurb: "Every spend leaves a clear trail." },
  { id: "back", label: "Wallet", icon: Wallet, blurb: "Withdraw anytime. Pause anytime." },
] as const;

export function SafeFlowStrip() {
  const [active, setActive] = useState(1);
  const reduce = useReducedMotion();
  const step = STEPS[active];

  return (
    <div className="overflow-hidden rounded-[var(--p-radius)] border border-[var(--p-border)] bg-[var(--p-surface)] p-4 sm:p-5">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--p-accent-text)]">
        How money moves
      </p>
      <div className="mt-4 flex items-center gap-1 overflow-x-auto pb-1 sm:gap-0 sm:overflow-visible">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const isActive = i === active;
          return (
            <div key={`${s.id}-${i}`} className="flex shrink-0 items-center">
              <button
                type="button"
                onClick={() => setActive(i)}
                className={cn(
                  "group flex flex-col items-center gap-1.5 rounded-[var(--p-radius-sm)] px-2 py-2 transition-colors",
                  isActive ? "bg-[var(--p-accent-soft)]" : "hover:bg-[var(--p-hover)]",
                )}
              >
                <span
                  className={cn(
                    "flex size-9 items-center justify-center rounded-full border transition-colors",
                    isActive
                      ? "border-[var(--p-accent)]/50 bg-[var(--p-accent)] text-[var(--p-on-accent)]"
                      : "border-[var(--p-border-strong)] bg-[var(--p-surface-2)] text-[var(--p-muted)] group-hover:text-[var(--p-fg)]",
                  )}
                >
                  <Icon className="size-3.5" strokeWidth={2} />
                </span>
                <span
                  className={cn(
                    "max-w-[4.5rem] text-center font-mono text-[9px] uppercase tracking-[0.08em]",
                    isActive ? "text-[var(--p-accent-text)]" : "text-[var(--p-faint)]",
                  )}
                >
                  {s.label}
                </span>
              </button>
              {i < STEPS.length - 1 && (
                <ArrowRight
                  className="mx-0.5 hidden size-3.5 shrink-0 text-[var(--p-faint)] sm:block"
                  strokeWidth={1.5}
                />
              )}
            </div>
          );
        })}
      </div>
      <motion.p
        key={step.id + String(active)}
        initial={reduce ? false : { opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28 }}
        className="mt-4 text-sm leading-relaxed text-[var(--p-muted)]"
      >
        <span className="font-medium text-[var(--p-fg)]">{step.label}.</span> {step.blurb}
      </motion.p>
    </div>
  );
}
