import { motion, useReducedMotion } from "motion/react";
import {
  AcceptanceDiagram,
  EscrowDiagram,
  PreparingDiagram,
  ReceiptDiagram,
} from "@/components/diagrams/BeaconDiagrams";
import { PixelWave, Ruler, SectionLabel } from "@/components/landing/PixelWave";
import { FacetCtaPair } from "@/components/ui/Button";
import { CONTRACTS, NETWORK } from "@/lib/chain";

/** Greptile-style manifesto quote band */
export function ManifestoQuote() {
  return (
    <section className="border-b border-line bg-paper py-16 md:py-20">
      <div className="mx-auto max-w-4xl px-5 text-center md:px-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-faint">[ Flare AI OS ]</p>
        <blockquote className="mt-6 font-display text-2xl font-medium leading-snug tracking-tight text-ink md:text-4xl md:leading-[1.15]">
          &ldquo;Flare gives Beacon its rails. Beacon turns language into priced, gated, settled, proven work.&rdquo;
        </blockquote>
        <p className="mt-6 font-mono text-sm text-ink-muted">Signal · Quote · Policy · Pay · Execute · Receipt</p>
      </div>
    </section>
  );
}

export function WhatIsBeacon() {
  const reduce = useReducedMotion();

  return (
    <section id="what" className="border-b border-line bg-surface py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-5 md:px-8">
        <SectionLabel>Product</SectionLabel>
        <div className="grid items-end gap-10 lg:grid-cols-[1.15fr_0.85fr]">
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.45 }}
          >
            <h2 className="max-w-xl font-display text-3xl font-extrabold tracking-tight text-ink md:text-5xl">
              Flare strength, one conversation
            </h2>
            <p className="mt-5 max-w-lg text-lg leading-relaxed text-ink-muted">
              Beacon does not invent a chain story. It runs yours on Flare: live FTSO signal, Safe policy, FCC checks, x402 pay, and explorer receipts you can open.
            </p>
          </motion.div>
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.08, duration: 0.45 }}
            className="border border-dashed border-line bg-paper p-6 md:p-8"
          >
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">Honest loop</p>
            <p className="mt-3 font-display text-xl font-medium tracking-tight text-ink md:text-2xl">
              Signal · Quote · Policy · Pay · Execute · Receipt
            </p>
            <p className="mt-3 text-sm leading-relaxed text-ink-muted">
              No invented proofs. No blank void. Every step stays visible before you sign.
            </p>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

export function QualityBand() {
  return (
    <section id="quality" className="relative bg-dusk text-paper">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />
      <div className="flex justify-center pt-8">
        <span className="bg-rose px-4 py-1.5 font-mono text-[11px] tracking-wide text-ink">
          See how quality works
        </span>
      </div>
      <div className="mx-auto max-w-4xl px-5 pb-0 pt-10 text-center">
        <SectionLabel className="text-white/45">Quality</SectionLabel>
        <h2 className="font-display text-3xl font-extrabold tracking-tight text-paper md:text-5xl">
          Policy before pay
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-white/65">
          Spend limits gate every settle. Quotes stay visible. Receipts stay on-chain.
        </p>
      </div>
      <PixelWave className="mt-10 h-28 w-full md:h-40" />
    </section>
  );
}

export function QualitySection() {
  return (
    <section className="border-b border-line bg-paper py-20">
      <div className="mx-auto max-w-6xl px-5 md:px-8">
        <div className="grid gap-0 border border-dashed border-line lg:grid-cols-2">
          <div className="border-b border-dashed border-line bg-surface p-6 lg:border-r">
            <p className="mb-4 font-mono text-[11px] uppercase tracking-widest text-ink-faint">
              Acceptance path
            </p>
            <AcceptanceDiagram />
          </div>
          <div className="border-b border-dashed border-line bg-surface p-6">
            <p className="mb-4 font-mono text-[11px] uppercase tracking-widest text-ink-faint">
              Payment rule
            </p>
            <EscrowDiagram />
          </div>
          <div className="border-b border-dashed border-line bg-surface p-6 lg:border-b-0 lg:border-r">
            <p className="mb-4 font-mono text-[11px] uppercase tracking-widest text-ink-faint">
              Preparing a job
            </p>
            <PreparingDiagram />
          </div>
          <div className="flex flex-col items-center bg-surface p-6">
            <p className="mb-4 self-start font-mono text-[11px] uppercase tracking-widest text-ink-faint">
              Receipt
            </p>
            <ReceiptDiagram />
          </div>
        </div>
        <Ruler />
      </div>
    </section>
  );
}

export function ContractsSection() {
  return (
    <section id="receipts" className="border-b border-line bg-surface py-20">
      <div className="mx-auto max-w-6xl px-5 md:px-8">
        <SectionLabel>On-chain</SectionLabel>
        <h2 className="mx-auto max-w-3xl text-center font-display text-3xl font-extrabold tracking-tight md:text-4xl">
          Real contracts on Coston2
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-sm text-ink-muted">
          Approve locks quote funds in escrow. Release only when the job passes.
        </p>
        <dl className="mx-auto mt-10 grid max-w-3xl gap-0 border border-dashed border-line font-mono text-xs">
          {[
            ["Network", `${NETWORK.name} · chain ${NETWORK.chainId}`, null],
            ["Escrow", CONTRACTS.escrow, CONTRACTS.escrow],
            ["Token", CONTRACTS.token, CONTRACTS.token],
            ["Job registry", CONTRACTS.jobRegistry, CONTRACTS.jobRegistry],
          ].map(([k, v, href], i, arr) => (
            <div
              key={k}
              className={`flex flex-col gap-1 bg-paper px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
                i < arr.length - 1 ? "border-b border-dashed border-line" : ""
              }`}
            >
              <dt className="text-ink-faint">{k}</dt>
              <dd className="break-all text-ink">
                {href ? (
                  <a
                    href={`${NETWORK.explorer}/address/${href}`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-line hover:text-signal-deep"
                  >
                    {v}
                  </a>
                ) : (
                  v
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section className="bg-dusk py-28 text-paper md:py-36">
      <div className="mx-auto max-w-6xl px-5 text-center md:px-8">
        <h2 className="font-display text-3xl font-extrabold tracking-tight md:text-5xl">
          Open Beacon Flow
        </h2>
        <p className="mx-auto mt-4 max-w-md text-white/65">
          Talk to Flare AI OS. Quotes, policy, payments, and explorer receipts on production rails.
        </p>
        <div className="mt-8 flex justify-center">
          <FacetCtaPair left="Get Started" right="Open Flow" leftTo="/start" rightTo="/flow" />
        </div>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-line bg-surface py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-5 text-sm text-ink-faint md:flex-row md:items-center md:px-8">
        <p>© {new Date().getFullYear()} Beacon</p>
        <p className="font-mono text-xs">Flare AI OS. Signal to receipt.</p>
      </div>
    </footer>
  );
}
