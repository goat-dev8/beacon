import { motion, useReducedMotion } from "motion/react";
import { Link } from "react-router-dom";
import { FacetCtaPair } from "@/components/ui/Button";

export function Hero() {
  const reduce = useReducedMotion();

  return (
    <section className="relative overflow-hidden border-b border-line bg-paper">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 90% 60% at 75% 10%, rgba(57,224,138,0.18), transparent 55%), radial-gradient(ellipse 50% 45% at 5% 90%, rgba(42,39,53,0.07), transparent 50%)",
        }}
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-paper via-paper/88 to-transparent" aria-hidden />

      <div className="relative mx-auto grid min-h-[100dvh] max-w-7xl items-center gap-10 px-6 pb-24 pt-20 md:grid-cols-[1.05fr_0.95fr] md:px-16 md:pb-28 md:pt-24">
        <motion.div
          className="w-full max-w-5xl"
          initial={reduce ? false : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="font-display text-2xl font-extrabold tracking-tight text-ink md:text-3xl">
            Beacon
          </p>
          <h1 className="mt-4 max-w-5xl font-display text-[clamp(2.75rem,5.2vw,5rem)] font-extrabold leading-[1.02] tracking-[-0.04em] text-ink">
            Flare AI OS that settles with receipts
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-muted md:text-xl">
            Talk once. Policy gates spend. Flare rails execute. Explorer proof closes the loop.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-4">
            <FacetCtaPair
              left="Get Started"
              right="Open Flow"
              leftTo="/start"
              rightTo="/flow"
              size="lg"
            />
          </div>
        </motion.div>

        <motion.div
          className="relative mx-auto w-full max-w-md justify-self-end"
          initial={reduce ? false : { opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.12, duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
          aria-hidden
        >
          <div
            className="aspect-square w-full overflow-hidden rounded-[12px] border border-line bg-dusk"
            style={{
              boxShadow: "0 24px 60px -20px rgba(42,39,53,0.35)",
            }}
          >
            <img
              src="/brand/halftone-beacon.png"
              alt=""
              className="h-full w-full object-contain p-8"
              width={640}
              height={640}
              style={{
                filter:
                  "invert(1) drop-shadow(0 0 1px rgba(57,224,138,0.85)) drop-shadow(0 0 18px rgba(57,224,138,0.35))",
              }}
            />
          </div>
        </motion.div>
      </div>
    </section>
  );
}

export function HeroTrustStrip() {
  const rails = ["FTSO", "SparkDEX", "LayerZero", "x402", "FAssets", "Beacon Safe", "FCC"];
  return (
    <div className="border-b border-line bg-surface py-8">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-5">
        {rails.map((r) => (
          <span key={r} className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-faint">
            {r}
          </span>
        ))}
        <Link to="/start" className="font-mono text-[11px] uppercase tracking-[0.16em] text-signal-deep hover:underline">
          Start the path
        </Link>
      </div>
    </div>
  );
}
