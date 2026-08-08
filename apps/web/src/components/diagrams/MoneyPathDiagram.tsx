import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

const NODES = [
  { id: "wallet", label: "Wallet", hint: "You sign" },
  { id: "safe", label: "Beacon Safe", hint: "Prepaid budget" },
  { id: "policy", label: "Policy", hint: "Caps + FCC" },
  { id: "ai", label: "AI", hint: "Intent to plan" },
  { id: "exec", label: "Execution", hint: "Flare rails" },
  { id: "receipt", label: "Receipt", hint: "On-chain proof" },
  { id: "explorer", label: "Explorer", hint: "Verify" },
] as const;

type Props = {
  className?: string;
  /** Highlight index; auto-advances when omitted */
  activeIndex?: number;
  autoPlay?: boolean;
  compact?: boolean;
};

export function MoneyPathDiagram({
  className,
  activeIndex,
  autoPlay = true,
  compact = false,
}: Props) {
  const reduce = useReducedMotion();
  const [tick, setTick] = useState(0);
  const active = activeIndex ?? tick;

  useEffect(() => {
    if (!autoPlay || activeIndex != null || reduce) return;
    const id = window.setInterval(() => {
      setTick((t) => (t + 1) % NODES.length);
    }, 1600);
    return () => window.clearInterval(id);
  }, [autoPlay, activeIndex, reduce]);

  return (
    <div
      className={cn("w-full", className)}
      role="img"
      aria-label="Wallet to Beacon Safe to policy to AI to execution to receipt to explorer"
    >
      <div
        className={cn(
          "relative flex w-full flex-wrap items-stretch justify-center gap-2 md:flex-nowrap md:gap-0",
          compact ? "py-2" : "py-4",
        )}
      >
        {NODES.map((node, i) => {
          const on = i === active;
          const done = i < active;
          return (
            <div key={node.id} className="relative flex min-w-[4.5rem] flex-1 flex-col items-center">
              {i < NODES.length - 1 && (
                <div
                  className="pointer-events-none absolute left-1/2 top-[22px] hidden h-px w-full md:block"
                  aria-hidden
                >
                  <motion.div
                    className="h-full origin-left bg-signal"
                    initial={false}
                    animate={{
                      scaleX: done || on ? 1 : 0.15,
                      opacity: done || on ? 0.9 : 0.25,
                    }}
                    transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                  />
                  <div className="absolute inset-0 bg-line" style={{ zIndex: -1 }} />
                </div>
              )}
              <motion.div
                className={cn(
                  "relative z-[1] grid size-11 place-items-center rounded-full border-2 font-mono text-[11px] font-bold tabular-nums transition-colors",
                  on
                    ? "border-signal bg-signal text-ink shadow-[0_0_0_4px_rgba(57,224,138,0.2)]"
                    : done
                      ? "border-signal/70 bg-dusk text-signal"
                      : "border-line bg-surface text-ink-faint",
                )}
                animate={reduce || !on ? undefined : { scale: [1, 1.06, 1] }}
                transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
              >
                {String(i + 1).padStart(2, "0")}
              </motion.div>
              <p
                className={cn(
                  "mt-2 text-center font-display text-[13px] font-semibold tracking-tight",
                  on ? "text-ink" : "text-ink-muted",
                )}
              >
                {node.label}
              </p>
              {!compact && (
                <p className="mt-0.5 max-w-[6.5rem] text-center font-mono text-[10px] text-ink-faint">
                  {node.hint}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-center text-sm text-ink-muted">
        {NODES[active].label}: {NODES[active].hint}
      </p>
    </div>
  );
}
