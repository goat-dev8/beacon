import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2 } from "lucide-react";
import { api, type AgentVaultStatus, type SecurityPolicy } from "@/lib/api";
import { shortAddress, executeAgentVaultPrep, openCoston2Faucet, getUsdt0Balance, sendPreparedVaultTx } from "@/lib/wallet";
import { useProductWallet } from "@/lib/productWallet";
import { NETWORK } from "@/lib/chain";
import type { Address, Hex } from "viem";
import { formatUnits } from "viem";
import {
  clearSafeAgentSession,
  ensureSafeAgentSession,
  readSafeAgentSession,
  type SafeAgentSession,
} from "@/lib/safeSession";
import {
  AppLimitsSection,
  DEFAULT_SAFE_POLICY,
  DepositSection,
  EmergencySection,
  FaucetGasCard,
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
  const [walletBalance, setWalletBalance] = useState<string | null>(null);
  const [maxSpend, setMaxSpend] = useState("5");
  const [windowBudget, setWindowBudget] = useState("50");
  const [windowHours, setWindowHours] = useState(24);
  const [sessionHours, setSessionHours] = useState(24);
  const [agentSession, setAgentSession] = useState<SafeAgentSession | null>(null);

  const fccQuery = useQuery({
    queryKey: ["fcc-status"],
    queryFn: () => api.getFccStatus(),
    refetchInterval: 60_000,
    retry: 1,
  });

  const vaultQuery = useQuery({
    queryKey: ["agent-vault-status", wallet ?? "none"],
    queryFn: () => api.getVaultStatus({ wallet: wallet ?? undefined }),
    enabled: Boolean(wallet),
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
      maxImageCostUsdt0:
        next.maxImageCostUsdt0 > 0 ? next.maxImageCostUsdt0 : 0.05,
      maxVideoSeconds: next.maxVideoSeconds > 0 ? next.maxVideoSeconds : 60,
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
    mutationFn: async () => {
      const session = await ensureSafeAgentSession(wallet!);
      setAgentSession(session);
      return api.putSecurityPolicy(
        wallet!,
        {
          ...policy,
          allowedAgents: stripNonFlareAgents(policy.allowedAgents),
          maxImageCostUsdt0: policy.maxImageCostUsdt0 > 0 ? policy.maxImageCostUsdt0 : 0.05,
          maxVideoSeconds: policy.maxVideoSeconds > 0 ? policy.maxVideoSeconds : 60,
        },
        session.token,
      );
    },
    onSuccess: (data) => {
      setSavedNote(`App limits saved (${data.source})`);
      void qc.invalidateQueries({ queryKey: ["security-policy", wallet] });
    },
  });

  const revoke = useMutation({
    mutationFn: async () => {
      const session = await ensureSafeAgentSession(wallet!);
      const result = await api.revokeSecurity(wallet!, session.token);
      clearSafeAgentSession(wallet);
      setAgentSession(null);
      return result;
    },
    onSuccess: (data) => {
      setSavedNote(data.message);
      void qc.invalidateQueries({ queryKey: ["security-policy", wallet] });
    },
  });

  useEffect(() => {
    if (!wallet) {
      setWalletBalance(null);
      setAgentSession(null);
      return;
    }
    setAgentSession(readSafeAgentSession(wallet));
    let cancelled = false;
    void getUsdt0Balance(wallet as Address)
      .then((bal) => {
        if (!cancelled) setWalletBalance(formatUnits(bal, 6));
      })
      .catch(() => {
        if (!cancelled) setWalletBalance(null);
      });
    return () => {
      cancelled = true;
    };
  }, [wallet, txNote]);

  const unlockAgent = useMutation({
    mutationFn: async () => {
      if (!wallet) throw new Error("Connect your wallet first.");
      return ensureSafeAgentSession(wallet);
    },
    onSuccess: (session) => {
      setAgentSession(session);
      setTxNote("Beacon Agent unlocked for this browser session.");
    },
    onError: (err) => {
      setTxNote(err instanceof Error ? err.message : String(err));
    },
  });

  const mintTx = useMutation({
    mutationFn: async () => {
      openCoston2Faucet();
      return "faucet" as const;
    },
    onSuccess: () => {
      setTxNote("Opened Coston2 faucet — claim C2FLR and USDT0, then deposit.");
    },
    onError: (err) => {
      setTxNote(err instanceof Error ? err.message : String(err));
    },
  });

  const vaultTx = useMutation({
    mutationFn: async (body: Parameters<typeof api.prepareVault>[0]) => {
      const { prep } = await api.prepareVault({
        ...body,
        wallet: wallet ?? undefined,
        address: live?.address,
      });
      if (prep.action === "createSafe") {
        const txHash = await sendPreparedVaultTx({
          to: prep.to as Address,
          data: (prep.data || "0x") as Hex,
        });
        return { prep, result: { txHash } };
      }
      const result = await executeAgentVaultPrep({
        to: prep.to as Address,
        data: (prep.data || "0x") as Hex,
        approveTo: prep.approveTo as Address | undefined,
        approveData: prep.approveData as Hex | undefined,
        mode: prep.mode,
        token: prep.token as Address | undefined,
        amount: prep.amount,
        action: prep.action,
      });
      return { prep, result };
    },
    onSuccess: ({ result, prep }) => {
      setTxNote(
        prep.action === "createSafe"
          ? `Beacon Safe created · ${shortAddress(result.txHash)}`
          : `Confirmed ${shortAddress(result.txHash)}`,
      );
      void qc.invalidateQueries({ queryKey: ["agent-vault-status", wallet] });
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

      <header className="relative mx-auto flex max-w-3xl flex-col items-start gap-3 px-4 pb-2 pt-5 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:pt-6">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--p-accent-text)]">
            Beacon Safe
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-[var(--p-fg)] sm:text-3xl md:text-4xl">
            Your prepaid AI budget
          </h1>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-[var(--p-muted)]">
            Gas first, then create your Safe, claim Coston2 USDT0 from the faucet, deposit, and set
            limits.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {fccQuery.data?.mode === "simulated" && (
            <span className="hidden rounded-full border border-[var(--p-accent)]/40 bg-[var(--p-accent-soft)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--p-accent-text)] sm:inline-flex">
              Confidential policy (simulated TEE)
            </span>
          )}
          {fccQuery.data?.mode === "verified" && (
            <span className="hidden rounded-full border border-[var(--p-accent)]/40 bg-[var(--p-accent-soft)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--p-accent-text)] sm:inline-flex">
              Confidential policy (hardware TEE)
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

      <main className="relative mx-auto max-w-3xl space-y-8 px-4 pb-20 pt-4 sm:px-5">
        <SafeReveal>
          <VaultPassCard
            status={status}
            loading={vaultQuery.isLoading}
            sessionLabel={sessionLabel}
          />
        </SafeReveal>

        <SafeReveal delay={0.04}>
          <FaucetGasCard />
        </SafeReveal>

        {wallet && (
          <SafeReveal delay={0.05}>
            <section className="grid gap-4 border-y border-[var(--p-border)] py-5 sm:grid-cols-[1fr_auto] sm:items-center">
              <div>
                <p className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--p-accent-text)]">
                  <KeyRound className="size-3.5" strokeWidth={2} />
                  Agent session
                </p>
                <h2 className="mt-1 font-display text-lg font-semibold tracking-tight text-[var(--p-fg)]">
                  {agentSession ? "Beacon Agent is unlocked" : "Unlock once, then leave MetaMask closed"}
                </h2>
                <p className="mt-1 max-w-xl text-sm leading-relaxed text-[var(--p-muted)]">
                  {agentSession
                    ? `Jobs, Safe swaps, and agent bridges run through the executor until ${new Date(
                        agentSession.expiresAt * 1000,
                      ).toLocaleString()}. Your on-chain caps, pause, and expiry still gate every Safe spend.`
                    : "One gas-free signature binds this browser session to your wallet. It does not move funds. After that, the agent executor submits approved actions without per-job wallet prompts."}
                </p>
              </div>
              <button
                type="button"
                disabled={unlockAgent.isPending || Boolean(agentSession)}
                onClick={() => unlockAgent.mutate()}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-[var(--p-border-strong)] bg-[var(--p-surface-2)] px-5 py-2.5 text-sm font-medium text-[var(--p-fg)] transition-transform hover:border-[var(--p-accent)]/50 active:scale-[0.98] disabled:opacity-50"
              >
                {unlockAgent.isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Unlocking…
                  </>
                ) : agentSession ? (
                  "Agent unlocked"
                ) : (
                  "Unlock Beacon Agent"
                )}
              </button>
            </section>
          </SafeReveal>
        )}

        {wallet && !live && !vaultQuery.isLoading && (
          <SafeReveal delay={0.06}>
            <section className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--p-accent-text)]">
                Step 2 · Your Beacon Safe
              </p>
              <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-[var(--p-fg)]">
                Create your personal Safe
              </h2>
              <p className="mt-2 max-w-lg text-sm leading-relaxed text-[var(--p-muted)]">
                Each wallet owns its own prepaid budget and spending policy. You will not see another
                user’s Safe. After you have C2FLR gas, create yours on {NETWORK.name}, then deposit
                Coston2 USDT0 from the official faucet.
              </p>
              <button
                type="button"
                disabled={vaultTx.isPending}
                onClick={() => vaultTx.mutate({ action: "createSafe", wallet })}
                className="mt-5 inline-flex items-center gap-2 rounded-full bg-[var(--p-accent)] px-5 py-2.5 text-sm font-medium text-[var(--p-on-accent)] transition-transform active:scale-[0.98] disabled:opacity-50"
              >
                {vaultTx.isPending && vaultTx.variables?.action === "createSafe" ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Creating…
                  </>
                ) : (
                  "Create Beacon Safe"
                )}
              </button>
              {txNote ? (
                <p className="mt-3 font-mono text-xs text-[var(--p-muted)]">{txNote}</p>
              ) : null}
            </section>
          </SafeReveal>
        )}

        {live && (
          <>
            <SafeReveal>
              <DepositSection
                amount={amount}
                onAmountChange={setAmount}
                onDeposit={() => vaultTx.mutate({ action: "deposit", amountUsdt0: amount })}
                onWithdraw={() => vaultTx.mutate({ action: "withdraw", amountUsdt0: amount })}
                onMint={() => mintTx.mutate()}
                pending={vaultTx.isPending}
                busy={
                  vaultTx.isPending &&
                  (vaultTx.variables?.action === "deposit" ||
                    vaultTx.variables?.action === "withdraw")
                }
                minting={mintTx.isPending}
                wallet={wallet}
                isOwner={isOwner}
                onConnect={() => void onConnect()}
                connecting={connecting}
                txNote={txNote}
                tokenSymbol={live.tokenSymbol}
                walletBalance={walletBalance}
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
                busy={vaultTx.isPending && vaultTx.variables?.action === "setPolicy"}
                wallet={wallet}
                isOwner={isOwner}
                onConnect={() => void onConnect()}
                connecting={connecting}
                remainingDisplay={live.windowRemainingDisplay}
                spentDisplay={live.windowSpentDisplay}
                budgetDisplay={live.rollingWindowBudgetDisplay}
                resetsAtIso={live.windowResetsAtIso}
                sessionLabel={sessionLabel}
                paused={live.paused}
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
                executor={live.executor}
                busyAction={
                  vaultTx.isPending
                    ? vaultTx.variables?.action === "setPaused"
                      ? vaultTx.variables?.paused
                        ? "pause"
                        : "unpause"
                      : vaultTx.variables?.action === "setExecutor"
                        ? "revoke"
                        : null
                    : null
                }
                onPause={() => {
                  if (confirm("Pause Beacon Safe? Agents cannot spend until you Unpause.")) {
                    vaultTx.mutate({ action: "setPaused", paused: true });
                  }
                }}
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

        <div className="space-y-8 border-t border-[var(--p-border)] pt-10">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--p-faint)]">
            Learn more
          </p>
          <SafeReveal>
            <SafeFlowStrip />
          </SafeReveal>
          <SafeReveal delay={0.04}>
            <ProtectionStory fccMode={fccQuery.data?.mode ?? "unavailable"} />
          </SafeReveal>
        </div>

        <footer className="border-t border-[var(--p-border)] pt-6 text-center">
          <p className="text-xs text-[var(--p-faint)]">
            Agent Jobs prefer this Safe: vault.execute(transfer→escrow) + lockPrepaid. Wallet ERC-20
            lockFrom remains as fallback.
          </p>
          <p className="mt-1 font-mono text-[10px] text-[var(--p-faint)]">
            {NETWORK.name} · Beacon Safe · Coston2 USDT0
          </p>
        </footer>
      </main>
    </div>
  );
}
