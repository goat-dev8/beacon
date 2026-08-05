import { Workspace } from "@/components/workspace/Workspace";

/** Bound Work desk embedded inside ProductShell (/flow/desk). */
export function DeskPage() {
  return (
    <div className="h-dvh max-h-dvh overflow-auto bg-[var(--p-bg)] text-[var(--p-fg)]">
      <div className="border-b border-[var(--p-border)] bg-[var(--p-surface)] px-5 py-3">
        <p className="font-display text-lg font-semibold tracking-tight">Bound Work</p>
        <p className="text-xs text-[var(--p-muted)]">
          Escrow creative jobs on Coston2 — pay only when quality passes. Chat stays in Flow.
        </p>
      </div>
      <Workspace />
    </div>
  );
}
