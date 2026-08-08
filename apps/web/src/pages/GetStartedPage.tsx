import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { MoneyPathDiagram } from "@/components/diagrams/MoneyPathDiagram";
import { BeaconMark } from "@/components/diagrams/BeaconDiagrams";
import { ProductWalletProvider, useProductWallet } from "@/lib/productWallet";
import { NETWORK } from "@/lib/chain";
import { cn } from "@/lib/utils";

export const ONBOARD_STORAGE_KEY = "beacon_onboarded_v2";

const STEPS = [
  {
    id: "welcome",
    title: "Welcome to Beacon",
    body: "Flare AI OS. You will learn the money path before chat opens.",
    diagram: 0,
  },
  {
    id: "wallet",
    title: "Connect your wallet",
    body: "Coston2 only. MetaMask or Rabby. Beacon never asks for seed phrases.",
    diagram: 0,
  },
  {
    id: "safe",
    title: "Beacon Safe",
    body: "A prepaid spend envelope. Deposit USDT0 once. Agents pull only what policy allows.",
    diagram: 1,
  },
  {
    id: "why-safe",
    title: "Why Safe exists",
    body: "A hot wallet can approve anything. Safe holds a capped budget you can pause, revoke, or withdraw.",
    diagram: 1,
  },
  {
    id: "policy",
    title: "Spending policy",
    body: "Per-trade limit, rolling budget, session length. Every settle is checked before pay.",
    diagram: 2,
  },
  {
    id: "fcc",
    title: "FCC on Coston2",
    body: "Policy stays off the public chat surface. Hackathon mode uses SIMULATED_TEE, not hardware-attested Confidential Space.",
    diagram: 2,
  },
  {
    id: "x402",
    title: "x402 payments",
    body: "HTTP-native pay with MockUSDT0 EIP-3009. Jobs prefer Safe prepaid escrow; wallet auth is fallback.",
    diagram: 3,
  },
  {
    id: "execute",
    title: "AI executes on Flare",
    body: "Swap, bridge, signals, portfolio, yield, FAssets, research. Rails include FTSO, SparkDEX, LayerZero.",
    diagram: 4,
  },
  {
    id: "receipt",
    title: "Receipts and explorer",
    body: "Every run ends with proof: source tx, protocol path, destination. Open it on the Coston2 explorer.",
    diagram: 5,
  },
  {
    id: "fund",
    title: "Fund Beacon Safe",
    body: "Deposit a small test budget next. Then open Flow and ask for a swap, bridge, or research job.",
    diagram: 6,
  },
  {
    id: "done",
    title: "You are ready",
    body: "Deposit when you want. Policy is yours. Flow is next.",
    diagram: 6,
  },
] as const;

function markOnboarded() {
  try {
    localStorage.setItem(ONBOARD_STORAGE_KEY, "1");
    localStorage.setItem("beacon_onboarded_v1", "1");
  } catch {
    /* ignore */
  }
}

export function shouldShowGetStarted(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(ONBOARD_STORAGE_KEY) !== "1";
  } catch {
    return true;
  }
}

