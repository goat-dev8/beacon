import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { api, type AgentVaultStatus, type SecurityPolicy } from "@/lib/api";
import { shortAddress, executeAgentVaultPrep } from "@/lib/wallet";
import { useProductWallet } from "@/lib/productWallet";
import { CONTRACTS, NETWORK } from "@/lib/chain";
import type { Address, Hex } from "viem";
import {
  AppLimitsSection,
  DEFAULT_SAFE_POLICY,
  DepositSection,
  EmergencySection,
  ProtectionStory,
  SafeFlowStrip,
  SafeReveal,
  SpendingPolicySection,
  VaultPassCard,
  stripNonFlareAgents,
} from "@/components/safe";

function vaultConfigured(
  s: AgentVaultStatus | undefined,
): s is Extract<AgentVaultStatus, { configured: true }> {
  return Boolean(s && s.configured);
}

function hoursFromSeconds(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 24;
  return Math.max(1, Math.round(seconds / 3600));
}

export function SecurityPage() {
  const qc = useQueryClient();
  const { wallet, connect, connecting } = useProductWallet();
  const [policy, setPolicy] = useState<SecurityPolicy>(DEFAULT_SAFE_POLICY);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [txNote, setTxNote] = useState<string | null>(null);
  const [amount, setAmount] = useState("10");
  const [maxSpend, setMaxSpend] = useState("5");
  const [windowBudget, setWindowBudget] = useState("50");
  const [windowHours, setWindowHours] = useState(24);
  const [sessionHours, setSessionHours] = useState(24);

  const vaultAddress = CONTRACTS.agentVault || undefined;

  const fccQuery = useQuery({
    queryKey: ["fcc-status"],
    queryFn: () => api.getFccStatus(),
    refetchInterval: 60_000,
    retry: 1,
  });

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
    if (!policyQuery.data?.policy) return;
    const next = policyQuery.data.policy;
    setPolicy({
      ...next,
      allowedAgents: stripNonFlareAgents(next.allowedAgents),
      maxImageCostUsdt0: 0,
      maxVideoSeconds: 0,
    });
  }, [policyQuery.data]);

  useEffect(() => {
    const st = vaultQuery.data?.status;
    if (!vaultConfigured(st)) return;
    setMaxSpend(st.maxSpendPerTxDisplay);
    setWindowBudget(st.rollingWindowBudgetDisplay);
    setWindowHours(hoursFromSeconds(Number(st.rollingWindowSeconds)));
  }, [vaultQuery.data?.status]);

  const status = vaultQuery.data?.status;
  const live = vaultConfigured(status) ? status : null;
  const isOwner = Boolean(
    wallet && live && wallet.toLowerCase() === live.owner.toLowerCase(),
  );

  const save = useMutation({
    mutationFn: () =>
      api.putSecurityPolicy(wallet!, {
        ...policy,
        allowedAgents: stripNonFlareAgents(policy.allowedAgents),
        maxImageCostUsdt0: 0,
        maxVideoSeconds: 0,
      }),
    onSuccess: (data) => {
      setSavedNote(`App limits saved (${data.source})`);
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
    mutationFn: async (body: Parameters<typeof api.prepareVault>[0]) => {
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

  const sessionLabel = useMemo(() => {
    if (!live) return null;
    if (live.sessionExpiresAt === 0) return "No expiry";
    if (!live.sessionActive) return "Expired";
    return live.sessionExpiresAtIso
      ? `Until ${new Date(live.sessionExpiresAtIso).toLocaleString()}`
      : "Active";
  }, [live]);

  return (
    <div className="relative h-full max-h-full overflow-y-auto bg-[var(--p-bg)] text-[var(--p-fg)]">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-72 opacity-80"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 20% 0%, color-mix(in oklab, var(--p-accent) 14%, transparent), transparent 70%)",
        }}
        aria-hidden
      />

      <header className="relative mx-auto flex max-w-3xl items-center justify-between gap-3 px-5 pb-2 pt-6">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--p-accent-text)]">
            Beacon Safe
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-[var(--p-fg)] sm:text-4xl">
            Beacon Safe
          </h1>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-[var(--p-muted)]">
            Deposit a prepaid budget so AI can spend only what you allow.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {fccQuery.data?.mode === "simulated" && (
            <span className="hidden rounded-full border border-[var(--p-accent)]/40 bg-[var(--p-accent-soft)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--p-accent-text)] sm:inline-flex">
              Confidential policy (simulated TEE)
            </span>
          )}
          {wallet ? (
            <span className="rounded-full border border-[var(--p-border)] bg-[var(--p-card)] px-3 py-1.5 font-mono text-xs">
              {shortAddress(wallet)}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => void onConnect()}
              disabled={connecting}
              className="rounded-full bg-[var(--p-accent)] px-4 py-1.5 text-sm font-medium text-[var(--p-on-accent)] transition-transform active:scale-[0.98] disabled:opacity-50"
            >
              {connecting ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="size-3.5 animate-spin" /> Connecting…
                </span>
              ) : (
                "Connect"
              )}
            </button>
          )}
        </div>
      </header>

      <main className="relative mx-auto max-w-3xl space-y-8 px-5 pb-20 pt-4">
        <SafeReveal>
          <SafeFlowStrip />
        </SafeReveal>

        <SafeReveal delay={0.04}>
          <ProtectionStory fccMode={fccQuery.data?.mode ?? "unavailable"} />
        </SafeReveal>

        <SafeReveal delay={0.06}>
          <VaultPassCard
            status={status}
            loading={vaultQuery.isLoading}
            sessionLabel={sessionLabel}
          />
        </SafeReveal>

        {live && (
          <>
            <SafeReveal>
              <DepositSection
                amount={amount}
                onAmountChange={setAmount}
                onDeposit={() => vaultTx.mutate({ action: "deposit", amountUsdt0: amount })}
                onWithdraw={() => vaultTx.mutate({ action: "withdraw", amountUsdt0: amount })}
                pending={vaultTx.isPending}
                wallet={wallet}
                isOwner={isOwner}
                onConnect={() => void onConnect()}
                connecting={connecting}
                txNote={txNote}
                tokenSymbol={live.tokenSymbol}
              />
            </SafeReveal>

            <SafeReveal>
              <SpendingPolicySection
                maxSpend={maxSpend}
                windowBudget={windowBudget}
                windowHours={windowHours}
                sessionHours={sessionHours}
                onMaxSpend={setMaxSpend}
                onWindowBudget={setWindowBudget}
                onWindowHours={setWindowHours}
                onSessionHours={setSessionHours}
                pending={vaultTx.isPending}
                wallet={wallet}
                isOwner={isOwner}
                onConnect={() => void onConnect()}
                connecting={connecting}
                onSave={() => {
                  const expires =
                    sessionHours > 0
                      ? Math.floor(Date.now() / 1000) + sessionHours * 3600
                      : 0;
                  vaultTx.mutate({
                    action: "setPolicy",
                    maxSpendPerTxUsdt0: maxSpend,
                    rollingWindowBudgetUsdt0: windowBudget,
                    rollingWindowSeconds: Math.max(1, Math.round(windowHours * 3600)),
                    sessionExpiresAt: expires,
                  });
                }}
              />
            </SafeReveal>

            <SafeReveal>
              <EmergencySection
                paused={live.paused}
                pending={vaultTx.isPending}
                wallet={wallet}
                isOwner={isOwner}
                onConnect={() => void onConnect()}
                connecting={connecting}
                onPause={() => vaultTx.mutate({ action: "setPaused", paused: true })}
                onUnpause={() => vaultTx.mutate({ action: "setPaused", paused: false })}
                onRevoke={() => {
                  if (
                    confirm(
                      "Revoke executor? Agents will not be able to spend until you set one again.",
                    )
                  ) {
                    vaultTx.mutate({ action: "setExecutor", revoke: true });
                  }
                }}
              />
            </SafeReveal>
          </>
        )}

        <SafeReveal>
          <AppLimitsSection
            policy={policy}
            setPolicy={setPolicy}
            receipt={policyQuery.data?.receipt}
            wallet={wallet}
            onSave={() => save.mutate()}
            onRevoke={() => {
              if (confirm("Pause API spends and clear limits for this wallet?")) {
                revoke.mutate();
              }
            }}
            savePending={save.isPending}
            revokePending={revoke.isPending}
            savedNote={savedNote}
          />
        </SafeReveal>

        <footer className="border-t border-[var(--p-border)] pt-6 text-center">
          <p className="text-xs text-[var(--p-faint)]">
            Bound Work escrow is separate. Per-job locks use BeaconEscrow, not this Safe pool.
          </p>
          <p className="mt-1 font-mono text-[10px] text-[var(--p-faint)]">
            {NETWORK.name} · Beacon Safe
          </p>
        </footer>
      </main>
    </div>
  );
}
