import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Shield, Loader2, ExternalLink, Pause, Play, Ban } from "lucide-react";
import { api, type SecurityPolicy, type AgentVaultStatus } from "@/lib/api";
import { shortAddress, executeAgentVaultPrep } from "@/lib/wallet";
import { useProductWallet } from "@/lib/productWallet";
import { CONTRACTS, NETWORK } from "@/lib/chain";
import { cn } from "@/lib/utils";
import type { Address, Hex } from "viem";

const DEFAULT_POLICY: SecurityPolicy = {
  dailySpendUsdt0: 50,
  perJobLimitUsdt0: 25,
  allowedAgents: [
    "general",
    "signals",
    "intel",
    "portfolio",
    "fassets",
    "swap",
    "liquidity",
    "bridge",
    "crosschain",
    "xrpfi",
    "yield",
    "risk",
    "treasury",
    "pay",
    "trade",
    "desk",
    "image",
    "research",
  ],
  allowedChains: [114, 14],
  maxImageCostUsdt0: 10,
  maxVideoSeconds: 60,
  emergencyPause: false,
  sessionExpiryHours: 24,
};

const AGENT_OPTIONS = [
  "general",
  "signals",
  "intel",
  "portfolio",
  "fassets",
  "swap",
  "liquidity",
  "bridge",
  "crosschain",
  "xrpfi",
  "yield",
  "risk",
  "treasury",
  "pay",
  "trade",
  "desk",
  "image",
  "research",
];

function vaultConfigured(s: AgentVaultStatus | undefined): s is Extract<AgentVaultStatus, { configured: true }> {
  return Boolean(s && s.configured);
}

