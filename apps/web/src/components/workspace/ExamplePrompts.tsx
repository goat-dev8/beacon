import { motion, useReducedMotion } from "motion/react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export type ExampleChip = string | { label: string; prompt: string };

function chipLabel(example: ExampleChip): string {
  return typeof example === "string" ? example : example.label;
}

function chipPrompt(example: ExampleChip): string {
  return typeof example === "string" ? example : example.prompt;
}

export function ExamplePrompts({
  examples,
  value,
  onPick,
}: {
  examples: ExampleChip[];
  value: string;
  onPick: (text: string) => void;
}) {
  const reduce = useReducedMotion();
  if (!examples.length) return null;

  const selected = value.trim();

  return (
    <div className="mt-5">
      <p className="mb-2.5 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-signal-deep">
        <Sparkles className="size-3.5" aria-hidden />
        Tap an example to fill the brief
      </p>
      <div className="flex flex-wrap gap-2">
        {examples.map((example, i) => {
          const label = chipLabel(example);
          const prompt = chipPrompt(example);
          const active = selected === prompt;
          return (
            <motion.button
              key={prompt}
              type="button"
              initial={reduce ? false : { opacity: 0, y: 10, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{
                delay: reduce ? 0 : 0.06 * i,
                type: "spring",
                stiffness: 420,
                damping: 28,
              }}
              whileHover={reduce ? undefined : { y: -2, scale: 1.02 }}
              whileTap={reduce ? undefined : { scale: 0.98 }}
              onClick={() => onPick(prompt)}
              aria-pressed={active}
              className={cn(
                "max-w-full rounded-full border px-3.5 py-2 text-left text-sm font-medium leading-snug text-ink",
                active
                  ? "border-signal bg-signal shadow-[0_0_0_1px_var(--color-signal)]"
                  : "border-signal/70 bg-signal/15 hover:border-signal hover:bg-signal/25",
                i === 0 && !active && !reduce && "example-chip-ping",
              )}
            >
              {label}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
