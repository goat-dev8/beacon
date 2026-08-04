import { motion } from "motion/react";
import { FacetCtaPair } from "@/components/ui/Button";

export function Hero() {
  return (
    <section className="relative overflow-hidden crosshair-grid border-b border-line">
      {/* dashed side rails */}
      <div className="pointer-events-none absolute inset-y-0 left-8 hidden w-px border-l border-dashed border-line md:block" />
      <div className="pointer-events-none absolute inset-y-0 right-8 hidden w-px border-r border-dashed border-line md:block" />

      <div className="relative mx-auto flex min-h-[min(70vh,42rem)] max-w-7xl flex-col justify-between px-6 pb-16 pt-20 md:px-16 md:pb-24 md:pt-28">
        <motion.h1
          className="font-display text-[clamp(3rem,8vw,6rem)] font-extrabold leading-[0.95] tracking-[-0.04em] text-ink"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55 }}
        >
          Finish AI work.
          <br />
          Pay only when
          <br />
          it passes.
        </motion.h1>

        {/* Halftone beacon with mint glow — original Beacon art */}
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
            Describe the job. Approve once. Watch it finish. Charged only after quality checks pass.
          </p>
          <div className="mt-6">
            <FacetCtaPair left="See how" right="Start now" leftTo="#how" rightTo="/app" />
          </div>
          <a
            href="/app"
            className="mt-4 inline-flex items-center gap-1 font-mono text-sm tracking-[0.35px] text-ink-muted underline decoration-ink-faint underline-offset-4 hover:text-ink"
          >
            open your desk →
          </a>
        </motion.div>
      </div>
    </section>
  );
}
