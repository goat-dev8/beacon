import { motion, useReducedMotion } from "motion/react";
import { FacetCtaPair } from "@/components/ui/Button";

export function Hero() {
  const reduce = useReducedMotion();

  return (
    <section className="relative overflow-hidden border-b border-line bg-paper">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.55]"
        style={{
          background:
            "radial-gradient(ellipse 80% 55% at 70% 20%, rgba(57,224,138,0.14), transparent 55%), radial-gradient(ellipse 50% 40% at 10% 80%, rgba(42,39,53,0.06), transparent 50%)",
        }}
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-y-0 left-8 hidden w-px border-l border-dashed border-line md:block" />
      <div className="pointer-events-none absolute inset-y-0 right-8 hidden w-px border-r border-dashed border-line md:block" />

      <div className="relative mx-auto flex min-h-[min(78vh,46rem)] max-w-7xl flex-col justify-center px-6 pb-20 pt-24 md:px-16 md:pb-28 md:pt-32">
        <motion.div
          className="mx-auto w-full max-w-5xl text-center"
          initial={reduce ? false : { opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="font-mono text-[13px] font-medium uppercase tracking-[0.4px] text-signal-deep">
            Flare AI OS
          </p>
          <h1 className="mt-4 font-display text-[clamp(3rem,6vw,5.25rem)] font-extrabold leading-[0.98] tracking-[-0.04em] text-ink">
            Beacon turns intent into on-chain receipts
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed tracking-tight text-ink-muted md:text-xl">
            Talk once. Quote, policy, pay, execute, and explorer proof on Flare rails.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
            <FacetCtaPair left="Open Flow" right="See the path" leftTo="/flow" rightTo="#architecture" />
          </div>
        </motion.div>

        <motion.div
          className="pointer-events-none absolute right-[4%] top-[12%] hidden w-[min(38vw,26rem)] opacity-90 lg:block"
          initial={reduce ? false : { opacity: 0, scale: 0.92 }}
          animate={{ opacity: 0.9, scale: 1 }}
          transition={{ delay: 0.15, duration: 0.7 }}
          aria-hidden
        >
          <div
            className="float-soft aspect-square w-full"
            style={{
              filter:
                "invert(1) drop-shadow(0 0 2px rgba(57,224,138,0.9)) drop-shadow(0 0 12px rgba(57,224,138,0.45))",
              animation: "beacon-glow 6s ease-in-out infinite",
            }}
          >
            <img
              src="/brand/halftone-beacon.png"
              alt=""
              className="h-full w-full object-contain"
              width={640}
              height={640}
            />
          </div>
        </motion.div>
      </div>
    </section>
  );
}
