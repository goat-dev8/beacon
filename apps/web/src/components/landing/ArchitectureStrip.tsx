import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { FacetCtaPair } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

const ARCH_STEPS = [
  {
    id: "deposit",
    label: "Deposit",
    body: "Fund Beacon Safe once. Liquidity stays ready for the next intent.",
  },
  {
    id: "policy",
    label: "Policy",
    body: "Set spend caps. Nothing settles until the rules allow it.",
  },
  {
    id: "chat",
    label: "Chat",
    body: "Describe the move. Beacon quotes pairs, routes, and risk in Flow.",
  },
  {
    id: "execute",
    label: "Execute",
    body: "Confirm when the quote is clear. Sign only what policy already passed.",
  },
  {
    id: "receipt",
    label: "Receipt",
    body: "Explorer links for source, protocol, and destination. Proof, not claims.",
  },
] as const;

export function ArchitectureStrip() {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);

  return (
    <section id="architecture" className="border-b border-line bg-paper py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-5 md:px-8">
        <p className="mb-3 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint">
          [ Path ]
        </p>
        <h2 className="mx-auto max-w-3xl text-center font-display text-3xl font-extrabold tracking-tight text-ink md:text-5xl">
          Deposit to receipt
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-center text-ink-muted">
          One interactive path. Hover or tap a stage to see what Beacon does before the next step.
        </p>

        <div className="mt-14 border border-dashed border-line bg-surface">
          <div className="flex flex-col lg:flex-row">
            <div className="flex flex-col lg:w-[42%]" role="tablist" aria-label="Architecture stages">
              {ARCH_STEPS.map((step, i) => (
                <button
                  key={step.id}
                  type="button"
                  role="tab"
                  aria-selected={active === i}
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onClick={() => setActive(i)}
                  className={cn(
                    "flex min-h-14 flex-1 items-center gap-3 border-b border-dashed border-line px-5 py-4 text-left transition-colors lg:border-r",
                    active === i ? "bg-dusk text-paper" : "bg-transparent text-ink hover:bg-paper-2",
                    i === ARCH_STEPS.length - 1 && "lg:border-b-0",
                  )}
                >
                  <span
                    className={cn(
                      "font-mono text-[11px] tabular-nums",
                      active === i ? "text-signal" : "text-ink-faint",
                    )}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="font-display text-[15px] font-semibold tracking-tight">{step.label}</span>
                </button>
              ))}
            </div>

            <div className="relative flex min-h-[220px] flex-1 items-center p-8 md:p-12" role="tabpanel">
              <motion.div
                key={ARCH_STEPS[active].id}
                initial={reduce ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              >
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-signal-deep">
                  {ARCH_STEPS[active].label}
                </p>
                <p className="mt-3 max-w-md font-display text-2xl font-medium tracking-tight text-ink md:text-3xl">
                  {ARCH_STEPS[active].body}
                </p>
                <a
                  href="/start"
                  className="mt-8 inline-flex min-h-11 items-center font-mono text-sm text-ink-muted underline decoration-ink-faint underline-offset-4 hover:text-ink"
                >
                  Learn this path
                </a>
              </motion.div>
            </div>
          </div>
        </div>

        <div className="mt-10 flex justify-center">
          <FacetCtaPair left="Get Started" right="Open Flow" leftTo="/start" rightTo="/flow" />
        </div>
      </div>
    </section>
  );
}
