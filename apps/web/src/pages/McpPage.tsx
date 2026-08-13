import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Check,
  ChevronDown,
  Copy,
  KeyRound,
  Loader2,
  Plug,
  Shield,
  Trash2,
} from "lucide-react";
import { api, type McpGrantPublic, type McpScope } from "@/lib/api";
import { shortAddress } from "@/lib/wallet";
import { useProductWallet } from "@/lib/productWallet";
import {
  ensureSafeAgentSession,
  readSafeAgentSession,
  type SafeAgentSession,
} from "@/lib/safeSession";
import { cn } from "@/lib/utils";

const CLIENTS = [
  {
    id: "claude" as const,
    label: "Claude",
    blurb: "Connect Claude Desktop or Claude with remote MCP.",
  },
  {
    id: "cursor" as const,
    label: "Cursor",
    blurb: "Add Beacon as an MCP server in Cursor settings.",
  },
  {
    id: "generic" as const,
    label: "Any MCP client",
    blurb: "Use the endpoint + token with any MCP-compatible agent.",
  },
];

const SCOPE_OPTIONS: { id: McpScope; label: string; group: "read" | "exec" }[] = [
  { id: "read:safe", label: "View Safe", group: "read" },
  { id: "read:policy", label: "View limits", group: "read" },
  { id: "read:portfolio", label: "View balances", group: "read" },
  { id: "read:activity", label: "View activity", group: "read" },
  { id: "read:jobs", label: "View Jobs", group: "read" },
  { id: "read:fassets", label: "View FAssets", group: "read" },
  { id: "read:executions", label: "View receipts", group: "read" },
  { id: "read:signals", label: "View signals", group: "read" },
  { id: "exec:swap", label: "Swap within limits", group: "exec" },
  { id: "exec:bridge", label: "Bridge within limits", group: "exec" },
  { id: "exec:job", label: "Start Jobs", group: "exec" },
  { id: "exec:x402", label: "x402 pay", group: "exec" },
  { id: "exec:fassets_redeem", label: "FAssets redeem", group: "exec" },
];

const DEFAULT_SCOPES: McpScope[] = [
  "read:safe",
  "read:policy",
  "read:portfolio",
  "read:activity",
  "read:jobs",
  "read:signals",
  "read:fassets",
  "read:executions",
  "exec:swap",
  "exec:bridge",
  "exec:job",
  "exec:x402",
  "exec:fassets_redeem",
];

type IssuedSecrets = {
  accessToken: string;
  refreshToken: string;
  mcpEndpoint: string;
  cursorConfig: string;
  setupPrompt: string;
  grant: McpGrantPublic;
  warning: string;
};

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--p-border)] bg-[var(--p-surface-2)] px-3 py-1.5 text-xs font-medium text-[var(--p-fg)] transition-colors hover:border-[var(--p-accent)]/40"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        window.setTimeout(() => setDone(false), 1600);
      }}
    >
      {done ? <Check className="size-3.5 text-[var(--p-accent-text)]" /> : <Copy className="size-3.5" />}
      {done ? "Copied" : label ?? "Copy"}
    </button>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <details className="group border-b border-[var(--p-border)] py-3">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-[var(--p-fg)]">
        {q}
        <ChevronDown className="size-4 shrink-0 text-[var(--p-faint)] transition-transform group-open:rotate-180" />
      </summary>
      <p className="mt-2 text-sm leading-relaxed text-[var(--p-muted)]">{a}</p>
    </details>
  );
}

