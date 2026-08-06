import { motion } from "motion/react";
import {
  AcceptanceDiagram,
  EscrowDiagram,
  HowBeaconWorksDiagram,
  PreparingDiagram,
  ReceiptDiagram,
} from "@/components/diagrams/BeaconDiagrams";
import { PixelWave, Ruler, SectionLabel } from "@/components/landing/PixelWave";
import { FacetCtaPair } from "@/components/ui/Button";
import { CONTRACTS, NETWORK } from "@/lib/chain";

export function HowSection() {
  return (
    <section id="how" className="border-b border-line bg-surface py-24">
      <div className="mx-auto max-w-6xl px-5">
        <SectionLabel>Workflow</SectionLabel>
        <h2 className="mx-auto max-w-3xl text-center font-display text-3xl font-extrabold tracking-tight text-ink md:text-5xl">
          From signal to receipt
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-center text-ink-muted">
          One Flare AI OS path. Every step is visible before you sign.
        </p>
        <div className="mt-12 rounded-none border border-dashed border-line bg-paper p-6 md:p-10">
          <HowBeaconWorksDiagram />
        </div>
        <ol className="mt-14 grid gap-10 md:grid-cols-3">
          {[
            {
              step: "01",
              title: "Signal & quote",
              body: "FTSO, pairs, and routes become a priced quote before anything moves.",
            },
            {
              step: "02",
              title: "Policy & pay",
              body: "Spend limits gate the run. x402 or wallet confirm only when allowed.",
            },
            {
              step: "03",
              title: "Execute & receipt",
              body: "Source tx, protocol observe, destination receipt. Explorer links, not claims.",
            },
          ].map((item, i) => (
            <motion.li
              key={item.step}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
            >
              <p className="font-mono text-xs text-signal-deep">{item.step}</p>
              <h3 className="mt-2 font-display text-xl font-bold">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">{item.body}</p>
            </motion.li>
          ))}
        </ol>
        <Ruler />
      </div>
    </section>
  );
}

export function ServicesSection() {
  const rails: Array<{ id: string; title: string; body: string }> = [
    { id: "ftso", title: "FTSO Signals", body: "Live prices and risk bias from Flare Time Series Oracle." },
    { id: "sparkdex", title: "SparkDEX Swap", body: "QuoterV2 quotes and Mainnet execution for discovered pairs." },
    { id: "oft", title: "FXRP OFT Bridge", body: "LayerZero peers, quoteSend, source tx to destination receipt." },
    { id: "fassets", title: "FAssets / XRPFi", body: "Coston2 FTestXRP status, redeem prepare, documented mint handoff." },
    { id: "x402", title: "x402 Payments", body: "MockUSDT0 EIP-3009 settle on Coston2 with idempotent receipts." },
    { id: "vault", title: "Agent Vault", body: "Deposit once, policy budgets, owner pause. Escrow stays per-job." },
  ];

  return (
    <section id="services" className="border-b border-line bg-paper py-24">
      <div className="mx-auto max-w-6xl px-5">
        <SectionLabel>Services</SectionLabel>
        <h2 className="mx-auto max-w-3xl text-center font-display text-3xl font-extrabold tracking-tight md:text-5xl">
          Agents on Flare rails
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-center text-ink-muted">
          Live catalog from Beacon Flow. Swap, bridge, signals, vault, and Bound Work in one OS.
        </p>
        <div className="mt-12 grid gap-0 border border-line sm:grid-cols-2 lg:grid-cols-3">
          {rails.map((s) => (
            <a
              key={s.id}
              href="/flow"
              className="group border-b border-r border-line bg-surface p-5 transition-opacity hover:opacity-90"
            >
              <h3 className="font-display text-lg font-bold text-ink">{s.title}</h3>
              <p className="mt-2 text-sm text-ink-muted">{s.body}</p>
            </a>
          ))}
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
        <span className="rounded-full bg-rose px-4 py-1.5 font-mono text-[11px] tracking-wide text-ink">
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
      <div className="mx-auto max-w-6xl px-5">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="border border-dashed border-line bg-surface p-6">
            <p className="mb-4 font-mono text-[11px] uppercase tracking-widest text-ink-faint">
              Acceptance path
            </p>
            <AcceptanceDiagram />
          </div>
          <div className="border border-dashed border-line bg-surface p-6">
            <p className="mb-4 font-mono text-[11px] uppercase tracking-widest text-ink-faint">
              Payment rule
            </p>
            <EscrowDiagram />
          </div>
          <div className="border border-dashed border-line bg-surface p-6">
            <p className="mb-4 font-mono text-[11px] uppercase tracking-widest text-ink-faint">
              Preparing a job
            </p>
            <PreparingDiagram />
          </div>
          <div className="flex flex-col items-center border border-dashed border-line bg-surface p-6">
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
      <div className="mx-auto max-w-6xl px-5">
        <SectionLabel>On-chain</SectionLabel>
        <h2 className="mx-auto max-w-3xl text-center font-display text-3xl font-extrabold tracking-tight md:text-4xl">
          Real contracts on Coston2
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-sm text-ink-muted">
          Approve locks quote funds in escrow. Release only when the job passes.
        </p>
        <dl className="mx-auto mt-10 grid max-w-3xl gap-3 font-mono text-xs">
          {[
            ["Network", `${NETWORK.name} · chain ${NETWORK.chainId}`, null],
            ["Escrow", CONTRACTS.escrow, CONTRACTS.escrow],
            ["Token", CONTRACTS.token, CONTRACTS.token],
            ["Job registry", CONTRACTS.jobRegistry, CONTRACTS.jobRegistry],
          ].map(([k, v, href]) => (
            <div
              key={k}
              className="flex flex-col gap-1 border border-dashed border-line bg-paper px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
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
    <section className="bg-dusk py-24 text-paper">
      <div className="mx-auto max-w-6xl px-5 text-center">
        <h2 className="font-display text-3xl font-extrabold tracking-tight md:text-5xl">
          Open Beacon Flow
        </h2>
        <p className="mx-auto mt-4 max-w-md text-white/65">
          Talk to Flare AI OS. Quotes, policy, payments, and explorer receipts on production rails.
        </p>
        <div className="mt-8 flex justify-center">
          <FacetCtaPair left="See the path" right="Open Flow" leftTo="#how" rightTo="/flow" />
        </div>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-line bg-surface py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-5 text-sm text-ink-faint md:flex-row md:items-center">
        <p>© {new Date().getFullYear()} Beacon</p>
        <p className="font-mono text-xs">Flare AI OS. Signal to receipt.</p>
      </div>
    </footer>
  );
}
