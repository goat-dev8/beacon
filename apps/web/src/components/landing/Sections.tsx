import { motion } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import {
  Clapperboard,
  Image,
  Mic,
  Presentation,
  Code2,
  Search,
  FileText,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import type { ServiceId } from "@/lib/types";
import { Skeleton } from "@/components/ui/Skeleton";
import { FacetCtaPair } from "@/components/ui/Button";
import {
  AcceptanceDiagram,
  EscrowDiagram,
  HowBeaconWorksDiagram,
  PreparingDiagram,
  ReceiptDiagram,
} from "@/components/diagrams/BeaconDiagrams";
import { PixelWave, Ruler, SectionLabel } from "@/components/landing/PixelWave";
import { CONTRACTS, NETWORK } from "@/lib/chain";

const ICONS: Record<ServiceId, LucideIcon> = {
  video: Clapperboard,
  image: Image,
  voice: Mic,
  presentations: Presentation,
  coding: Code2,
  research: Search,
  documents: FileText,
};

export function HowSection() {
  return (
    <section id="how" className="border-b border-line bg-surface py-24">
      <div className="mx-auto max-w-6xl px-5">
        <SectionLabel>Workflow</SectionLabel>
        <h2 className="mx-auto max-w-3xl text-center font-display text-3xl font-extrabold tracking-tight text-ink md:text-5xl">
          How Beacon finishes every job
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-center text-ink-muted">
          One path. Quote locks price and quality before work starts.
        </p>
        <div className="mt-12 rounded-none border border-dashed border-line bg-paper p-6 md:p-10">
          <HowBeaconWorksDiagram />
        </div>
        <ol className="mt-14 grid gap-10 md:grid-cols-3">
          {[
            {
              step: "01",
              title: "Describe once",
              body: "Pick a service and write the brief. Beacon checks it can finish the job.",
            },
            {
              step: "02",
              title: "Approve the quote",
              body: "See price, ETA, and what’s included. One approve starts the desk.",
            },
            {
              step: "03",
              title: "Pay only on pass",
              body: "Live progress, then quality checks. Fail means you are not charged.",
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
  const { data, isLoading, isError } = useQuery({
    queryKey: ["services"],
    queryFn: api.services,
  });

  return (
    <section id="services" className="border-b border-line bg-paper py-24">
      <div className="mx-auto max-w-6xl px-5">
        <SectionLabel>Services</SectionLabel>
        <h2 className="mx-auto max-w-3xl text-center font-display text-3xl font-extrabold tracking-tight md:text-5xl">
          Everything from one desk
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-center text-ink-muted">
          Live catalog from Beacon. You never bring API keys.
        </p>
        <div className="mt-12 grid gap-0 border border-line sm:grid-cols-2 lg:grid-cols-3">
          {isLoading &&
            Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-none border-b border-r border-line" />
            ))}
          {isError && (
            <p className="col-span-full p-6 text-sm text-danger">
              Could not load services from the API.
            </p>
          )}
          {data?.services.map((s) => {
            const Icon = ICONS[s.id] ?? FileText;
            return (
              <a
                key={s.id}
                href="/app"
                className="group border-b border-r border-line bg-surface p-5 transition-opacity hover:opacity-90"
              >
                <Icon className="size-5 text-ink transition-transform group-hover:scale-110" />
                <h3 className="mt-3 font-display text-lg font-bold">{s.name}</h3>
                <p className="mt-1 text-sm text-ink-muted">{s.description}</p>
              </a>
            );
          })}
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
          Checks before charge
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-white/65">
          Objective gates, a second opinion, brand rules, and a human look when confidence is low.
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
          Open Beacon. Finish the work.
        </h2>
        <p className="mx-auto mt-4 max-w-md text-white/65">
          Start a job on the live desk. Quotes, wallets, and progress hit production APIs and contracts.
        </p>
        <div className="mt-8 flex justify-center">
          <FacetCtaPair left="See pricing" right="Start now" leftTo="#how" rightTo="/app" />
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
        <p className="font-mono text-xs">Finish AI work. Pay only when it passes.</p>
      </div>
    </footer>
  );
}
