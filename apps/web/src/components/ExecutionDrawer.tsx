import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { Check, ChevronDown, ChevronUp, Copy, ExternalLink, Workflow, X } from "lucide-react";
import {
  EXECUTION_PHASES,
  type ActiveExecution,
  type ExecutionPhaseId,
} from "@/lib/executionPhases";
import { explorerLabel, explorerTx } from "@/lib/explorers";
import { cn } from "@/lib/utils";

function phaseIndex(id: ExecutionPhaseId) {
  return EXECUTION_PHASES.findIndex((p) => p.id === id);
}

function shortHash(hash: string) {
  if (hash.length < 14) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

/**
 * Single mutable execution surface.
 * Desktop: right inspector only when `active` is set (no permanent empty panel).
 * Mobile: starts collapsed; never steals composer space when closed.
 */
export function ExecutionDrawer({
  active,
  onDismiss,
  onNextSuggestion,
}: {
  active: ActiveExecution | null;
  onDismiss?: () => void;
  onNextSuggestion?: (text: string) => void;
}) {
  const reducedMotion = useReducedMotion();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const currentIdx = active ? phaseIndex(active.phase) : -1;

  useEffect(() => {
    setMobileOpen(false);
    setCopied(false);
  }, [active?.msgId, active?.cardIndex]);

  const transition = reducedMotion ? { duration: 0 } : { duration: 0.28, ease: [0.16, 1, 0.3, 1] as const };

  if (!active) return null;

  async function copyHash() {
    if (!active?.primaryHash) return;
    try {
      await navigator.clipboard.writeText(active.primaryHash);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked */
    }
  }

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
                animate={{
                  opacity: upcoming ? 0.38 : 1,
                  x: reducedMotion ? 0 : current ? 2 : 0,
                }}
                transition={transition}
                className="relative flex gap-3 pb-4 last:pb-0"
              >
                {i < EXECUTION_PHASES.length - 1 && (
                  <motion.span
                    className="absolute left-[7px] top-4 w-px origin-top"
                    style={{ height: "calc(100% - 4px)" }}
                    initial={false}
                    animate={{
                      backgroundColor: done
                        ? "color-mix(in oklab, var(--color-signal) 65%, transparent)"
                        : "var(--p-border)",
                      scaleY: done || current ? 1 : 0.85,
                    }}
                    transition={transition}
                  />
                )}
                <motion.span
                  layout={!reducedMotion}
                  className={cn(
                    "relative z-10 mt-0.5 size-3.5 shrink-0 rounded-full border-2",
                    current && "border-signal bg-signal shadow-[0_0_0_3px_var(--p-accent-soft)]",
                    done && !current && "border-signal bg-signal/30",
                    upcoming && "border-[var(--p-border-strong)] bg-transparent",
                  )}
                  animate={
                    reducedMotion || !current
                      ? undefined
                      : { scale: [1, 1.12, 1] }
                  }
                  transition={
                    current && !reducedMotion
                      ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" }
                      : transition
                  }
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
                      initial={reducedMotion ? false : { opacity: 0, y: 6 }}
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

        {active.primaryHash && (
          <div className="mt-4 rounded-[var(--p-radius)] border border-[var(--p-border)] bg-[var(--p-surface)] p-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--p-faint)]">Tx hash</p>
            <p className="mt-1 font-mono text-[12px] text-[var(--p-fg)]">{shortHash(active.primaryHash)}</p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void copyHash()}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--p-radius-sm)] border border-[var(--p-border)] bg-[var(--p-card)] px-2.5 text-[12px] text-[var(--p-fg)] hover:bg-[var(--p-hover)]"
              >
                {copied ? <Check className="size-3.5 text-[var(--p-accent-text)]" /> : <Copy className="size-3.5" />}
                {copied ? "Copied" : "Copy hash"}
              </button>
              <a
                href={explorerTx(active.primaryHash, active.chainId)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--p-radius-sm)] bg-signal px-2.5 text-[12px] font-medium text-[var(--p-on-accent)]"
              >
                Open explorer
                <ExternalLink className="size-3" />
              </a>
            </div>
          </div>
        )}

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

        {active.nextSuggestion && onNextSuggestion && (
          <div className="mt-4 border-t border-[var(--p-border)] pt-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--p-faint)]">Next</p>
            <button
              type="button"
              onClick={() => onNextSuggestion(active.nextSuggestion!)}
              className="mt-2 w-full rounded-[var(--p-radius-sm)] border border-[var(--p-border)] bg-[var(--p-card)] px-3 py-2.5 text-left text-[13px] text-[var(--p-fg)] hover:border-[var(--p-border-strong)]"
            >
              {active.nextSuggestion}
            </button>
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
          initial={reducedMotion ? false : { opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reducedMotion ? undefined : { opacity: 0, x: 16 }}
          transition={transition}
          className="hidden w-72 shrink-0 flex-col border-l border-[var(--p-border)] bg-[var(--p-rail)] lg:flex xl:w-80"
          aria-label="Execution surface"
        >
          {panel}
        </motion.aside>
      </AnimatePresence>

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
              <div className="max-h-56 overflow-y-auto">{panel}</div>
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
  onNextSuggestion,
}: {
  active: ActiveExecution | null;
  onDismiss?: () => void;
  onNextSuggestion?: (text: string) => void;
}) {
  return (
    <ExecutionDrawer active={active} onDismiss={onDismiss} onNextSuggestion={onNextSuggestion} />
  );
}

/** Product name for the single mutable phase surface. */
export const ExecutionSurface = EvidencePanel;