export function SecurityPage() {
  const qc = useQueryClient();
  const { wallet, connect, connecting } = useProductWallet();
  const [policy, setPolicy] = useState<SecurityPolicy>(DEFAULT_POLICY);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [txNote, setTxNote] = useState<string | null>(null);
  const [amount, setAmount] = useState("10");
  const [maxSpend, setMaxSpend] = useState("5");
  const [windowBudget, setWindowBudget] = useState("50");
  const [windowSeconds, setWindowSeconds] = useState(86400);
  const [sessionHours, setSessionHours] = useState(24);

  const vaultAddress = CONTRACTS.agentVault || undefined;

  const vaultQuery = useQuery({
    queryKey: ["agent-vault-status", vaultAddress ?? "unset"],
    queryFn: () => api.getVaultStatus(vaultAddress),
    refetchInterval: 30_000,
  });

  const policyQuery = useQuery({
    queryKey: ["security-policy", wallet],
    queryFn: () => api.getSecurityPolicy(wallet!),
    enabled: Boolean(wallet),
  });

  useEffect(() => {
    if (policyQuery.data?.policy) setPolicy(policyQuery.data.policy);
  }, [policyQuery.data]);

  const status = vaultQuery.data?.status;
  const live = vaultConfigured(status) ? status : null;
  const isOwner = Boolean(
    wallet && live && wallet.toLowerCase() === live.owner.toLowerCase(),
  );

  const save = useMutation({
    mutationFn: () => api.putSecurityPolicy(wallet!, policy),
    onSuccess: (data) => {
      setSavedNote(`API gates saved (${data.source})`);
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

  const vaultTx = useMutation({
    mutationFn: async (
      body: Parameters<typeof api.prepareVault>[0],
    ) => {
      const { prep } = await api.prepareVault({
        ...body,
        address: vaultAddress,
      });
      const result = await executeAgentVaultPrep({
        to: prep.to as Address,
        data: prep.data as Hex,
        approveTo: prep.approveTo as Address | undefined,
        approveData: prep.approveData as Hex | undefined,
      });
      return { prep, result };
    },
    onSuccess: ({ result }) => {
      setTxNote(`Confirmed ${shortAddress(result.txHash)}`);
      void qc.invalidateQueries({ queryKey: ["agent-vault-status"] });
    },
    onError: (err) => {
      setTxNote(err instanceof Error ? err.message : String(err));
    },
  });

  async function onConnect() {
    await connect();
  }

  function toggleAgent(id: string) {
    setPolicy((p) => ({
      ...p,
      allowedAgents: p.allowedAgents.includes(id)
        ? p.allowedAgents.filter((a) => a !== id)
        : [...p.allowedAgents, id],
    }));
  }

  const sessionLabel = useMemo(() => {
    if (!live) return null;
    if (live.sessionExpiresAt === 0) return "No expiry";
    if (!live.sessionActive) return "Expired";
    return live.sessionExpiresAtIso
      ? `Until ${new Date(live.sessionExpiresAtIso).toLocaleString()}`
      : "Active";
  }, [live]);

  return (
    <div className="h-full max-h-full overflow-y-auto bg-[var(--p-bg)] text-[var(--p-fg)]">
      <header className="mx-auto flex max-w-3xl items-center justify-between gap-3 border-b border-[var(--p-border)] px-5 py-4">
        <div>
          <p className="flex items-center gap-2 font-display text-xl font-semibold">
            <Shield className="size-5 text-[var(--p-accent-text)]" />
            Agent Vault & Policy
          </p>
          <p className="text-sm text-[var(--p-muted)]">
            Prepaid agent budget on Coston2 — separate from Bound Work per-job escrow
          </p>
        </div>
        <div className="flex items-center gap-2">
          {wallet ? (
            <span className="rounded-full border border-[var(--p-border)] px-3 py-1.5 font-mono text-xs">
              {shortAddress(wallet)}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => void onConnect()}
              disabled={connecting}
              className="rounded-full bg-[var(--p-accent)] px-4 py-1.5 text-sm font-medium text-[var(--p-on-accent)] transition-transform active:scale-[0.98] disabled:opacity-50"
            >
              {connecting ? "Connecting…" : "Connect"}
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-5 py-6 pb-16">
        {/* ── Vault status ─────────────────────────────────────────── */}
        <section className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-surface)] p-5 shadow-[var(--p-shadow)]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-accent-text)]">
                Beacon Agent Vault
              </p>
              <p className="mt-1 font-display text-2xl font-semibold text-[var(--p-fg)]">
                {live ? "On-chain budget" : "Deploy vault on Coston2"}
              </p>
            </div>
            {live && (
              <a
                href={live.explorer}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-mono text-[11px] text-[var(--p-muted)] hover:text-[var(--p-accent-text)]"
              >
                Explorer <ExternalLink className="size-3" />
              </a>
            )}
          </div>

          {vaultQuery.isLoading && (
            <p className="mt-4 flex items-center gap-2 text-sm text-[var(--p-muted)]">
              <Loader2 className="size-4 animate-spin" /> Reading Coston2…
            </p>
          )}

          {status && !status.configured && (
            <div className="mt-4 space-y-2 text-sm text-[var(--p-muted)]">
              <p>{status.note}</p>
              <p className="font-mono text-[11px] text-[var(--p-faint)]">
                Set <code>BEACON_AGENT_VAULT_ADDRESS</code> /{" "}
                <code>VITE_BEACON_AGENT_VAULT_ADDRESS</code> after forge deploy. No fake balances.
              </p>
              <p className="text-xs">{status.distinction}</p>
            </div>
          )}

          {live && (
            <>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <Stat label="Balance" value={`${live.balanceDisplay} ${live.tokenSymbol}`} accent />
                <Stat label="Per-tx max" value={`${live.maxSpendPerTxDisplay} ${live.tokenSymbol}`} />
                <Stat
                  label="Window spent"
                  value={`${live.windowSpentDisplay} / ${live.rollingWindowBudgetDisplay}`}
                />
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Stat
                  label="Session"
                  value={sessionLabel ?? "—"}
                  sub={live.sessionActive ? "Active" : "Expired / blocked"}
                />
                <Stat
                  label="Executor"
                  value={
                    live.executor === "0x0000000000000000000000000000000000000000"
                      ? "Revoked"
                      : shortAddress(live.executor)
                  }
                  sub={live.paused ? "Paused" : "Live"}
                />
              </div>
              <dl className="mt-4 grid gap-2 font-mono text-[11px] text-[var(--p-muted)] sm:grid-cols-2">
                <div>
                  <dt className="uppercase tracking-wider text-[var(--p-faint)]">Owner</dt>
                  <dd className="mt-0.5 text-[var(--p-fg)]">{shortAddress(live.owner)}</dd>
                </div>
                <div>
                  <dt className="uppercase tracking-wider text-[var(--p-faint)]">Window</dt>
                  <dd className="mt-0.5 text-[var(--p-fg)]">{live.rollingWindowSeconds}s</dd>
                </div>
                <div>
                  <dt className="uppercase tracking-wider text-[var(--p-faint)]">Paused</dt>
                  <dd className="mt-0.5 text-[var(--p-fg)]">{live.paused ? "Yes" : "No"}</dd>
                </div>
                <div>
                  <dt className="uppercase tracking-wider text-[var(--p-faint)]">Nonce</dt>
                  <dd className="mt-0.5 text-[var(--p-fg)]">{live.executeNonce}</dd>
                </div>
              </dl>
              <div className="mt-4 rounded-xl border border-[var(--p-border)] bg-[var(--p-surface-2)] px-3 py-2.5">
                <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--p-muted)]">
                  Allowlists
                </p>
                <p className="mt-1 text-sm">
                  {live.allowlists.targets.length} target
                  {live.allowlists.targets.length === 1 ? "" : "s"} ·{" "}
                  {live.allowlists.selectors.length} selector
                  {live.allowlists.selectors.length === 1 ? "" : "s"} allowed
                </p>
                {live.allowlists.targets.length > 0 && (
                  <p className="mt-1 font-mono text-[10px] text-[var(--p-faint)]">
                    {live.allowlists.targets
                      .slice(0, 4)
                      .map((t) => shortAddress(t.address))
                      .join(" · ")}
                    {live.allowlists.targets.length > 4 ? "…" : ""}
                  </p>
                )}
                <p className="mt-1 text-[10px] text-[var(--p-faint)]">{live.allowlists.note}</p>
              </div>
              <p className="mt-3 text-xs text-[var(--p-muted)]">{live.distinction}</p>
            </>
          )}
        </section>

        {/* ── Owner vault actions ──────────────────────────────────── */}
        {live && (
          <section className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] p-5">
            <h2 className="font-display text-lg font-semibold">Vault controls</h2>
            <p className="mt-1 text-sm text-[var(--p-muted)]">
              Owner-only on-chain calls. Wallet calldata is prepared by the API, then signed in your wallet.
            </p>

            {!wallet && (
              <p className="mt-3 text-sm text-[var(--p-muted)]">Connect as vault owner to deposit, set policy, or pause.</p>
            )}
            {wallet && !isOwner && (
              <p className="mt-3 rounded-xl border border-[var(--p-border)] bg-[var(--p-surface-2)] px-3 py-2 text-sm text-[var(--p-muted)]">
                Connected wallet is not the vault owner. Status is readable; owner actions stay locked.
              </p>
            )}

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Amount (USDT0)" value={amount} onChange={(v) => setAmount(String(v))} string />
              <div className="flex flex-wrap items-end gap-2">
                <button
                  type="button"
                  disabled={!isOwner || vaultTx.isPending}
                  onClick={() => vaultTx.mutate({ action: "deposit", amountUsdt0: amount })}
                  className="rounded-full bg-[var(--p-accent)] px-4 py-2 text-sm font-medium text-[var(--p-on-accent)] disabled:opacity-40"
                >
                  Deposit
                </button>
                <button
                  type="button"
                  disabled={!isOwner || vaultTx.isPending}
                  onClick={() => vaultTx.mutate({ action: "withdraw", amountUsdt0: amount })}
                  className="rounded-full border border-[var(--p-border-strong)] px-4 py-2 text-sm disabled:opacity-40"
                >
                  Withdraw
                </button>
              </div>
            </div>

            <div className="mt-6 border-t border-[var(--p-border)] pt-5">
              <h3 className="font-display text-base font-semibold">On-chain policy</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Max spend / tx (USDT0)" value={maxSpend} onChange={(v) => setMaxSpend(String(v))} string />
                <Field
                  label="Rolling window budget (USDT0)"
                  value={windowBudget}
                  onChange={(v) => setWindowBudget(String(v))}
                  string
                />
                <Field
                  label="Window seconds"
                  value={windowSeconds}
                  onChange={(v) => setWindowSeconds(Number(v) || 0)}
                />
                <Field
                  label="Session length (hours from now, 0 = none)"
                  value={sessionHours}
                  onChange={(v) => setSessionHours(Number(v) || 0)}
                />
              </div>
              <button
                type="button"
                disabled={!isOwner || vaultTx.isPending}
                onClick={() => {
                  const expires =
                    sessionHours > 0
                      ? Math.floor(Date.now() / 1000) + sessionHours * 3600
                      : 0;
                  vaultTx.mutate({
                    action: "setPolicy",
                    maxSpendPerTxUsdt0: maxSpend,
                    rollingWindowBudgetUsdt0: windowBudget,
                    rollingWindowSeconds: windowSeconds,
                    sessionExpiresAt: expires,
                  });
                }}
                className="mt-3 rounded-full bg-[var(--p-accent)] px-5 py-2.5 text-sm font-medium text-[var(--p-on-accent)] disabled:opacity-40"
              >
                {vaultTx.isPending ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" /> Signing…
                  </span>
                ) : (
                  "Set policy"
                )}
              </button>
            </div>

            <div className="mt-6 flex flex-wrap gap-2 border-t border-[var(--p-border)] pt-5">
              <button
                type="button"
                disabled={!isOwner || vaultTx.isPending || live.paused}
                onClick={() => vaultTx.mutate({ action: "setPaused", paused: true })}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--p-danger)]/45 px-4 py-2 text-sm text-[var(--p-danger)] disabled:opacity-40"
              >
                <Pause className="size-3.5" /> Pause
              </button>
              <button
                type="button"
                disabled={!isOwner || vaultTx.isPending || !live.paused}
                onClick={() => vaultTx.mutate({ action: "setPaused", paused: false })}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--p-border-strong)] px-4 py-2 text-sm disabled:opacity-40"
              >
                <Play className="size-3.5" /> Unpause
              </button>
              <button
                type="button"
                disabled={!isOwner || vaultTx.isPending}
                onClick={() => {
                  if (confirm("Revoke executor (set to address zero)?")) {
                    vaultTx.mutate({ action: "setExecutor", revoke: true });
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--p-border-strong)] px-4 py-2 text-sm disabled:opacity-40"
              >
                <Ban className="size-3.5" /> Revoke executor
              </button>
            </div>
            {txNote && <p className="mt-3 text-sm text-[var(--p-accent-text)]">{txNote}</p>}
          </section>
        )}

        {/* ── API spend gates (server) ─────────────────────────────── */}
        <section className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] p-5">
          <h2 className="font-display text-lg font-semibold">API spend gates</h2>
          <p className="mt-1 text-sm text-[var(--p-muted)]">
            Server-enforced limits for agent micropays and Bound Work approve — not the pooled vault balance.
            Bound Work still locks funds in BeaconEscrow per job.
          </p>

          {!wallet && (
            <p className="mt-3 text-sm text-[var(--p-muted)]">Connect to load API gates.</p>
          )}

          {wallet && policyQuery.data?.receipt && (
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Stat label="Spent today" value={`${policyQuery.data.receipt.spentTodayUsdt0} USDT0`} />
              <Stat
                label="Remaining"
                value={`${policyQuery.data.receipt.remainingUsdt0} USDT0`}
                accent
              />
              <Stat label="Per job max" value={`${policyQuery.data.receipt.perJobLimitUsdt0} USDT0`} />
            </div>
          )}

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field
              label="Daily spend (USDT0)"
              value={policy.dailySpendUsdt0}
              onChange={(v) => setPolicy((p) => ({ ...p, dailySpendUsdt0: Number(v) || 0 }))}
            />
            <Field
              label="Per-job limit (USDT0)"
              value={policy.perJobLimitUsdt0}
              onChange={(v) => setPolicy((p) => ({ ...p, perJobLimitUsdt0: Number(v) || 0 }))}
            />
            <Field
              label="Max image cost (USDT0)"
              value={policy.maxImageCostUsdt0}
              onChange={(v) => setPolicy((p) => ({ ...p, maxImageCostUsdt0: Number(v) || 0 }))}
            />
            <Field
              label="Session expiry (hours)"
              value={policy.sessionExpiryHours}
              onChange={(v) => setPolicy((p) => ({ ...p, sessionExpiryHours: Number(v) || 0 }))}
            />
          </div>

          <div className="mt-4">
            <p className="text-sm font-medium text-[var(--p-muted)]">Allowed agents</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {AGENT_OPTIONS.map((id) => {
                const on = policy.allowedAgents.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => toggleAgent(id)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs capitalize transition-colors",
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
          </div>

          <label className="mt-4 flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={policy.emergencyPause}
              onChange={(e) => setPolicy((p) => ({ ...p, emergencyPause: e.target.checked }))}
              className="size-4 accent-[#3ecf8e]"
            />
            Emergency pause API spends
          </label>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={!wallet || save.isPending}
              onClick={() => save.mutate()}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--p-accent)] px-5 py-2.5 text-sm font-medium text-[var(--p-on-accent)] disabled:opacity-40"
            >
              {save.isPending && <Loader2 className="size-4 animate-spin" />}
              Save API gates
            </button>
            <button
              type="button"
              disabled={!wallet || revoke.isPending}
              onClick={() => {
                if (confirm("Pause API spends and clear limits for this wallet?")) revoke.mutate();
              }}
              className="rounded-full border border-[var(--p-danger)]/45 px-5 py-2.5 text-sm text-[var(--p-danger)] disabled:opacity-40"
            >
              Revoke API access
            </button>
          </div>
          {savedNote && <p className="mt-2 text-sm text-[var(--p-accent-text)]">{savedNote}</p>}
          <p className="mt-3 font-mono text-[10px] text-[var(--p-faint)]">
            {NETWORK.name} · API gates ≠ vault pool · Bound Work = BeaconEscrow
          </p>
        </section>
      </main>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2.5",
        accent
          ? "border-[var(--p-accent)]/35 bg-[var(--p-accent-soft)]"
          : "border-[var(--p-border)] bg-[var(--p-surface-2)]",
      )}
    >
      <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--p-muted)]">{label}</p>
      <p
        className={cn(
          "mt-1 font-display text-xl",
          accent && "text-[var(--p-accent-text)]",
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-[var(--p-muted)]">{sub}</p>}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  string: asString,
}: {
  label: string;
  value: number | string;
  onChange: (value: string | number) => void;
  string?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-[var(--p-muted)]">{label}</span>
      <input
        type={asString ? "text" : "number"}
        min={asString ? undefined : 0}
        value={value}
        onChange={(e) => {
          if (asString) onChange(e.target.value);
          else onChange(Number(e.target.value) || 0);
        }}
        className="mt-1.5 w-full rounded-xl border border-[var(--p-border-strong)] bg-[var(--p-surface-2)] px-3 py-2 font-mono text-[var(--p-fg)] outline-none transition-colors focus:border-[var(--p-accent)]"
      />
    </label>
  );
}
