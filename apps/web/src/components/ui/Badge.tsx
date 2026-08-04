import { cn } from "@/lib/utils";

export function Badge({
  children,
  className,
  tone = "default",
}: {
  children: React.ReactNode;
  className?: string;
  tone?: "default" | "signal" | "warn" | "danger";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-[11px] tracking-wide uppercase",
        tone === "default" && "border border-line bg-paper-2 text-ink-muted",
        tone === "signal" && "bg-signal/25 text-ink border border-signal/50",
        tone === "warn" && "bg-warn/15 text-warn border border-warn/30",
        tone === "danger" && "bg-danger/10 text-danger border border-danger/30",
        className,
      )}
    >
      {children}
    </span>
  );
}
