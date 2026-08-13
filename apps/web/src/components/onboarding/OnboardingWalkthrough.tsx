import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Landmark, MessageSquare, Receipt, Shield, X } from "lucide-react";

export const ONBOARD_STORAGE_KEY = "beacon_onboarded_v1";

const STEPS = [
  {
    id: "deposit",
    title: "Deposit",
    body: "Fund Beacon Safe once. Beacon spends from that balance under your rules.",
    icon: Landmark,
    hint: "Step 1 of 4",
  },
  {
    id: "policy",
    title: "Set policy",
    body: "Cap what agents may spend. Policy checks run before every pay and execute.",
    icon: Shield,
    hint: "Step 2 of 4",
  },
  {
    id: "talk",
    title: "Talk to Beacon",
    body: "Ask in plain language. Quotes and routes appear before anything moves on-chain.",
    icon: MessageSquare,
    hint: "Step 3 of 4",
  },
  {
    id: "receipt",
    title: "Get receipt",
    body: "Every run ends with explorer-backed proof: source tx, protocol path, destination.",
    icon: Receipt,
    hint: "Step 4 of 4",
  },
] as const;

function markOnboarded() {
  try {
    localStorage.setItem(ONBOARD_STORAGE_KEY, "1");
  } catch {
    /* ignore quota / private mode */
  }
}

export function shouldShowOnboarding(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(ONBOARD_STORAGE_KEY) !== "1";
  } catch {
    return false;
  }
}

type Props = {
  open: boolean;
  onComplete: () => void;
};

export function OnboardingWalkthrough({ open, onComplete }: Props) {
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const Icon = current.icon;
  const isLast = step === STEPS.length - 1;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        markOnboarded();
        onComplete();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onComplete]);

  function finish() {
    markOnboarded();
    onComplete();
  }

  function next() {
    if (isLast) {
      finish();
      return;
    }
    setStep((s) => s + 1);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/55 p-4 sm:items-center"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduce ? undefined : { opacity: 0 }}
          transition={{ duration: 0.2 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="beacon-onboard-title"
        >
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? undefined : { opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-md overflow-hidden rounded-[var(--p-radius)] border border-[var(--p-border)] bg-[var(--p-card)] shadow-[var(--p-shadow)] pb-[env(safe-area-inset-bottom,0px)]"
          >
            <button
              type="button"
              onClick={finish}
              className="absolute right-3 top-3 grid size-8 place-items-center rounded-[var(--p-radius-sm)] text-[var(--p-faint)] hover:bg-[var(--p-hover)] hover:text-[var(--p-fg)]"
              aria-label="Skip onboarding"
            >
              <X className="size-4" />
            </button>

            <div className="px-6 pb-2 pt-8">
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--p-faint)]">
                {current.hint}
              </p>
              <div className="mt-4 flex items-center gap-3">
                <span className="grid size-11 place-items-center rounded-[var(--p-radius-sm)] bg-[var(--p-accent-soft)] text-[var(--p-accent-text)]">
                  <Icon className="size-5" strokeWidth={1.75} />
                </span>
                <h2
                  id="beacon-onboard-title"
                  className="font-display text-[22px] font-semibold tracking-tight text-[var(--p-fg)]"
                >
                  {current.title}
                </h2>
              </div>
              <AnimatePresence mode="wait">
                <motion.p
                  key={current.id}
                  initial={reduce ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? undefined : { opacity: 0, y: -4 }}
                  transition={{ duration: 0.2 }}
                  className="mt-4 text-[15px] leading-relaxed text-[var(--p-muted)]"
                >
                  {current.body}
                </motion.p>
              </AnimatePresence>

              <div className="mt-6 flex gap-1.5" aria-hidden>
                {STEPS.map((s, i) => (
                  <span
                    key={s.id}
                    className={`h-1 flex-1 rounded-full transition-colors ${
                      i <= step ? "bg-signal" : "bg-[var(--p-border)]"
                    }`}
                  />
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-[var(--p-border)] px-6 py-4">
              <button
                type="button"
                onClick={finish}
                className="min-h-10 text-[13px] text-[var(--p-faint)] hover:text-[var(--p-fg)]"
              >
                Skip
              </button>
              <div className="flex gap-2">
                {step > 0 && (
                  <button
                    type="button"
                    onClick={() => setStep((s) => Math.max(0, s - 1))}
                    className="min-h-10 rounded-[var(--p-radius-sm)] border border-[var(--p-border)] px-4 text-[13px] text-[var(--p-fg)]"
                  >
                    Back
                  </button>
                )}
                <button
                  type="button"
                  onClick={next}
                  className="min-h-10 rounded-[var(--p-radius-sm)] bg-signal px-5 text-[13px] font-medium text-[var(--p-on-accent)]"
                >
                  {isLast ? "Start Flow" : "Next"}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