export function McpPage() {
  const qc = useQueryClient();
  const { wallet, connect, connecting } = useProductWallet();
  const [step, setStep] = useState(0);
  const [clientKind, setClientKind] = useState<"claude" | "cursor" | "generic">("claude");
  const [scopes, setScopes] = useState<McpScope[]>(DEFAULT_SCOPES);
  const [maxSpend, setMaxSpend] = useState("5");
  const [dailyLimit, setDailyLimit] = useState("20");
  const [ttlDays, setTtlDays] = useState("7");
  const [issued, setIssued] = useState<IssuedSecrets | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [activityGrantId, setActivityGrantId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  /** Cached session only — never auto-prompt MetaMask on page load. */
  const [agentSession, setAgentSession] = useState<SafeAgentSession | null>(null);

  useEffect(() => {
    setAgentSession(readSafeAgentSession(wallet));
    setActivityGrantId(null);
  }, [wallet]);

  const vaultQuery = useQuery({
    queryKey: ["agent-vault-status", wallet ?? "none"],
    queryFn: () => api.getVaultStatus({ wallet: wallet ?? undefined }),
    enabled: Boolean(wallet),
  });

  // List grants only when a session already exists in storage — no signature spam.
  const grantsQuery = useQuery({
    queryKey: ["mcp-grants", wallet, agentSession?.issuedAt ?? "locked"],
    queryFn: () => api.listMcpGrants(wallet!, agentSession!.token),
    enabled: Boolean(wallet && agentSession),
    retry: false,
  });

  const healthQuery = useQuery({
    queryKey: ["mcp-health"],
    queryFn: () => api.mcpHealth(),
    refetchInterval: 60_000,
  });

  const activityQuery = useQuery({
    queryKey: ["mcp-activity", wallet, activityGrantId, agentSession?.issuedAt ?? "locked"],
    queryFn: () => api.mcpGrantActivity(activityGrantId!, wallet!, agentSession!.token),
    enabled: Boolean(wallet && activityGrantId && agentSession),
    retry: false,
  });

  const safeAddress = useMemo(() => {
    const st = vaultQuery.data?.status;
    return st && st.configured ? st.address : null;
  }, [vaultQuery.data]);

  const unlockSession = useMutation({
    mutationFn: async () => {
      if (!wallet) throw new Error("Connect your wallet first.");
      return ensureSafeAgentSession(wallet);
    },
    onSuccess: (session) => {
      setAgentSession(session);
      setNote("Agent session unlocked for this browser tab.");
      void qc.invalidateQueries({ queryKey: ["mcp-grants", wallet] });
    },
    onError: (err) => {
      setNote(err instanceof Error ? err.message : String(err));
    },
  });

  const createGrant = useMutation({
    mutationFn: async () => {
      if (!wallet) throw new Error("Connect your wallet first.");
      // Prefer cached session; only one MetaMask prompt when missing.
      const session = agentSession ?? (await ensureSafeAgentSession(wallet));
      setAgentSession(session);
      return api.createMcpGrant(
        {
          wallet,
          clientKind,
          scopes,
          maxSpendPerTxUsdt0: Number(maxSpend),
          dailyLimitUsdt0: Number(dailyLimit),
          ttlHours: Math.max(1, Math.round(Number(ttlDays) * 24)),
        },
        session.token,
      );
    },
    onSuccess: (data) => {
      setIssued({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        mcpEndpoint: data.mcpEndpoint,
        cursorConfig: data.cursorConfig,
        setupPrompt: data.setupPrompt,
        grant: data.grant,
        warning: data.warning,
      });
      setNote("Agent connected. Copy your setup once — tokens are shown only now.");
      setStep(0);
      void qc.invalidateQueries({ queryKey: ["mcp-grants", wallet] });
    },
    onError: (err) => {
      setNote(err instanceof Error ? err.message : String(err));
    },
  });

  const revokeGrant = useMutation({
    mutationFn: async (grantId: string) => {
      if (!wallet) throw new Error("Connect your wallet first.");
      const session = agentSession ?? (await ensureSafeAgentSession(wallet));
      setAgentSession(session);
      return api.revokeMcpGrant(grantId, wallet, session.token);
    },
    onSuccess: () => {
      setNote("Agent disconnected. Old tokens no longer work.");
      if (issued) setIssued(null);
      void qc.invalidateQueries({ queryKey: ["mcp-grants", wallet] });
    },
    onError: (err) => {
      setNote(err instanceof Error ? err.message : String(err));
    },
  });

  const testConn = useMutation({
    mutationFn: async () => {
      if (!issued?.accessToken) throw new Error("Connect an agent first to test.");
      return api.testMcpConnection(issued.accessToken);
    },
    onSuccess: (data) => {
      setTestResult(
        [
          data.message,
          `Safe: ${data.safe ?? "not linked"}`,
          `Permissions: ${data.permissions.join(", ")}`,
          `Per-transaction limit: ${data.perTransactionLimit} USDT0`,
          `Daily limit: ${data.dailyLimit} USDT0`,
          `Available actions: ${data.availableActions.join(", ")}`,
        ].join("\n"),
      );
    },
    onError: (err) => {
      setTestResult(err instanceof Error ? err.message : String(err));
    },
  });

  function toggleScope(id: McpScope) {
    setScopes((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  return (
    <div className="relative h-full max-h-full overflow-y-auto bg-[var(--p-bg)] text-[var(--p-fg)]">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-80 opacity-90"
        style={{
          background:
            "radial-gradient(ellipse 70% 55% at 15% 0%, color-mix(in oklab, var(--p-accent) 16%, transparent), transparent 68%), radial-gradient(ellipse 50% 40% at 90% 10%, color-mix(in oklab, var(--p-accent) 8%, transparent), transparent 70%)",
        }}
        aria-hidden
      />

      <header className="relative mx-auto flex max-w-3xl flex-col items-start gap-3 px-4 pb-2 pt-5 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:pt-6">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--p-accent-text)]">
            Connect Agents
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight sm:text-3xl md:text-4xl">
            Beacon MCP
          </h1>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-[var(--p-muted)]">
            Connect Claude, Cursor, or another AI agent to Beacon. Your agent never receives your
            private key. You choose what it can read and what it can do. Beacon Safe policy remains
            in control.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {healthQuery.data?.ok && (
            <span className="hidden rounded-full border border-[var(--p-accent)]/35 bg-[var(--p-accent-soft)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--p-accent-text)] sm:inline-flex">
              MCP live
            </span>
          )}
          {wallet ? (
            <span className="rounded-full border border-[var(--p-border)] bg-[var(--p-card)] px-3 py-1.5 font-mono text-xs">
              {shortAddress(wallet)}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => void connect()}
              disabled={connecting}
              className="rounded-full bg-[var(--p-accent)] px-4 py-1.5 text-sm font-medium text-[var(--p-on-accent)] disabled:opacity-50"
            >
              {connecting ? "Connecting…" : "Connect"}
            </button>
          )}
        </div>
      </header>

      <main className="relative mx-auto max-w-3xl space-y-10 px-4 pb-24 pt-4 sm:px-5">
        <section className="grid gap-6 sm:grid-cols-2">
          <div>
            <h2 className="font-display text-lg font-semibold">What is Beacon MCP?</h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--p-muted)]">
              MCP (Model Context Protocol) lets an external AI use Beacon tools — check your Safe,
              read limits, and run allowed actions — without ever holding your keys.
            </p>
          </div>
          <div>
            <h2 className="font-display text-lg font-semibold">How it works</h2>
            <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-sm leading-relaxed text-[var(--p-muted)]">
              <li>You unlock with your wallet</li>
              <li>You pick permissions and spend limits</li>
              <li>Beacon issues a short-lived agent token</li>
              <li>Every tool call is checked against scopes + Safe policy</li>
            </ol>
          </div>
        </section>

        <section className="rounded-[var(--p-radius)] border border-[var(--p-border)] bg-[var(--p-surface)] p-5">
          <div className="flex items-start gap-3">
            <div className="grid size-10 place-items-center rounded-[var(--p-radius-sm)] bg-[var(--p-accent-soft)] text-[var(--p-accent-text)]">
              <Plug className="size-5" strokeWidth={1.75} />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-xl font-semibold tracking-tight">Connect Agent</h2>
              <p className="mt-1 text-sm text-[var(--p-muted)]">
                {safeAddress
                  ? `Safe linked: ${shortAddress(safeAddress)}`
                  : "Create a Beacon Safe first if you want execution tools."}
              </p>
            </div>
          </div>

          {!wallet ? (
            <p className="mt-5 text-sm text-[var(--p-muted)]">
              Connect your wallet to authorize an agent for your account only.
            </p>
          ) : (
            <div className="mt-6 space-y-6">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--p-faint)]">
                  1 · Choose client
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {CLIENTS.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setClientKind(c.id);
                        setStep(1);
                      }}
                      className={cn(
                        "rounded-[var(--p-radius-sm)] border px-3 py-3 text-left transition-colors",
                        clientKind === c.id
                          ? "border-[var(--p-accent)]/50 bg-[var(--p-accent-soft)]"
                          : "border-[var(--p-border)] bg-[var(--p-surface-2)] hover:border-[var(--p-border-strong)]",
                      )}
                    >
                      <p className="text-sm font-medium">{c.label}</p>
                      <p className="mt-1 text-xs leading-snug text-[var(--p-muted)]">{c.blurb}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--p-faint)]">
                  2 · Permissions
                </p>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="mb-2 text-xs font-medium text-[var(--p-muted)]">Can read</p>
                    <div className="flex flex-wrap gap-2">
                      {SCOPE_OPTIONS.filter((s) => s.group === "read").map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => toggleScope(s.id)}
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-xs",
                            scopes.includes(s.id)
                              ? "border-[var(--p-accent)]/45 bg-[var(--p-accent-soft)] text-[var(--p-accent-text)]"
                              : "border-[var(--p-border)] text-[var(--p-muted)]",
                          )}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-medium text-[var(--p-muted)]">Can do</p>
                    <div className="flex flex-wrap gap-2">
                      {SCOPE_OPTIONS.filter((s) => s.group === "exec").map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => toggleScope(s.id)}
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-xs",
                            scopes.includes(s.id)
                              ? "border-[var(--p-accent)]/45 bg-[var(--p-accent-soft)] text-[var(--p-accent-text)]"
                              : "border-[var(--p-border)] text-[var(--p-muted)]",
                          )}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--p-faint)]">
                  3 · Limits & expiry
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <label className="block text-xs text-[var(--p-muted)]">
                    Per transaction (USDT0)
                    <input
                      value={maxSpend}
                      onChange={(e) => setMaxSpend(e.target.value)}
                      className="mt-1 w-full rounded-[var(--p-radius-sm)] border border-[var(--p-border)] bg-[var(--p-bg)] px-3 py-2 text-sm text-[var(--p-fg)]"
                    />
                  </label>
                  <label className="block text-xs text-[var(--p-muted)]">
                    Agent daily cap (USDT0)
                    <input
                      value={dailyLimit}
                      onChange={(e) => setDailyLimit(e.target.value)}
                      className="mt-1 w-full rounded-[var(--p-radius-sm)] border border-[var(--p-border)] bg-[var(--p-bg)] px-3 py-2 text-sm text-[var(--p-fg)]"
                    />
                  </label>
                  <label className="block text-xs text-[var(--p-muted)]">
                    Expires in (days)
                    <input
                      value={ttlDays}
                      onChange={(e) => setTtlDays(e.target.value)}
                      className="mt-1 w-full rounded-[var(--p-radius-sm)] border border-[var(--p-border)] bg-[var(--p-bg)] px-3 py-2 text-sm text-[var(--p-fg)]"
                    />
                  </label>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-[var(--p-muted)]">
                  These are agent ceilings. Your Beacon Safe on-chain policy and app pause still apply
                  and cannot be bypassed by MCP.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={createGrant.isPending || scopes.length === 0}
                  onClick={() => createGrant.mutate()}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[var(--p-accent)] px-5 py-2.5 text-sm font-medium text-[var(--p-on-accent)] disabled:opacity-50"
                >
                  {createGrant.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Bot className="size-4" />
                  )}
                  {step >= 1 ? "Confirm & connect" : "Connect Agent"}
                </button>
                <span className="text-xs text-[var(--p-faint)]">
                  One signature only when you click — this page never auto-prompts MetaMask.
                </span>
              </div>
            </div>
          )}
        </section>

        {issued && (
          <section className="min-w-0 space-y-4 overflow-hidden rounded-[var(--p-radius)] border border-[var(--p-accent)]/35 bg-[var(--p-accent-soft)]/40 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold">Connected — finish setup</h2>
                <p className="mt-1 text-sm text-[var(--p-muted)]">{issued.warning}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <CopyButton text={issued.setupPrompt} label="Copy setup prompt" />
                <button
                  type="button"
                  disabled={testConn.isPending}
                  onClick={() => testConn.mutate()}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--p-border)] bg-[var(--p-surface)] px-3 py-1.5 text-xs font-medium"
                >
                  {testConn.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Shield className="size-3.5" />
                  )}
                  Test connection
                </button>
              </div>
            </div>

            <div className="grid min-w-0 gap-3">
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--p-faint)]">
                  MCP endpoint
                </p>
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                  <code className="min-w-0 max-w-full break-all rounded-[var(--p-radius-sm)] bg-[var(--p-bg)] px-2 py-1 font-mono text-xs">
                    {issued.mcpEndpoint}
                  </code>
                  <CopyButton text={issued.mcpEndpoint} />
                </div>
              </div>
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--p-faint)]">
                  Access token (1 hour)
                </p>
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                  <code className="min-w-0 max-w-[min(100%,18rem)] truncate rounded-[var(--p-radius-sm)] bg-[var(--p-bg)] px-2 py-1 font-mono text-xs">
                    {issued.accessToken.slice(0, 28)}…
                  </code>
                  <CopyButton text={issued.accessToken} label="Copy token" />
                </div>
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--p-faint)]">
                    {clientKind === "cursor" ? "Cursor mcp.json" : "MCP client config"}
                  </p>
                  <CopyButton text={issued.cursorConfig} label="Copy config" />
                </div>
                <div className="mt-2 min-w-0 overflow-hidden rounded-[var(--p-radius-sm)] border border-[var(--p-border)] bg-[var(--p-bg)]">
                  <pre className="max-h-56 overflow-x-auto overflow-y-auto p-3 font-mono text-[11px] leading-relaxed text-[var(--p-fg)] [overflow-wrap:anywhere] whitespace-pre-wrap break-all">
                    {issued.cursorConfig}
                  </pre>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-[var(--p-muted)]">
                  {clientKind === "cursor"
                    ? "Paste into Cursor Settings → MCP (or ~/.cursor/mcp.json), then reload MCP."
                    : "Use this URL + Authorization Bearer header in any MCP-compatible client."}
                </p>
              </div>

              <div className="min-w-0 rounded-[var(--p-radius-sm)] border border-[var(--p-border)] bg-[var(--p-surface)]/60 p-3 text-sm leading-relaxed text-[var(--p-muted)]">
                <p className="font-medium text-[var(--p-fg)]">How to finish</p>
                <ol className="mt-1 list-decimal space-y-1 pl-4">
                  <li>Copy the config (or full setup prompt) into your agent client.</li>
                  <li>
                    Paste <span className="text-[var(--p-fg)]">Copy setup prompt</span> into the
                    agent chat — it includes endpoint, tokens, mcp.json, and verification steps.
                  </li>
                  <li>Click Test connection here to confirm Beacon responds.</li>
                  <li>When the access token expires (~1h), renew with the refresh token.</li>
                </ol>
              </div>
            </div>

            {testResult && (
              <pre className="whitespace-pre-wrap rounded-[var(--p-radius-sm)] border border-[var(--p-border)] bg-[var(--p-bg)] p-3 font-mono text-xs leading-relaxed">
                {testResult}
              </pre>
            )}
          </section>
        )}

        <section>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-semibold tracking-tight">Connected agents</h2>
              <p className="mt-1 text-sm text-[var(--p-muted)]">
                Each connection is yours alone — never shared across wallets.
              </p>
            </div>
            {wallet && !agentSession && (
              <button
                type="button"
                disabled={unlockSession.isPending}
                onClick={() => unlockSession.mutate()}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--p-border-strong)] bg-[var(--p-surface-2)] px-3 py-1.5 text-xs font-medium"
              >
                {unlockSession.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <KeyRound className="size-3.5" />
                )}
                Unlock to view
              </button>
            )}
            {wallet && agentSession && (
              <span className="rounded-full border border-[var(--p-accent)]/35 bg-[var(--p-accent-soft)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--p-accent-text)]">
                Session unlocked
              </span>
            )}
          </div>
          <div className="mt-4 space-y-3">
            {!agentSession && wallet && (
              <p className="text-sm text-[var(--p-faint)]">
                Unlock once to list agents. Opening this page never asks for a signature by itself.
              </p>
            )}
            {agentSession && (grantsQuery.data?.grants ?? []).length === 0 && (
              <p className="text-sm text-[var(--p-faint)]">No agents connected yet.</p>
            )}
            {(grantsQuery.data?.grants ?? []).map((g) => (
              <div
                key={g.id}
                className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--p-border)] py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {g.clientLabel}{" "}
                    <span
                      className={cn(
                        "ml-1 font-mono text-[10px] uppercase tracking-wider",
                        g.active ? "text-[var(--p-accent-text)]" : "text-[var(--p-danger)]",
                      )}
                    >
                      {g.active ? "active" : g.revokedAt ? "revoked" : "expired"}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-[var(--p-muted)]">
                    Per-tx {g.maxSpendPerTxUsdt0} · Daily {g.dailyLimitUsdt0} · Expires{" "}
                    {new Date(g.expiresAt).toLocaleString()}
                  </p>
                  <p className="mt-1 break-all font-mono text-[10px] text-[var(--p-faint)]">
                    {g.scopes.join(" · ")}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-full border border-[var(--p-border)] px-3 py-1.5 text-xs"
                    onClick={() => {
                      if (!agentSession) {
                        unlockSession.mutate(undefined, {
                          onSuccess: () => setActivityGrantId(g.id),
                        });
                        return;
                      }
                      setActivityGrantId(g.id);
                    }}
                  >
                    Activity
                  </button>
                  {g.active && (
                    <button
                      type="button"
                      disabled={revokeGrant.isPending}
                      onClick={() => revokeGrant.mutate(g.id)}
                      className="inline-flex items-center gap-1 rounded-full border border-[var(--p-danger)]/40 px-3 py-1.5 text-xs text-[var(--p-danger)]"
                    >
                      <Trash2 className="size-3.5" />
                      Revoke
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {activityGrantId && (
            <div className="mt-4 rounded-[var(--p-radius-sm)] border border-[var(--p-border)] bg-[var(--p-surface)] p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--p-faint)]">
                  Audit log · {activityGrantId.slice(0, 14)}…
                </p>
                <button
                  type="button"
                  className="text-xs text-[var(--p-muted)]"
                  onClick={() => setActivityGrantId(null)}
                >
                  Close
                </button>
              </div>
              <ul className="mt-3 max-h-56 space-y-2 overflow-auto text-xs text-[var(--p-muted)]">
                {(activityQuery.data?.events ?? []).length === 0 && <li>No events yet.</li>}
                {(activityQuery.data?.events ?? []).map((e, i) => (
                  <li key={`${e.at}-${i}`} className="border-b border-[var(--p-border)] pb-2">
                    <span className={e.ok ? "text-[var(--p-accent-text)]" : "text-[var(--p-danger)]"}>
                      {e.ok ? "ok" : "deny"}
                    </span>{" "}
                    · {e.tool} · {e.detail}
                    {e.txHash ? ` · ${e.txHash.slice(0, 12)}…` : ""}
                    <span className="block text-[10px] text-[var(--p-faint)]">
                      {new Date(e.at).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold">How Beacon protects your funds</h2>
          <div className="mt-2">
            <Faq
              q="What is MCP?"
              a="A standard way for AI tools to call apps safely. Beacon MCP is the Beacon-side door — not a new wallet."
            />
            <Faq
              q="What can my agent do?"
              a="Only what you grant: read Safe/policy, and optionally run swaps or other tools within your chosen caps."
            />
            <Faq
              q="What can it NOT do?"
              a="It cannot see your private key, raise its own limits, skip pause, or spend above Safe/on-chain policy."
            />
            <Faq
              q="How do I disconnect it?"
              a="Use Revoke on this page, or Emergency pause on Safe — that also revokes all MCP grants for your wallet."
            />
            <Faq
              q="How do permissions work?"
              a="Scopes gate tools. Agent spend caps gate amounts. App policy and the on-chain Beacon Safe are the final financial boundary."
            />
          </div>

          <details className="mt-6 rounded-[var(--p-radius-sm)] border border-[var(--p-border)] bg-[var(--p-surface)] p-4">
            <summary className="cursor-pointer text-sm font-medium">Developer details</summary>
            <div className="mt-3 space-y-2 font-mono text-[11px] leading-relaxed text-[var(--p-muted)]">
              <p>POST {healthQuery.data?.endpoint ?? "…/mcp"} — JSON-RPC MCP (Bearer access token)</p>
              <p>GET /.well-known/oauth-protected-resource</p>
              <p>POST /v1/mcp/oauth/token — authorization_code (PKCE) + refresh_token</p>
              <p>Access TTL 1h · refresh bound to grant · Redis multi-user grants</p>
            </div>
          </details>
        </section>

        {note && (
          <p className="fixed bottom-4 left-1/2 z-20 max-w-md -translate-x-1/2 rounded-full border border-[var(--p-border)] bg-[var(--p-card)] px-4 py-2 text-center text-xs shadow-lg">
            {note}
          </p>
        )}
      </main>
    </div>
  );
}
