import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, ChevronUp, ExternalLink, Workflow } from "lucide-react";
import {
  EXECUTION_PHASES,
  type ActiveExecution,
  type ExecutionPhaseId,
} from "@/lib/executionPhases";
import { cn } from "@/lib/utils";

function phaseIndex(id: ExecutionPhaseId) {
  return EXECUTION_PHASES.findIndex((p) => p.id === id);
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export function ExecutionDrawer({ active }: { active: ActiveExecution | null }) {
  const reducedMotion = usePrefersReducedMotion();
  const [mobileOpen, setMobileOpen] = useState(true);
  const currentIdx = active ? phaseIndex(active.phase) : -1;

  const transition = reducedMotion ? { duration: 0 } : { duration: 0.22, ease: "easeOut" as const };

  const panel = active ? (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <Workflow className="size-4 text-signal" />
          <p className="font-mono text-[10px] uppercase tracking-widest text-white/45">Execution</p>
        </div>
        <p className="mt-1 font-display text-sm font-semibold text-white">{active.title}</p>
        <p className="mt-0.5 text-xs text-white/55">{active.summary}</p>
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
                animate={{ opacity: upcoming ? 0.45 : 1 }}
                transition={transition}
                className="relative flex gap-3 pb-4 last:pb-0"
              >
                {i < EXECUTION_PHASES.length - 1 && (
                  <span
                    className={cn(
                      "absolute left-[7px] top-4 h-[calc(100%-4px)] w-px",
                      done ? "bg-signal/60" : "bg-white/10",
                    )}
                  />
                )}
                <span
                  className={cn(
                    "relative z-10 mt-0.5 size-3.5 shrink-0 rounded-full border-2",
                    current && "border-signal bg-signal shadow-[0_0_8px_rgba(57,224,138,0.45)]",
                    done && !current && "border-signal bg-signal/30",
                    upcoming && "border-white/20 bg-transparent",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-xs font-medium",
                      current ? "text-signal" : done ? "text-white/75" : "text-white/40",
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
                          className="flex items-center justify-between gap-2 rounded-lg bg-black/25 px-2.5 py-1.5 text-[11px]"
                        >
                          <span className="text-white/65">{step.label}</span>
                          <span className="font-mono text-white/35">{step.status === "idle" ? "ready" : step.status}</span>
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
          <div className="mt-4 border-t border-white/10 pt-3">
            <p className="font-mono text-[10px] uppercase tracking-widest text-white/35">Explorer</p>
            <div className="mt-2 flex flex-col gap-1.5">
              {active.explorerLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-signal hover:underline"
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
  ) : (
    <div className="flex h-full flex-col items-center justify-center px-4 py-8 text-center">
      <Workflow className="size-8 text-white/15" />
      <p className="mt-3 text-sm text-white/45">No active execution</p>
      <p className="mt-1 text-xs text-white/30">Swap, bridge, or pay cards appear here</p>
    </div>
  );

  return (
    <>
      {/* Desktop — sticky right panel */}
      <AnimatePresence mode="wait">
        <motion.aside
          key={active?.msgId ?? "empty"}
          initial={reducedMotion ? false : { opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reducedMotion ? undefined : { opacity: 0, x: 12 }}
          transition={transition}
          className="hidden w-72 shrink-0 flex-col border-l border-white/10 bg-[#0d100e] lg:flex xl:w-80"
        >
          {panel}
        </motion.aside>
      </AnimatePresence>

      {/* Mobile — bottom sheet */}
      <div className="shrink-0 border-t border-white/10 bg-[#0d100e] lg:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen((o) => !o)}
          className="flex w-full items-center justify-between px-4 py-2.5 text-left"
        >
          <div className="flex items-center gap-2">
            <Workflow className="size-4 text-signal" />
            <span className="text-sm font-medium text-white">
              {active ? active.title : "Execution"}
            </span>
            {active && (
              <span className="rounded-full bg-signal/15 px-2 py-0.5 font-mono text-[10px] text-signal">
                {EXECUTION_PHASES.find((p) => p.id === active.phase)?.label}
              </span>
            )}
          </div>
          {mobileOpen ? (
            <ChevronDown className="size-4 text-white/40" />
          ) : (
            <ChevronUp className="size-4 text-white/40" />
          )}
        </button>
        <AnimatePresence initial={false}>
          {mobileOpen && (
            <motion.div
              initial={reducedMotion ? false : { height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={reducedMotion ? undefined : { height: 0, opacity: 0 }}
              transition={transition}
              className="overflow-hidden border-t border-white/10"
            >
              <div className="max-h-56 overflow-y-auto">{panel}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
