import { motion, useReducedMotion } from "motion/react";
import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SafeReveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  if (reduce) {
    return <div className={className}>{children}</div>;
  }
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

export function SafeSection({
  children,
  className,
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "rounded-[var(--p-radius)] border border-[var(--p-border)] bg-[var(--p-card)] p-5 sm:p-6",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function SafeField({
  label,
  value,
  onChange,
  string: asString,
  hint,
  disabled,
  name,
}: {
  label: string;
  value: number | string;
  onChange: (value: string | number) => void;
  string?: boolean;
  hint?: string;
  disabled?: boolean;
  name?: string;
}) {
  const autoId = useId();
  const fieldId = name ?? autoId;
  return (
    <label className="block text-sm" htmlFor={fieldId}>
      <span className="font-medium text-[var(--p-muted)]">{label}</span>
      <input
        id={fieldId}
        name={fieldId}
        type={asString ? "text" : "number"}
        min={asString ? undefined : 0}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          if (asString) onChange(e.target.value);
          else onChange(Number(e.target.value) || 0);
        }}
        className="mt-1.5 w-full rounded-[var(--p-radius-sm)] border border-[var(--p-border-strong)] bg-[var(--p-surface-2)] px-3 py-2.5 font-mono text-[var(--p-fg)] outline-none transition-colors focus:border-[var(--p-accent)] disabled:opacity-45"
      />
      {hint && <span className="mt-1 block text-[11px] text-[var(--p-faint)]">{hint}</span>}
    </label>
  );
}

export function OwnerGate({
  wallet,
  isOwner,
  onConnect,
  connecting,
}: {
  wallet: string | null;
  isOwner: boolean;
  onConnect: () => void;
  connecting: boolean;
}) {
  if (!wallet) {
    return (
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-[var(--p-radius-sm)] border border-dashed border-[var(--p-border-strong)] bg-[var(--p-surface-2)] px-4 py-3">
        <p className="flex-1 text-sm text-[var(--p-muted)]">
          Connect as the Safe owner to set limits, withdraw, or pause.
        </p>
        <button
          type="button"
          onClick={onConnect}
          disabled={connecting}
          className="rounded-full bg-[var(--p-accent)] px-4 py-2 text-sm font-medium text-[var(--p-on-accent)] disabled:opacity-50"
        >
          {connecting ? "Connecting…" : "Connect wallet"}
        </button>
      </div>
    );
  }
  if (!isOwner) {
    return (
      <p className="mt-4 rounded-[var(--p-radius-sm)] border border-[var(--p-border)] bg-[var(--p-surface-2)] px-4 py-3 text-sm text-[var(--p-muted)]">
        Connected wallet is not the Safe owner. Anyone can deposit above; policy, withdraw, and pause stay locked.
      </p>
    );
  }
  return null;
}
