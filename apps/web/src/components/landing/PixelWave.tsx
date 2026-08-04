import { motion } from "motion/react";

/** Original pixelated wave transition — Beacon signal, not a third-party asset. */
export function PixelWave({ className }: { className?: string }) {
  const cols = 96;
  const rows = 18;
  const cells: Array<{ x: number; y: number; s: number }> = [];
  for (let x = 0; x < cols; x++) {
    const t = x / cols;
    const wave =
      0.45 +
      0.22 * Math.sin(t * Math.PI * 4) +
      0.12 * Math.sin(t * Math.PI * 9 + 0.4) +
      0.08 * Math.sin(t * Math.PI * 2.2);
    const top = Math.floor((1 - wave) * rows);
    for (let y = top; y < rows; y++) {
      const depth = (y - top) / Math.max(1, rows - top);
      const s = depth < 0.15 ? 3 : depth < 0.4 ? 2 : 1;
      cells.push({ x, y, s });
    }
  }

  return (
    <svg
      viewBox={`0 0 ${cols * 4} ${rows * 4}`}
      className={className}
      preserveAspectRatio="none"
      aria-hidden
    >
      <rect width="100%" height="100%" fill="#f4f3f1" />
      {cells.map((c, i) => (
        <motion.rect
          key={`${c.x}-${c.y}`}
          x={c.x * 4}
          y={c.y * 4}
          width={c.s === 3 ? 3.2 : c.s === 2 ? 2.4 : 1.6}
          height={c.s === 3 ? 3.2 : c.s === 2 ? 2.4 : 1.6}
          fill="#2a2735"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.35, delay: (i % 40) * 0.008 }}
        />
      ))}
    </svg>
  );
}

export function SectionLabel({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <p
      className={`mb-3 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint ${className ?? ""}`}
    >
      [ {children} ]
    </p>
  );
}

export function Ruler() {
  return <div className="mx-auto mt-10 h-3 w-full max-w-3xl ruler-ticks opacity-40" aria-hidden />;
}
