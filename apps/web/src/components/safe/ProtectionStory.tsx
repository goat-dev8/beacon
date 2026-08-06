import { Lock, ShieldCheck, EyeOff } from "lucide-react";
import { SafeReveal } from "./safePrimitives";

const CARDS = [
  {
    icon: ShieldCheck,
    title: "How Beacon protects funds",
    body: "You deposit a capped budget into Beacon Safe. Agents can only spend within your daily and per-trade limits, never beyond the pool you funded.",
  },
  {
    icon: Lock,
    title: "Why safer than a hot wallet",
    body: "A connected hot wallet can approve anything. Beacon Safe is a prepaid envelope: revoke the executor, pause spending, or withdraw the rest in one move.",
  },
  {
    icon: EyeOff,
    title: "What confidential policy protects",
    body: "Your spend rules stay off the public chat surface. On Coston2 this is a Simulated TEE path (SIMULATED_TEE): hackathon-accepted confidentiality, not hardware-attested Confidential Space.",
  },
] as const;

export function ProtectionStory({
  fccMode = "unavailable",
}: {
  fccMode?: "simulated" | "unavailable" | "verified";
}) {
  return (
    <div>
      <div className="mb-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--p-accent-text)]">
          Protection story
        </p>
        <h2 className="mt-1 font-display text-xl font-semibold tracking-tight text-[var(--p-fg)]">
          Guardrails before the AI spends
        </h2>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {CARDS.map((card, i) => {
          const Icon = card.icon;
          return (
            <SafeReveal key={card.title} delay={i * 0.06}>
              <article className="h-full rounded-[var(--p-radius)] border border-[var(--p-border)] bg-[var(--p-surface)] p-4 sm:p-5">
                <span className="inline-flex size-9 items-center justify-center rounded-full bg-[var(--p-accent-soft)] text-[var(--p-accent-text)]">
                  <Icon className="size-4" strokeWidth={1.75} />
                </span>
                <h3 className="mt-3 font-display text-base font-semibold text-[var(--p-fg)]">
                  {card.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--p-muted)]">{card.body}</p>
                {i === 2 && fccMode === "simulated" && (
                  <p className="mt-3 inline-flex rounded-full border border-[var(--p-accent)]/40 bg-[var(--p-accent-soft)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--p-accent-text)]">
                    Confidential policy (simulated TEE)
                  </p>
                )}
                {i === 2 && fccMode !== "simulated" && (
                  <p className="mt-3 inline-flex rounded-full border border-[var(--p-border-strong)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--p-faint)]">
                    Server policy · FCC {fccMode}
                  </p>
                )}
              </article>
            </SafeReveal>
          );
        })}
      </div>
    </div>
  );
}