function GetStartedInner() {
  const reduce = useReducedMotion();
  const navigate = useNavigate();
  const { wallet, connecting, connect, ready } = useProductWallet();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const needsWallet = current.id === "wallet";

  const shortWallet = useMemo(() => {
    if (!wallet) return null;
    return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
  }, [wallet]);

  async function onConnect() {
    setError(null);
    try {
      await connect();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wallet connect failed");
    }
  }

  function next() {
    if (needsWallet && !wallet) {
      void onConnect();
      return;
    }
    if (isLast) {
      markOnboarded();
      navigate("/flow");
      return;
    }
    setStep((s) => s + 1);
  }

  function skip() {
    markOnboarded();
    navigate("/flow");
  }

  return (
    <div className="relative min-h-[100dvh] overflow-x-hidden bg-paper text-ink">
      <div
        className="pointer-events-none absolute inset-0 opacity-80"
        style={{
          background:
            "radial-gradient(ellipse 70% 50% at 80% 0%, rgba(57,224,138,0.16), transparent 55%), radial-gradient(ellipse 40% 40% at 10% 100%, rgba(42,39,53,0.06), transparent 50%)",
        }}
        aria-hidden
      />

      <header className="relative z-10 mx-auto flex h-16 max-w-5xl items-center justify-between px-5">
        <Link to="/" className="inline-flex items-center gap-2.5">
          <BeaconMark className="size-7" />
          <span className="font-display text-lg font-bold tracking-tight">Beacon</span>
        </Link>
        <button
          type="button"
          onClick={skip}
          className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint hover:text-ink"
        >
          Skip to Flow
        </button>
      </header>

      <main className="relative z-10 mx-auto grid max-w-5xl gap-10 px-5 pb-24 pt-6 lg:grid-cols-[1fr_1.05fr] lg:items-center lg:pt-10">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-signal-deep">
            {String(step + 1).padStart(2, "0")} / {String(STEPS.length).padStart(2, "0")}
          </p>
          <AnimatePresence mode="wait">
            <motion.div
              key={current.id}
              initial={reduce ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -10 }}
              transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            >
              <h1 className="mt-3 font-display text-4xl font-extrabold tracking-tight text-ink md:text-5xl">
                {current.title}
              </h1>
              <p className="mt-4 max-w-md text-lg leading-relaxed text-ink-muted">{current.body}</p>
            </motion.div>
          </AnimatePresence>

          {needsWallet && (
            <div className="mt-6 rounded-[12px] border border-line bg-surface p-4">
              <p className="text-sm text-ink-muted">
                Network: {NETWORK.name} (chain {NETWORK.chainId})
              </p>
              {ready && wallet ? (
                <p className="mt-2 font-mono text-sm text-signal-deep">Connected {shortWallet}</p>
              ) : (
                <p className="mt-2 text-sm text-ink-faint">No wallet connected yet.</p>
              )}
              {error && <p className="mt-2 text-sm text-danger">{error}</p>}
            </div>
          )}

          {current.id === "fund" && (
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                to="/flow/security"
                className="inline-flex h-11 items-center bg-dusk px-5 font-display text-sm text-paper clip-facet-left"
                onClick={() => markOnboarded()}
              >
                Open Safe deposit
              </Link>
            </div>
          )}

          <div className="mt-10 flex flex-wrap items-center gap-3">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                className="h-11 rounded-[10px] border border-line bg-surface px-5 font-display text-sm text-ink hover:bg-paper-2"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={() => void next()}
              disabled={needsWallet && connecting}
              className="h-11 bg-signal px-7 font-display text-sm font-semibold text-ink clip-facet-right hover:brightness-105 disabled:opacity-50"
            >
              {needsWallet && !wallet
                ? connecting
                  ? "Connecting…"
                  : "Connect wallet"
                : isLast
                  ? "Open Beacon Flow"
                  : "Continue"}
            </button>
          </div>

          <div className="mt-8 flex flex-wrap gap-1.5" aria-hidden>
            {STEPS.map((s, i) => (
              <span
                key={s.id}
                className={cn(
                  "h-1.5 w-6 rounded-full transition-colors",
                  i === step ? "bg-signal" : i < step ? "bg-dusk" : "bg-line",
                )}
              />
            ))}
          </div>
        </div>

        <div className="rounded-[12px] border border-line bg-surface p-5 md:p-8">
          <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
            Money path
          </p>
          <MoneyPathDiagram activeIndex={current.diagram} autoPlay={false} />
          <div className="mt-8 space-y-3 border-t border-line pt-6 text-sm text-ink-muted">
            <p>
              Wallet funds Safe. Policy and FCC gate AI. Execution hits Flare. Receipt opens on explorer.
            </p>
            <a
              href={NETWORK.explorer}
              target="_blank"
              rel="noreferrer"
              className="inline-flex font-mono text-[12px] text-signal-deep underline"
            >
              {NETWORK.explorer.replace("https://", "")}
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}

export function GetStartedPage() {
  return (
    <ProductWalletProvider>
      <GetStartedInner />
    </ProductWalletProvider>
  );
}
