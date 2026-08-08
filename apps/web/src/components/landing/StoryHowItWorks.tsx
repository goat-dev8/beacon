import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { MoneyPathDiagram } from "@/components/diagrams/MoneyPathDiagram";
import { cn } from "@/lib/utils";

const STAGES = [
  {
    id: "signal",
    title: "Signal",
    body: "FTSO prices and risk bias land in Flow before you commit. The feed is the first truth.",
    rail: "FTSO",
  },
  {
    id: "quote",
    title: "Quote",
    body: "Beacon prices the move: SparkDEX quoter, LayerZero fee, or Agent Job estimate. Numbers first.",
    rail: "SparkDEX / LZ",
  },
  {
    id: "policy",
    title: "Policy",
    body: "Beacon Safe caps and FCC (SIMULATED_TEE on Coston2) gate spend. Blocked still leaves a receipt.",
    rail: "Safe + FCC",
  },
  {
    id: "pay",
    title: "Pay",
    body: "x402 settles MockUSDT0 with EIP-3009. Jobs prefer Safe prepaid escrow; wallet auth stays fallback.",
    rail: "x402",
  },
  {
    id: "execute",
    title: "Execute",
    body: "Swaps, bridges, FAssets prep, or agent work run on Flare rails under the approved envelope.",
    rail: "Flare",
  },
  {
    id: "receipt",
    title: "Receipt",
    body: "Explorer links for source, protocol path, and destination. Proof you can open, not a claim.",
    rail: "Explorer",
  },
] as const;

/** Greptile-style step storytelling: one active stage, visual path, short copy. */
export function StoryHowItWorks() {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  const stage = STAGES[active];

  return (
    <section id="story" className="border-b border-line bg-surface py-28 md:py-40">
      <div className="mx-auto max-w-6xl px-5">
        <h2 className="max-w-3xl font-display text-3xl font-extrabold tracking-tight text-ink md:text-5xl">
          How Beacon turns intent into proof
        </h2>
        <p className="mt-4 max-w-xl text-lg text-ink-muted">
          Six beats. Same loop every time. Hover a stage to see what happens next.
        </p>

        <div className="mt-12 rounded-[12px] border border-line bg-paper p-4 md:p-8">
          <MoneyPathDiagram
            activeIndex={Math.min(active, 6)}
            autoPlay={false}
            className="mb-8 border-b border-line pb-6"
          />

          <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="flex flex-col gap-1" role="tablist" aria-label="Beacon loop">
              {STAGES.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={active === i}
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onClick={() => setActive(i)}
                  className={cn(
                    "flex items-center gap-3 rounded-[10px] px-4 py-3 text-left transition-colors",
                    active === i ? "bg-dusk text-paper" : "text-ink hover:bg-paper-2",
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
                  <span className="font-display text-[15px] font-semibold">{s.title}</span>
                  <span
                    className={cn(
                      "ml-auto hidden font-mono text-[10px] uppercase tracking-wider sm:inline",
                      active === i ? "text-signal/90" : "text-ink-faint",
                    )}
                  >
                    {s.rail}
                  </span>
                </button>
              ))}
            </div>

            <motion.div
              key={stage.id}
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="flex flex-col justify-center rounded-[12px] border border-line bg-surface p-8 md:p-10"
            >
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-signal-deep">
                {stage.rail}
              </p>
              <h3 className="mt-3 font-display text-3xl font-bold tracking-tight text-ink">
                {stage.title}
              </h3>
              <p className="mt-4 max-w-prose text-base leading-relaxed text-ink-muted">{stage.body}</p>
              <p className="mt-8 text-sm text-ink-faint">
                Next: {STAGES[(active + 1) % STAGES.length].title}
              </p>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}
