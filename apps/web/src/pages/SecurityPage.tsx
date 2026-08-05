import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Shield, Loader2 } from "lucide-react";
import { api, type SecurityPolicy } from "@/lib/api";
import { connectEvmWallet, shortAddress, tryRestoreWallet } from "@/lib/wallet";
import { cn } from "@/lib/utils";

const DEFAULT_POLICY: SecurityPolicy = {
  dailySpendUsdt0: 50,
  perJobLimitUsdt0: 25,
  allowedAgents: [
    "general",
    "signals",
    "swap",
    "bridge",
    "pay",
    "trade",
    "desk",
    "image",
    "video",
    "research",
  ],
  allowedChains: [114],
  maxImageCostUsdt0: 10,
  maxVideoSeconds: 60,
  emergencyPause: false,
  sessionExpiryHours: 24,
};

const AGENT_OPTIONS = [
  "general",
  "signals",
  "swap",
  "bridge",
  "pay",
  "trade",
  "desk",
  "image",
  "video",
  "research",
];

export function SecurityPage() {
  const qc = useQueryClient();
  const [wallet, setWallet] = useState<string | null>(null);
  const [policy, setPolicy] = useState<SecurityPolicy>(DEFAULT_POLICY);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  useEffect(() => {
    void tryRestoreWallet().then((acct) => {
      if (acct) setWallet(acct);
    });
  }, []);

  const policyQuery = useQuery({
    queryKey: ["security-policy", wallet],
    queryFn: () => api.getSecurityPolicy(wallet!),
    enabled: Boolean(wallet),
  });

  useEffect(() => {
    if (policyQuery.data?.policy) setPolicy(policyQuery.data.policy);
  }, [policyQuery.data]);

  const save = useMutation({
    mutationFn: () => api.putSecurityPolicy(wallet!, policy),
    onSuccess: (data) => {
      setSavedNote(`Saved (${data.source})`);
      void qc.invalidateQueries({ queryKey: ["security-policy", wallet] });
    },
  });

  const revoke = useMutation({
    mutationFn: () => api.revokeSecurity(wallet!),
    onSuccess: (data) => {
      setSavedNote(data.message);
      void qc.invalidateQueries({ queryKey: ["security-policy", wallet] });
    },
  });

  async function onConnect() {
    const acct = await connectEvmWallet();
    setWallet(acct);
  }

  function toggleAgent(id: string) {
    setPolicy((p) => ({
      ...p,
      allowedAgents: p.allowedAgents.includes(id)
        ? p.allowedAgents.filter((a) => a !== id)
        : [...p.allowedAgents, id],
    }));
  }

  return (
    <div className="h-dvh max-h-dvh overflow-y-auto bg-[var(--p-bg)] text-[var(--p-fg)]">
      <header className="mx-auto flex max-w-3xl items-center justify-between gap-3 border-b border-[var(--p-border)] px-5 py-4">
        <div>
          <p className="flex items-center gap-2 font-display text-xl font-semibold">
            <Shield className="size-5 text-[var(--p-accent-text)]" />
            Security Center
          </p>
          <p className="text-sm text-[var(--p-muted)]">Server-enforced spend policy for Beacon on Coston2</p>
        </div>
        <div className="flex items-center gap-2">
          {wallet ? (
            <span className="rounded-full border border-[var(--p-border)] px-3 py-1.5 font-mono text-xs">{shortAddress(wallet)}</span>
          ) : (
            <button
              type="button"
              onClick={() => void onConnect()}
              className="rounded-full bg-[var(--p-accent)] px-4 py-1.5 text-sm font-medium text-[var(--p-on-accent)] transition-transform active:scale-[0.98]"
            >
              Connect
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-5 py-6 pb-16">
        {!wallet && (
          <div className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] p-6 text-sm text-[var(--p-muted)]">
            Connect your wallet to load and save spend policies. Limits are server-enforced on Bound Work approve, agent micropays, and execution risk checks when Redis is configured. Flare FCC attestation is simulated - not on-chain enforcement yet.
          </div>
        )}

        {wallet && policyQuery.data?.receipt && (
          <section className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-surface)] p-5 shadow-[var(--p-shadow)]">
            <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-accent-text)]">
              {policyQuery.data.receipt.title}
            </p>
            <p className="mt-2 font-display text-2xl font-semibold text-[var(--p-fg)]">
              Your agent gets a budget, not free rein
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-[var(--p-border)] bg-[var(--p-surface-2)] px-3 py-2.5">
                <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--p-muted)]">Spent today</p>
                <p className="mt-1 font-display text-xl">{policyQuery.data.receipt.spentTodayUsdt0} USDT0</p>
              </div>
              <div className="rounded-xl border border-[var(--p-accent)]/35 bg-[var(--p-accent-soft)] px-3 py-2.5">
                <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--p-muted)]">Remaining</p>
                <p className="mt-1 font-display text-xl text-[var(--p-accent-text)]">
                  {policyQuery.data.receipt.remainingUsdt0} USDT0
                </p>
              </div>
              <div className="rounded-xl border border-[var(--p-border)] bg-[var(--p-surface-2)] px-3 py-2.5">
                <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--p-muted)]">Per job max</p>
                <p className="mt-1 font-display text-xl">{policyQuery.data.receipt.perJobLimitUsdt0} USDT0</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-[var(--p-muted)]">{policyQuery.data.receipt.note}</p>
            <p className="mt-1 font-mono text-[10px] text-[var(--p-muted)]">
              Server-enforced policy · Coston2 · x402 + Escrow · FCC simulated · pause anytime
            </p>
          </section>
        )}

        <section className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] p-5">
          <h2 className="font-display text-lg font-semibold">Spend limits</h2>
          <p className="mt-1 text-sm text-[var(--p-muted)]">Limits are enforced by the Beacon API on every spend.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field
              label="Daily spend (USDT0)"
              value={policy.dailySpendUsdt0}
              onChange={(n) => setPolicy((p) => ({ ...p, dailySpendUsdt0: n }))}
            />
            <Field
              label="Per-job limit (USDT0)"
              value={policy.perJobLimitUsdt0}
              onChange={(n) => setPolicy((p) => ({ ...p, perJobLimitUsdt0: n }))}
            />
            <Field
              label="Max image cost (USDT0)"
              value={policy.maxImageCostUsdt0}
              onChange={(n) => setPolicy((p) => ({ ...p, maxImageCostUsdt0: n }))}
            />
            <Field
              label="Max video duration (sec)"
              value={policy.maxVideoSeconds}
              onChange={(n) => setPolicy((p) => ({ ...p, maxVideoSeconds: n }))}
            />
            <Field
              label="Session expiry (hours)"
              value={policy.sessionExpiryHours}
              onChange={(n) => setPolicy((p) => ({ ...p, sessionExpiryHours: n }))}
            />
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] p-5">
          <h2 className="font-display text-lg font-semibold">Allowed agents</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {AGENT_OPTIONS.map((id) => {
              const on = policy.allowedAgents.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleAgent(id)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs capitalize",
                    "transition-colors",
                    on
                      ? "border-[var(--p-accent)]/50 bg-[var(--p-accent-soft)] text-[var(--p-accent-text)]"
                      : "border-[var(--p-border-strong)] text-[var(--p-muted)] hover:bg-[var(--p-hover)]",
                  )}
                >
                  {id}
                </button>
              );
            })}
          </div>
          <p className="mt-3 font-mono text-[11px] text-[var(--p-faint)]">Allowed chains: Coston2 (114) only</p>
        </section>

        <section className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] p-5">
          <h2 className="font-display text-lg font-semibold">Emergency</h2>
          <label className="mt-3 flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={policy.emergencyPause}
              onChange={(e) => setPolicy((p) => ({ ...p, emergencyPause: e.target.checked }))}
              className="size-4 accent-[#3ecf8e]"
            />
            Emergency pause, block new agent spends
          </label>
          <p className="mt-3 text-xs text-[var(--p-muted)]">
            Revoke sets pause on and zeroes limits. Also revoke USDT0 allowance to the SparkDEX router in your wallet if you approved spending.
          </p>
        </section>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={!wallet || save.isPending}
            onClick={() => save.mutate()}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--p-accent)] px-5 py-2.5 text-sm font-medium text-[var(--p-on-accent)] transition-transform active:scale-[0.98] disabled:opacity-40"
          >
            {save.isPending && <Loader2 className="size-4 animate-spin" />}
            Save policy
          </button>
          <button
            type="button"
            disabled={!wallet || revoke.isPending}
            onClick={() => {
              if (confirm("Pause Beacon and clear allowances for this wallet?")) revoke.mutate();
            }}
            className="rounded-full border border-[var(--p-danger)]/45 px-5 py-2.5 text-sm text-[var(--p-danger)] transition-colors hover:bg-[var(--p-danger)]/10 disabled:opacity-40"
          >
            Revoke all
          </button>
        </div>
        {savedNote && <p className="text-sm text-[var(--p-accent-text)]">{savedNote}</p>}
      </main>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-[var(--p-muted)]">{label}</span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="mt-1.5 w-full rounded-xl border border-[var(--p-border-strong)] bg-[var(--p-surface-2)] px-3 py-2 font-mono text-[var(--p-fg)] outline-none transition-colors focus:border-[var(--p-accent)]"
      />
    </label>
  );
}
