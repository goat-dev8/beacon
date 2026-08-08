import { motion, useReducedMotion } from "motion/react";
import { AnimatePresence } from "motion/react";
import { X } from "lucide-react";
import { SectionLabel } from "@/components/landing/PixelWave";

export const WHY_FLARE_ITEMS = [
  {
    id: "ftso",
    title: "Live prices you can trust",
    body: "Flare's price feeds (FTSO) keep quotes honest before you swap or bridge. Beacon shows the signal, then the number.",
  },
  {
    id: "fassets",
    title: "Assets that stay useful",
    body: "FAssets bring non-smart-contract value onto Flare so you can trade, bridge, and settle without leaving the rails.",
  },
  {
    id: "fcc",
    title: "Private policy checks",
    body: "Flare Confidential Compute can evaluate spend rules away from a hot key. On Coston2 Beacon uses SIMULATED_TEE (hackathon-accepted), not hardware-attested Confidential Space.",
  },
  {
    id: "fdc",
    title: "Proofs from outside Flare",
    body: "Flare Data Connector attests external facts so Beacon can refuse invented hashes and fake receipts.",
  },
  {
    id: "x402",
    title: "Pay for work, not hope",
    body: "x402 lets agents settle exact amounts with a receipt. Spend policy gates every payment first.",
  },
  {
    id: "oft",
    title: "Move value across chains",
    body: "LayerZero OFT bridges FXRP with a source transaction, protocol path, and destination receipt you can open.",
  },
  {
    id: "smart-accounts",
    title: "Safe with rules",
    body: "Smart accounts and Beacon Safe hold funds under your policy. Deposit once. Agents act inside the budget.",
  },
] as const;

/** Full landing section. */
export function WhyFlareSection() {
  const reduce = useReducedMotion();

  return (
    <section id="why-flare" className="border-b border-line bg-paper py-28 md:py-36">
      <div className="mx-auto max-w-6xl px-5">
        <SectionLabel>Why Flare</SectionLabel>
        <h2 className="mx-auto max-w-3xl text-center font-display text-3xl font-extrabold tracking-tight text-ink md:text-5xl">
          Built on rails that prove themselves
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-center text-ink-muted">
          Beacon is Flare AI OS. Every capability maps to something you can verify: prices, assets, payments, bridges, and policy.
        </p>

        <div className="mt-14 grid grid-flow-dense gap-0 border border-dashed border-line sm:grid-cols-2 lg:grid-cols-3">
          {WHY_FLARE_ITEMS.map((item, i) => (
            <motion.article
              key={item.id}
              initial={reduce ? false : { opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ delay: reduce ? 0 : i * 0.05, duration: 0.4 }}
              className="border-b border-r border-dashed border-line bg-surface p-6 md:p-7"
            >
              <h3 className="font-display text-lg font-bold tracking-tight text-ink">{item.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-ink-muted">{item.body}</p>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Compact drawer for Flow top bar / discovery. */
export function WhyFlareDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const reduce = useReducedMotion();

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            aria-label="Close Why Flare"
            className="fixed inset-0 z-[70] bg-black/45"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduce ? undefined : { opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="why-flare-drawer-title"
            initial={reduce ? false : { x: "100%" }}
            animate={{ x: 0 }}
            exit={reduce ? undefined : { x: "100%" }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-y-0 right-0 z-[71] flex w-full max-w-md flex-col border-l border-[var(--p-border)] bg-[var(--p-rail)] shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-[var(--p-border)] px-5 py-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--p-faint)]">
                  Flare rails
                </p>
                <h2
                  id="why-flare-drawer-title"
                  className="font-display text-[16px] font-semibold text-[var(--p-fg)]"
                >
                  Why Flare
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="grid size-9 place-items-center rounded-[var(--p-radius-sm)] text-[var(--p-faint)] hover:bg-[var(--p-hover)] hover:text-[var(--p-fg)]"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <p className="mb-5 text-[13px] leading-relaxed text-[var(--p-muted)]">
                Beacon runs on Flare so every quote, payment, and bridge can end in a receipt you can open.
              </p>
              <ul className="space-y-4">
                {WHY_FLARE_ITEMS.map((item) => (
                  <li
                    key={item.id}
                    className="rounded-[var(--p-radius)] border border-[var(--p-border)] bg-[var(--p-card)] p-4"
                  >
                    <h3 className="font-display text-[14px] font-semibold text-[var(--p-fg)]">
                      {item.title}
                    </h3>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--p-muted)]">{item.body}</p>
                  </li>
                ))}
              </ul>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
