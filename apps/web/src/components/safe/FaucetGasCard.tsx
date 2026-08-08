import { ExternalLink, Droplets } from "lucide-react";

export const COSTON2_FAUCET_URL = "https://faucet.flare.network/coston2";

/**
 * Gas prep step before Create Safe / deposits.
 * Faucet C2FLR pays MetaMask gas. Beacon Safe rails still use MockUSDT0 (EIP-3009).
 */
export function FaucetGasCard() {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
      <div
        className="pointer-events-none absolute -right-16 -top-16 size-40 rounded-full opacity-40"
        style={{
          background:
            "radial-gradient(circle, color-mix(in oklab, var(--p-accent) 28%, transparent), transparent 70%)",
        }}
        aria-hidden
      />
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 max-w-xl">
          <p className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--p-accent-text)]">
            <Droplets className="size-3" strokeWidth={2} />
            Step 1 · Gas
          </p>
          <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-[var(--p-fg)]">
            Get C2FLR before you create a Safe
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--p-muted)]">
            Paste your wallet on the official Flare faucet and request{" "}
            <span className="font-medium text-[var(--p-fg)]">C2FLR</span> for gas. Creating a Safe,
            depositing, and setting policy each need a small on-chain fee.
          </p>
          <p className="mt-3 text-xs leading-relaxed text-[var(--p-faint)]">
            Faucet also offers USDT0 and FXRP for other Flare demos. Beacon Safe / Jobs / x402 deposit
            and spend use <span className="font-mono text-[var(--p-muted)]">MockUSDT0</span> (mint on
            this page) — the EIP-3009 token Flare documents for x402.
          </p>
        </div>
        <a
          href={COSTON2_FAUCET_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-[var(--p-accent)] px-5 py-2.5 text-sm font-medium text-[var(--p-on-accent)] transition-transform hover:brightness-105 active:scale-[0.98]"
        >
          Open Coston2 faucet
          <ExternalLink className="size-3.5" strokeWidth={2} />
        </a>
      </div>
    </section>
  );
}
