import { motion, useReducedMotion } from "motion/react";
import { Link } from "react-router-dom";

const RAILS = [
  {
    id: "safe",
    title: "Beacon Safe",
    why: "AI needs a prepaid envelope, not an open hot wallet.",
    how: "Deposit USDT0 once. Agents draw only under your caps.",
  },
  {
    id: "policy",
    title: "Spending policy",
    why: "Every settle must pass limits before money moves.",
    how: "Per-trade, rolling budget, session length. Owner can pause or revoke.",
  },
  {
    id: "fcc",
    title: "FCC",
    why: "Policy evaluation should stay off the public chat surface.",
    how: "Coston2 uses SIMULATED_TEE (hackathon-accepted). Not hardware-attested Confidential Space.",
  },
  {
    id: "x402",
    title: "x402",
    why: "Agents pay for work with HTTP-native settlement.",
    how: "MockUSDT0 EIP-3009 via facilitator. Idempotent nonces. Explorer receipt.",
  },
  {
    id: "fassets",
    title: "FAssets",
    why: "Non-smart-contract value needs Flare rails.",
    how: "FXRP status, redeem prepare, mint handoff documented in Flow.",
  },
  {
    id: "lz",
    title: "LayerZero",
    why: "Bridges need source, path, and destination proof.",
    how: "OFT quoteSend + send. Receipt links both explorers.",
  },
] as const;

export function ProtectionStory() {
  const reduce = useReducedMotion();

  return (
    <section id="protect" className="border-b border-line bg-paper py-28 md:py-40">
      <div className="mx-auto max-w-6xl px-5">
        <h2 className="max-w-2xl font-display text-3xl font-extrabold tracking-tight text-ink md:text-5xl">
          Why each piece exists
        </h2>
        <p className="mt-4 max-w-lg text-ink-muted">
          Visual answers, not a glossary. Tap through; every rail maps to Flare.
        </p>

        <div className="mt-14 grid grid-flow-dense gap-3 md:grid-cols-6 md:grid-rows-2">
          {RAILS.map((r, i) => {
            const wide = i === 0 || i === 3;
            return (
              <motion.article
                key={r.id}
                initial={reduce ? false : { opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.2 }}
                transition={{ delay: reduce ? 0 : i * 0.05, duration: 0.45 }}
                className={
                  wide
                    ? "md:col-span-3 rounded-[12px] border border-line bg-dusk p-7 text-paper md:p-8"
                    : "md:col-span-2 rounded-[12px] border border-line bg-surface p-6 md:p-7"
                }
              >
                <h3
                  className={
                    wide
                      ? "font-display text-2xl font-bold tracking-tight"
                      : "font-display text-lg font-bold tracking-tight text-ink"
                  }
                >
                  {r.title}
                </h3>
                <p className={wide ? "mt-3 text-paper/80" : "mt-3 text-sm text-ink-muted"}>
                  {r.why}
                </p>
                <p
                  className={
                    wide
                      ? "mt-4 border-t border-white/15 pt-4 font-mono text-[12px] text-signal"
                      : "mt-3 font-mono text-[11px] text-ink-faint"
                  }
                >
                  {r.how}
                </p>
              </motion.article>
            );
          })}
        </div>

        <div className="mt-12 flex flex-wrap items-center gap-4">
          <Link
            to="/start"
            className="inline-flex h-12 items-center bg-signal px-7 font-display text-sm font-semibold text-ink clip-facet-right hover:brightness-105"
          >
            Get Started
          </Link>
          <Link
            to="/flow/security"
            className="inline-flex h-12 items-center border border-line bg-surface px-6 font-display text-sm text-ink hover:bg-paper-2"
          >
            Open Beacon Safe
          </Link>
        </div>
      </div>
    </section>
  );
}
