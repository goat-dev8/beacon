import { motion } from "motion/react";
import { FacetCtaPair } from "@/components/ui/Button";

export function Hero() {
  return (
    <section className="relative overflow-hidden crosshair-grid border-b border-line">
      <div className="pointer-events-none absolute inset-y-0 left-8 hidden w-px border-l border-dashed border-line md:block" />
      <div className="pointer-events-none absolute inset-y-0 right-8 hidden w-px border-r border-dashed border-line md:block" />

      <div className="relative mx-auto flex min-h-[min(70vh,42rem)] max-w-7xl flex-col justify-between px-6 pb-16 pt-20 md:px-16 md:pb-24 md:pt-28">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55 }}
        >
          <p className="font-mono text-[13px] font-medium uppercase tracking-[0.4px] text-signal-deep">
            Flare AI OS
          </p>
          <h1 className="mt-3 font-display text-[clamp(3rem,8vw,5.5rem)] font-extrabold leading-[0.95] tracking-[-0.04em] text-ink">
            Beacon
          </h1>
          <p className="mt-4 max-w-xl font-display text-2xl font-medium tracking-tight text-ink md:text-3xl">
            Signal to receipt on Flare.
          </p>
        </motion.div>

        <div className="pointer-events-none absolute right-0 top-8 hidden w-[min(44vw,30rem)] md:block lg:right-4 lg:top-0">
          <div
            className="float-soft aspect-square w-full"
            style={{
              filter:
                "invert(1) drop-shadow(0 0 2px rgba(57,224,138,0.95)) drop-shadow(0 0 10px rgba(57,224,138,0.55)) drop-shadow(0 0 22px rgba(57,224,138,0.35))",
              animation: "beacon-glow 6s ease-in-out infinite",
            }}
          >
            <img
              src="/brand/halftone-beacon.png"
              alt=""
              className="h-full w-full object-contain"
              width={704}
              height={704}
            />
          </div>
        </div>

        <motion.div
          className="relative z-10 mt-10 max-w-lg"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12, duration: 0.5 }}
        >
          <p className="text-xl leading-8 tracking-tight text-ink-muted md:text-2xl">
            Intent becomes quote, policy, pay, execute, and an explorer-backed receipt. One conversation for Flare rails.
          </p>
          <div className="mt-6">
            <FacetCtaPair left="See the path" right="Open Flow" leftTo="#how" rightTo="/flow" />
          </div>
          <a
            href="/flow"
            className="mt-4 inline-flex min-h-11 items-center gap-1 font-mono text-sm tracking-[0.35px] text-ink-muted underline decoration-ink-faint underline-offset-4 hover:text-ink"
          >
            open Flare AI OS →
          </a>
        </motion.div>
      </div>
    </section>
  );
}
