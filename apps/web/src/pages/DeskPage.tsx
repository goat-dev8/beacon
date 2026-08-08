import { Workspace } from "@/components/workspace/Workspace";

/** Agent Jobs desk embedded inside ProductShell (/flow/desk). */
export function DeskPage() {
  return (
    <div className="h-full max-h-full overflow-y-auto bg-[var(--p-bg)] text-[var(--p-fg)]">
      <div className="border-b border-[var(--p-border)] bg-[var(--p-surface)] px-5 py-3.5">
        <p className="font-display text-lg font-semibold tracking-tight">Agent Jobs</p>
        <p className="text-xs text-[var(--p-muted)]">
          Escrow AI jobs on Coston2. Prefer Beacon Safe spend; pay only when quality passes.
        </p>
      </div>
      <Workspace embedded />
    </div>
  );
}
