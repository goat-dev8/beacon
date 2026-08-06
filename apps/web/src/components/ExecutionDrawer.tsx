import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { ChevronDown, ChevronUp, ExternalLink, Workflow, X } from "lucide-react";
import {
  EXECUTION_PHASES,
  type ActiveExecution,
  type ExecutionPhaseId,
} from "@/lib/executionPhases";
import { explorerLabel } from "@/lib/explorers";
import { cn } from "@/lib/utils";

function phaseIndex(id: ExecutionPhaseId) {
  return EXECUTION_PHASES.findIndex((p) => p.id === id);
}

/**
 * Single mutable execution surface.
 * Desktop: right inspector only when `active` is set (no permanent empty panel).
 * Mobile: starts collapsed; never steals composer space when closed.
 */
export function ExecutionDrawer({
  active,
  onDismiss,
}: {
  active: ActiveExecution | null;
  onDismiss?: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const [mobileOpen, setMobileOpen] = useState(false);
  const currentIdx = active ? phaseIndex(active.phase) : -1;

  // Reset mobile sheet closed when work changes; user opens intentionally.
  useEffect(() => {
    setMobileOpen(false);
  }, [active?.msgId, active?.cardIndex]);

  const transition = reducedMotion ? { duration: 0 } : { duration: 0.22, ease: [0.16, 1, 0.3, 1] as const };

  if (!active) return null;

  const panel = (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-[var(--p-border)] px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Workflow className="size-4 shrink-0 text-[var(--p-accent-text)]" />
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--p-faint)]">
                Execution · {explorerLabel(active.chainId)}
              </p>
            </div>
            <p className="mt-1 font-display text-[14px] font-semibold text-[var(--p-fg)]">{active.title}</p>
            <p className="mt-0.5 text-[13px] text-[var(--p-muted)]">{active.summary}</p>
          </div>
          {active.dismissible && onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="grid size-8 shrink-0 place-items-center rounded-[var(--p-radius-sm)] text-[var(--p-faint)] hover:bg-[var(--p-hover)] hover:text-[var(--p-fg)]"
              aria-label="Dismiss execution panel"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <ol className="relative space-y-0">
          {EXECUTION_PHASES.map((phase, i) => {
            const done = currentIdx > i;
            const current = currentIdx === i;
            const upcoming = currentIdx < i;
            return (
              <motion.li
                key={phase.id}
                layout={!reducedMotion}
                initial={false}
                animate={{ opacity: upcoming ? 0.4 : 1 }}
                transition={transition}
                className="relative flex gap-3 pb-4 last:pb-0"
              >
                {i < EXECUTION_PHASES.length - 1 && (
                  <span
                    className={cn(
                      "absolute left-[7px] top-4 h-[calc(100%-4px)] w-px",
                      done ? "bg-signal/60" : "bg-[var(--p-border)]",
                    )}
                  />
                )}
                <span
                  className={cn(
                    "relative z-10 mt-0.5 size-3.5 shrink-0 rounded-full border-2",
                    current && "border-signal bg-signal",
                    done && !current && "border-signal bg-signal/30",
                    upcoming && "border-[var(--p-border-strong)] bg-transparent",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-[13px] font-medium",
                      current ? "text-[var(--p-accent-text)]" : done ? "text-[var(--p-fg)]" : "text-[var(--p-faint)]",
                    )}
                  >
                    {phase.label}
                  </p>
                  {current && active.steps.length > 0 && (
                    <motion.ul
                      key={active.phase}
                      initial={reducedMotion ? false : { opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={transition}
                      className="mt-2 space-y-1.5"
                    >
                      {active.steps.map((step) => (
                        <li
                          key={step.label}
                          className="flex items-center justify-between gap-2 rounded-[var(--p-radius-sm)] bg-[var(--p-surface-2)] px-2.5 py-1.5 text-[12px]"
                        >
                          <span className="text-[var(--p-fg)]">{step.label}</span>
                          <span className="font-mono text-[var(--p-faint)]">
                            {step.status === "idle" ? "ready" : step.status}
                          </span>
                        </li>
                      ))}
                    </motion.ul>
                  )}
                </div>
              </motion.li>
            );
          })}
        </ol>

        {active.explorerLinks.length > 0 && (
          <div className="mt-4 border-t border-[var(--p-border)] pt-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--p-faint)]">Explorer</p>
            <div className="mt-2 flex flex-col gap-1.5">
              {active.explorerLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-9 items-center gap-1.5 text-[13px] text-[var(--p-accent-text)] hover:underline"
                >
                  {link.label}
                  <ExternalLink className="size-3" />
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      <AnimatePresence mode="wait">
        <motion.aside
          key={`${active.msgId}:${active.cardIndex}`}
          initial={reducedMotion ? false : { opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reducedMotion ? undefined : { opacity: 0, x: 12 }}
          transition={transition}
          className="hidden w-72 shrink-0 flex-col border-l border-[var(--p-border)] bg-[var(--p-rail)] lg:flex xl:w-80"
          aria-label="Execution surface"
        >
          {panel}
        </motion.aside>
      </AnimatePresence>

      {/* Mobile: collapsed by default; expands above composer without replacing it permanently */}
      <div className="shrink-0 border-t border-[var(--p-border)] bg-[var(--p-rail)] lg:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen((o) => !o)}
          className="flex min-h-11 w-full items-center justify-between px-4 py-2.5 text-left"
          aria-expanded={mobileOpen}
        >
          <div className="flex min-w-0 items-center gap-2">
            <Workflow className="size-4 shrink-0 text-[var(--p-accent-text)]" />
            <span className="truncate text-[14px] font-medium text-[var(--p-fg)]">{active.title}</span>
            <span className="shrink-0 rounded-full bg-signal/15 px-2 py-0.5 font-mono text-[10px] text-[var(--p-accent-text)]">
              {EXECUTION_PHASES.find((p) => p.id === active.phase)?.label}
            </span>
          </div>
          {mobileOpen ? (
            <ChevronDown className="size-4 shrink-0 text-[var(--p-faint)]" />
          ) : (
            <ChevronUp className="size-4 shrink-0 text-[var(--p-faint)]" />
          )}
        </button>
        <AnimatePresence initial={false}>
          {mobileOpen && (
            <motion.div
              initial={reducedMotion ? false : { height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={reducedMotion ? undefined : { height: 0, opacity: 0 }}
              transition={transition}
              className="overflow-hidden border-t border-[var(--p-border)]"
            >
              <div className="max-h-48 overflow-y-auto">{panel}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}

/** Right inspector: only mounts when there is active work. */
export function EvidencePanel({
  active,
  onDismiss,
}: {
  active: ActiveExecution | null;
  onDismiss?: () => void;
}) {
  return <ExecutionDrawer active={active} onDismiss={onDismiss} />;
}

/** Product name for the single mutable phase surface. */
export const ExecutionSurface = EvidencePanel;
