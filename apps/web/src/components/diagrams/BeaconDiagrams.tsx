import { motion } from "motion/react";

/** Original Beacon mark — signal rising from a base. */
/** Original Beacon mark — geometric signal tower. */
export function BeaconMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <rect x="28" y="18" width="8" height="28" rx="1" fill="currentColor" />
      <rect x="24" y="46" width="16" height="6" rx="1" fill="currentColor" />
      <path
        d="M20 28c6-8 18-8 24 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M14 22c10-12 26-12 36 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity={0.45}
      />
      <circle cx="32" cy="14" r="4" fill="currentColor" />
    </svg>
  );
}

export function BeaconWordmark({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 text-ink ${className ?? ""}`}>
      <BeaconMark className="size-7 text-ink" />
      <span className="font-display text-xl font-bold tracking-tight">Beacon</span>
    </span>
  );
}

/** Animated architecture: brief → quote → generate → check → receipt */
export function HowBeaconWorksDiagram() {
  const nodes = [
    { id: "brief", label: "Brief", x: 60, y: 120 },
    { id: "quote", label: "Quote", x: 200, y: 60 },
    { id: "gen", label: "Generate", x: 340, y: 120 },
    { id: "check", label: "Check", x: 480, y: 60 },
    { id: "done", label: "Receipt", x: 620, y: 120 },
  ];

  return (
    <svg viewBox="0 0 680 200" className="h-auto w-full" role="img" aria-label="How Beacon works">
      <defs>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {nodes.slice(0, -1).map((n, i) => {
        const next = nodes[i + 1];
        return (
          <motion.line
            key={`${n.id}-line`}
            x1={n.x + 36}
            y1={n.y}
            x2={next.x - 36}
            y2={next.y}
            stroke="#4ade80"
            strokeWidth="1.5"
            strokeDasharray="4 6"
            initial={{ pathLength: 0, opacity: 0 }}
            whileInView={{ pathLength: 1, opacity: 0.55 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, delay: i * 0.15 }}
          />
        );
      })}
      {nodes.map((n, i) => (
        <g key={n.id}>
          <motion.circle
            cx={n.x}
            cy={n.y}
            r="28"
            fill="#17151f"
            stroke="#4ade80"
            strokeWidth="1.5"
            filter="url(#glow)"
            initial={{ scale: 0.6, opacity: 0 }}
            whileInView={{ scale: 1, opacity: 1 }}
            viewport={{ once: true }}
            transition={{ type: "spring", delay: i * 0.12 }}
          />
          <motion.text
            x={n.x}
            y={n.y + 5}
            textAnchor="middle"
            fill="#e8e6ef"
            fontSize="11"
            fontFamily="IBM Plex Mono, monospace"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 + i * 0.12 }}
          >
            {n.label}
          </motion.text>
        </g>
      ))}
    </svg>
  );
}

export function AcceptanceDiagram() {
  const steps = ["Objective", "Judge", "Brand", "Look"];
  return (
    <svg viewBox="0 0 560 140" className="h-auto w-full" role="img" aria-label="Quality check flow">
      {steps.map((label, i) => {
        const x = 50 + i * 130;
        return (
          <g key={label}>
            {i < steps.length - 1 && (
              <motion.path
                d={`M${x + 44} 70 H${x + 86}`}
                stroke="#4ade80"
                strokeWidth="1.5"
                strokeDasharray="3 5"
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 0.5 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
              />
            )}
            <motion.rect
              x={x - 40}
              y={40}
              width="80"
              height="60"
              rx="12"
              fill="#12101a"
              stroke="#2a2738"
              initial={{ y: 55, opacity: 0 }}
              whileInView={{ y: 40, opacity: 1 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
            />
            <text
              x={x}
              y={75}
              textAnchor="middle"
              fill="#9a96a8"
              fontSize="11"
              fontFamily="IBM Plex Mono, monospace"
            >
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function EscrowDiagram() {
  return (
    <svg viewBox="0 0 480 160" className="h-auto w-full" role="img" aria-label="Pay only when it passes">
      <motion.rect
        x="40"
        y="40"
        width="140"
        height="80"
        rx="14"
        fill="#17151f"
        stroke="#2a2738"
        initial={{ opacity: 0, x: -10 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true }}
      />
      <text x="110" y="78" textAnchor="middle" fill="#e8e6ef" fontSize="13" fontFamily="Syne, sans-serif">
        Hold
      </text>
      <text x="110" y="98" textAnchor="middle" fill="#9a96a8" fontSize="10" fontFamily="IBM Plex Mono, monospace">
        until pass
      </text>

      <motion.path
        d="M190 80 H250"
        stroke="#4ade80"
        strokeWidth="2"
        markerEnd="url(#arrow)"
        initial={{ pathLength: 0 }}
        whileInView={{ pathLength: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.7 }}
      />

      <motion.rect
        x="260"
        y="40"
        width="160"
        height="80"
        rx="14"
        fill="#12101a"
        stroke="#4ade80"
        initial={{ opacity: 0, x: 10 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true }}
      />
      <text x="340" y="78" textAnchor="middle" fill="#4ade80" fontSize="13" fontFamily="Syne, sans-serif">
        Charge
      </text>
      <text x="340" y="98" textAnchor="middle" fill="#9a96a8" fontSize="10" fontFamily="IBM Plex Mono, monospace">
        only on pass
      </text>
    </svg>
  );
}

export function PreparingDiagram() {
  const stages = ["Fit check", "Lock quote", "Hold payment", "Generate"];
  return (
    <svg viewBox="0 0 640 120" className="h-auto w-full" role="img" aria-label="How a job is prepared">
      {stages.map((label, i) => {
        const x = 70 + i * 160;
        return (
          <g key={label}>
            {i < stages.length - 1 && (
              <motion.line
                x1={x + 48}
                y1={55}
                x2={x + 112}
                y2={55}
                stroke="#4ade80"
                strokeWidth="1.5"
                strokeDasharray="4 5"
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 0.55 }}
                viewport={{ once: true }}
              />
            )}
            <motion.circle
              cx={x}
              cy={55}
              r="22"
              fill="#17151f"
              stroke="#4ade80"
              strokeWidth="1.5"
              initial={{ scale: 0.7, opacity: 0 }}
              whileInView={{ scale: 1, opacity: 1 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
            />
            <text
              x={x}
              y={60}
              textAnchor="middle"
              fill="#e8e6ef"
              fontSize="10"
              fontFamily="IBM Plex Mono, monospace"
            >
              {String(i + 1).padStart(2, "0")}
            </text>
            <text
              x={x}
              y={98}
              textAnchor="middle"
              fill="#9a96a8"
              fontSize="11"
              fontFamily="DM Sans, sans-serif"
            >
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function ReceiptDiagram() {
  return (
    <svg viewBox="0 0 360 200" className="h-auto w-full max-w-xs" role="img" aria-label="Receipt shape">
      <motion.rect
        x="40"
        y="20"
        width="280"
        height="160"
        rx="16"
        fill="#17151f"
        stroke="#2a2738"
        initial={{ y: 30, opacity: 0 }}
        whileInView={{ y: 20, opacity: 1 }}
        viewport={{ once: true }}
      />
      <rect x="64" y="48" width="120" height="10" rx="3" fill="#4ade80" opacity="0.85" />
      <rect x="64" y="72" width="200" height="8" rx="3" fill="#2a2738" />
      <rect x="64" y="92" width="160" height="8" rx="3" fill="#2a2738" />
      <rect x="64" y="112" width="180" height="8" rx="3" fill="#2a2738" />
      <text x="64" y="152" fill="#4ade80" fontSize="12" fontFamily="Syne, sans-serif">
        Quality checks passed
      </text>
    </svg>
  );
}

export function HalftoneBeaconArt({ className }: { className?: string }) {
  const dots: Array<{ cx: number; cy: number; r: number }> = [];
  for (let y = 20; y < 360; y += 10) {
    for (let x = 20; x < 320; x += 10) {
      const dx = x - 160;
      const dy = y - 200;
      const d = Math.sqrt(dx * dx + dy * dy);
      const tower = Math.abs(dx) < 18 && y > 80 && y < 280;
      const base = d < 40 && y > 250;
      const ring = Math.abs(d - 70) < 8 || Math.abs(d - 100) < 6;
      if (tower || base || ring) {
        dots.push({ cx: x, cy: y, r: tower ? 2.2 : ring ? 1.4 : 2.6 });
      }
    }
  }

  return (
    <svg viewBox="0 0 340 380" className={className} aria-hidden>
      <defs>
        <filter id="mintGlow">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect width="340" height="380" fill="transparent" />
      <g filter="url(#mintGlow)" fill="#4ade80">
        {dots.map((d, i) => (
          <motion.circle
            key={`${d.cx}-${d.cy}`}
            cx={d.cx}
            cy={d.cy}
            r={d.r}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0.35, 0.95, 0.55] }}
            transition={{
              duration: 3.2,
              delay: (i % 24) * 0.04,
              repeat: Infinity,
              repeatType: "mirror",
            }}
          />
        ))}
      </g>
    </svg>
  );
}
