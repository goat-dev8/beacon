import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "motion/react";
import {
  Send,
  Loader2,
  ExternalLink,
  Search,
  CheckCircle2,
  Clock,
  ChevronDown,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import {
  connectEvmWallet,
  shortAddress,
  mintMockUsdt0,
  executeSparkDexSwap,
  executeOftBridge,
  tryRestoreWallet,
} from "@/lib/wallet";
import { NETWORK } from "@/lib/chain";
import { cn } from "@/lib/utils";
import { formatNativeFeeDisplay, formatTokenAmount } from "@/lib/format";
import { ExecutionDrawer } from "@/components/ExecutionDrawer";
import { AgentText } from "@/components/AgentText";
import {
  cardKey,
  findActiveExecution,
  inferSettledServiceIds,
  type CardExecutionState,
  type AgentCard,
} from "@/lib/executionPhases";
import type { Address, Hex } from "viem";

type AgentId =
  | "general"
  | "signals"
  | "swap"
  | "bridge"
  | "pay"
  | "trade"
  | "desk"
  | "image"
  | "video"
  | "research";

interface ChatMsg {
  id: string;
  role: "user" | "assistant" | "system";
  agentId?: AgentId;
  text: string;
  cards?: AgentCard[];
  displayModel?: string;
}

type ConvState = {
  intent: string;
  phase: string;
  amountInUnits?: string;
  bridgeFrom?: string;
  bridgeTo?: string;
  serviceId?: string;
  creativeBrief?: string;
  quotePrice?: string;
} | null;

type PaidResendMeta = {
  agentId?: AgentId;
  serviceId?: string;
  resource?: string;
  brief?: string;
};

function explorerTx(hash: string) {

  return `${NETWORK.explorer}/tx/${hash}`;
}

const WELCOME: ChatMsg = {
  id: "welcome",
  role: "system",
  text: "Hi, I'm Beacon on Flare Coston2. Intent → Quote → Pay (if needed) → Execute → Receipt. Ask for FTSO, swap, bridge routes, a logo, or Bound Work.",
};

type FlowConv = {
  id: string;
  title: string;
  agent_id: string;
  pinned: boolean;
  updated_at: string;
  created_at: string;
};

export function FlowPage() {
  const qc = useQueryClient();
  const [agentId, setAgentId] = useState<AgentId>("general");
  const [input, setInput] = useState("");
  const [wallet, setWallet] = useState<string | null>(null);
  const [convState, setConvState] = useState<ConvState>(null);
  const [settledServiceIds, setSettledServiceIds] = useState<Set<string>>(() => new Set());
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([WELCOME]);
  const [convSearch, setConvSearch] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [executionStates, setExecutionStates] = useState<Record<string, CardExecutionState>>({});
  const [showAllAgents, setShowAllAgents] = useState(false);

  const onExecutionStateChange = useCallback((key: string, state: CardExecutionState) => {
    setExecutionStates((prev) => ({ ...prev, [key]: { ...prev[key], ...state } }));
  }, []);

  useEffect(() => {
    void (async () => {
      const restored = await tryRestoreWallet();
      if (restored) setWallet(restored);
    })();
  }, []);

  // Auto-resume most recent conversation when wallet reconnects
  useEffect(() => {
    if (!wallet || conversationId) return;
    void (async () => {
      try {
        const { conversations } = await api.listFlowConversations(wallet);
        if (conversations[0]?.id) {
          await loadConversation(conversations[0].id, wallet);
        }
      } catch {
        /* empty history is fine */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on wallet connect
  }, [wallet]);

  const agentsQuery = useQuery({
    queryKey: ["agents"],
    queryFn: () => api.agents(),
  });

  const balancesQuery = useQuery({
    queryKey: ["balances", wallet],
    queryFn: () => api.agentBalances(wallet!),
    enabled: Boolean(wallet),
    refetchInterval: 20_000,
  });

  const conversationsQuery = useQuery({
    queryKey: ["flow-conversations", wallet],
    queryFn: () => api.listFlowConversations(wallet!),
    enabled: Boolean(wallet),
    refetchInterval: 30_000,
  });

  const activityQuery = useQuery({
    queryKey: ["flow-activity", wallet],
    queryFn: () => api.listFlowActivity(wallet!),
    enabled: Boolean(wallet),
  });

  async function loadConversation(id: string, w: string) {
    const data = await api.getFlowConversation(id, w);
    setConversationId(data.conversation.id);
    setAgentId((data.conversation.agent_id as AgentId) || "general");
    const state = data.conversation.state_json as ConvState;
    setConvState(state && typeof state === "object" && "intent" in state ? (state as ConvState) : null);
    const loaded: ChatMsg[] =
      data.messages.length > 0
        ? data.messages.map((m) => ({
            id: m.id,
            role: m.role as ChatMsg["role"],
            agentId: m.agentId as AgentId | undefined,
            text: m.text,
            cards: m.cards as AgentCard[] | undefined,
            displayModel: m.displayModel,
          }))
        : [WELCOME];
    setSettledServiceIds(inferSettledServiceIds(loaded));
    setExecutionStates({});
    setMessages(loaded);
  }

  async function startNewChat() {
    if (!wallet) {
      setConversationId(null);
      setConvState(null);
      setSettledServiceIds(new Set());
      setAgentId("general");
      setMessages([WELCOME]);
      return;
    }
    const { conversation } = await api.createFlowConversation(wallet, "New chat", agentId);
    setConversationId(conversation.id);
    setConvState(null);
    setSettledServiceIds(new Set());
    setMessages([WELCOME]);
    void qc.invalidateQueries({ queryKey: ["flow-conversations", wallet] });
  }

  const chat = useMutation({
    mutationFn: (message: string) =>
      api.agentChat({
        agentId,
        message,
        wallet: wallet ?? undefined,
        conversationId: conversationId ?? undefined,
        state: convState,
      }),
    onSuccess: (data, message) => {
      const nextAgent = data.agentId as AgentId;
      setAgentId(nextAgent);
      setConvState(data.state);
      if (data.conversationId) setConversationId(data.conversationId);
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: "user", text: message, agentId },
        {
          id: crypto.randomUUID(),
          role: "assistant",
          agentId: nextAgent,
          text: data.text,
          cards: data.cards as AgentCard[],
          displayModel: data.displayModel || "Beacon",
        },
      ]);
      if (wallet) {
        void qc.invalidateQueries({ queryKey: ["balances", wallet] });
        void qc.invalidateQueries({ queryKey: ["flow-conversations", wallet] });
        void qc.invalidateQueries({ queryKey: ["flow-activity", wallet] });
      }
    },
    onError: (err) => {
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: err instanceof ApiError ? err.message : "Something went wrong. Please try again.",
          displayModel: "Beacon",
        },
      ]);
    },
  });

  const agents = agentsQuery.data?.agents ?? [];
  const active = useMemo(
    () => agents.find((a) => a.id === agentId) ?? { id: agentId, name: agentId, blurb: "", builtIn: true },
    [agents, agentId],
  );

  const conversations = useMemo(() => {
    const list = (conversationsQuery.data?.conversations ?? []) as FlowConv[];
    const q = convSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversationsQuery.data, convSearch]);

  async function onConnect() {
    const acct = await connectEvmWallet();
    setWallet(acct);
  }

  function send() {
    const text = input.trim();
    if (!text || chat.isPending) return;
    setInput("");
    chat.mutate(text);
  }

  const bal = balancesQuery.data?.balances;
  const recentActivity = activityQuery.data?.activity?.slice(0, 5) ?? [];
  const activeExecution = useMemo(
    () => findActiveExecution(messages, executionStates, settledServiceIds),
    [messages, executionStates, settledServiceIds],
  );

  return (
    <div className="flex h-full max-h-dvh overflow-hidden bg-[var(--p-bg)] text-[var(--p-fg)]">
      {/* Conversations sidebar */}
      <aside className="hidden w-72 shrink-0 flex-col border-r border-[var(--p-border)] bg-[var(--p-rail)] md:flex">
        <div className="shrink-0 space-y-3 border-b border-[var(--p-border)] px-3 py-3">
          <div className="flex items-center justify-between px-1">
            <div>
              <p className="font-display text-lg font-semibold tracking-tight">beacon</p>
              <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--p-muted)]">AI OS · Coston2</p>
            </div>
            <span className="rounded-full bg-signal/20 px-2 py-0.5 font-mono text-[10px] text-[var(--p-accent-text)]">LIVE</span>
          </div>
          <button
            type="button"
            onClick={() => void startNewChat()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-signal px-3 py-2 text-sm font-medium text-[var(--p-on-accent)] transition-transform hover:brightness-105 active:scale-[0.99]"
          >
            New chat
          </button>
          <nav className="flex gap-1 rounded-lg border border-[var(--p-border)] bg-[var(--p-bg)] p-1">
            <Link
              to="/flow"
              className="flex-1 rounded-md bg-signal/15 px-2 py-1.5 text-center text-[11px] font-medium text-[var(--p-accent-text)]"
            >
              Flow
            </Link>
            <Link
              to="/flow/desk"
              className="flex-1 rounded-md px-2 py-1.5 text-center text-[11px] text-[var(--p-muted)] hover:bg-[var(--p-hover)] hover:text-[var(--p-fg)]"
            >
              Bound Work
            </Link>
            <Link
              to="/flow/security"
              className="flex-1 rounded-md px-2 py-1.5 text-center text-[11px] text-[var(--p-muted)] hover:bg-[var(--p-hover)] hover:text-[var(--p-fg)]"
            >
              Security
            </Link>
          </nav>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-[var(--p-muted)]" />
            <input
              value={convSearch}
              onChange={(e) => setConvSearch(e.target.value)}
              placeholder="Search chats…"
              className="w-full rounded-lg border border-[var(--p-border)] bg-[var(--p-bg)] py-2 pl-8 pr-2 text-xs text-[var(--p-fg)] outline-none placeholder:text-[var(--p-muted)] focus:border-signal/40"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {!wallet && (
            <p className="px-2 py-4 text-xs leading-relaxed text-[var(--p-muted)]">
              Connect your wallet, chats, swaps, payments, and receipts persist by address across refresh and devices.
            </p>
          )}
          {wallet && conversations.length === 0 && !conversationsQuery.isLoading && (
            <p className="px-2 py-4 text-xs text-[var(--p-muted)]">No conversations yet. Send a message to start.</p>
          )}
          <div className="space-y-0.5">
            {conversations.map((c) => {
              const on = c.id === conversationId;
              return (
                <div
                  key={c.id}
                  className={cn(
                    "group flex items-center gap-1 rounded-lg px-2 py-2 text-left text-sm transition",
                    on ? "bg-[var(--p-hover)]" : "hover:bg-[var(--p-hover)]",
                  )}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => wallet && void loadConversation(c.id, wallet)}
                  >
                    {renamingId === c.id ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && wallet) {
                            e.preventDefault();
                            void api
                              .patchFlowConversation(c.id, { wallet, title: renameValue.trim() || c.title })
                              .then(() => {
                                setRenamingId(null);
                                void qc.invalidateQueries({ queryKey: ["flow-conversations", wallet] });
                              });
                          }
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        className="w-full rounded bg-[var(--p-surface-2)] px-1.5 py-0.5 text-xs outline-none"
                      />
                    ) : (
                      <>
                        <span className="flex items-center gap-1.5">
                          {c.pinned && <span className="text-[10px] text-[var(--p-accent-text)]">Pinned</span>}
                          <span className="truncate font-medium">{c.title}</span>
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-[10px] text-[var(--p-muted)]">
                          {new Date(c.updated_at).toLocaleString()} · {c.agent_id}
                        </span>
                      </>
                    )}
                  </button>
                  {wallet && renamingId !== c.id && (
                    <div className="hidden shrink-0 gap-0.5 group-hover:flex">
                      <button
                        type="button"
                        title="Rename"
                        className="rounded p-1 text-[var(--p-muted)] hover:bg-[var(--p-hover)] hover:text-[var(--p-fg)]"
                        onClick={() => {
                          setRenamingId(c.id);
                          setRenameValue(c.title);
                        }}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        title={c.pinned ? "Unpin" : "Pin"}
                        className="rounded p-1 text-[var(--p-muted)] hover:bg-[var(--p-hover)] hover:text-[var(--p-accent-text)]"
                        onClick={() =>
                          void api.patchFlowConversation(c.id, { wallet, pinned: !c.pinned }).then(() =>
                            qc.invalidateQueries({ queryKey: ["flow-conversations", wallet] }),
                          )
                        }
                      >
                        ★
                      </button>
                      <button
                        type="button"
                        title="Archive"
                        className="rounded p-1 text-[var(--p-muted)] hover:bg-[var(--p-hover)] hover:text-[var(--p-danger)]"
                        onClick={() =>
                          void api.patchFlowConversation(c.id, { wallet, archive: true }).then(() => {
                            if (conversationId === c.id) void startNewChat();
                            void qc.invalidateQueries({ queryKey: ["flow-conversations", wallet] });
                          })
                        }
                      >
                        ×
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {recentActivity.length > 0 && (
            <div className="mt-4 border-t border-[var(--p-border)] px-1 pt-3">
              <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-[var(--p-muted)]">Recent activity</p>
              <ul className="space-y-1.5">
                {recentActivity.map((a) => (
                  <li key={a.id} className="truncate text-[11px] text-[var(--p-muted)]">
                    <span className="text-[var(--p-accent-text)]">{a.kind}</span> · {a.title}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-[var(--p-border)] px-3 py-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--p-muted)]">Agents (shortcut)</p>
          <div className="mt-2 flex max-h-28 flex-wrap gap-1 overflow-y-auto">
            {agents.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  setAgentId(a.id as AgentId);
                  setInput((v) => (v.includes("@") ? v : `${a.mention} `));
                }}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px]",
                  a.id === agentId
                    ? "border-signal/50 bg-signal/15 text-[var(--p-accent-text)]"
                    : "border-[var(--p-border)] text-[var(--p-muted)] hover:border-[var(--p-border-strong)]",
                )}
              >
                {a.name}
              </button>
            ))}
          </div>
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* Fixed header */}
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--p-border)] px-5 py-3">
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold">{active.name}</h1>
            <p className="mt-0.5 max-w-xl truncate text-sm text-[var(--p-muted)]">
              {(active as { blurb?: string }).blurb || "Intent → Quote → Pay → Execute → Receipt"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="hidden rounded-full border border-[var(--p-border)] bg-[var(--p-card)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide text-[var(--p-muted)] sm:inline">
              Coston2
            </span>
            {wallet && bal && (
              <div className="hidden items-center gap-2 rounded-full border border-[var(--p-border)] bg-[var(--p-card)] px-3 py-1.5 font-mono text-[10px] text-[var(--p-muted)] lg:flex">
                <span title="SparkDEX / faucet USDT0">
                  <span className="text-[var(--p-muted)]">USDT0</span> {bal.usdt0.formatted}
                </span>
                {bal.mockUsdt0 && (
                  <>
                    <span className="text-[var(--p-muted)]">·</span>
                    <span title="Beacon x402 / desk token">
                      <span className="text-[var(--p-muted)]">Mock</span> {bal.mockUsdt0.formatted}
                    </span>
                  </>
                )}
                <span className="text-[var(--p-muted)]">·</span>
                <span>
                  <span className="text-[var(--p-muted)]">FXRP</span> {bal.fxrp.formatted}
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={() => void startNewChat()}
              className="rounded-full border border-[var(--p-border)] px-3 py-1.5 text-xs text-[var(--p-muted)] hover:border-signal/40 md:hidden"
            >
              New
            </button>
            <Link
              to="/flow/security"
              className="rounded-full border border-[var(--p-border)] px-3 py-1.5 text-xs text-[var(--p-muted)] hover:border-signal/40 hover:text-[var(--p-accent-text)]"
            >
              Security
            </Link>
            {wallet ? (
              <span className="rounded-full border border-[var(--p-border)] px-3 py-1.5 font-mono text-xs text-[var(--p-muted)]">
                {shortAddress(wallet)}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => void onConnect()}
                className="rounded-full bg-signal px-4 py-1.5 text-sm font-medium text-ink"
              >
                Connect
              </button>
            )}
          </div>
        </header>

        {/* Only messages scroll */}
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-6">
          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
              >
                {msg.role === "user" ? (
                  <div className="max-w-[85%] rounded-2xl bg-[var(--p-user-bubble)] px-4 py-2.5 text-sm text-[var(--p-fg)]">
                    {msg.text}
                  </div>
                ) : msg.role === "system" ? (
                  <div className="max-w-[90%] rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] px-4 py-3 text-sm leading-relaxed text-[var(--p-muted)]">
                    {msg.text}
                  </div>
                ) : (
                  <div className="max-w-[90%] space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="font-display text-sm font-semibold tracking-tight text-[var(--p-fg)]">Beacon</span>
                      {msg.displayModel && (
                        <span className="rounded-full border border-[var(--p-border)] bg-[var(--p-card)] px-2 py-0.5 font-mono text-[10px] text-[var(--p-muted)]">
                          Powered by {msg.displayModel}
                        </span>
                      )}
                    </div>
                    <AgentText text={msg.text} />
                    {msg.cards?.map((card, i) => (
                      <ActionCard
                        key={`${msg.id}-${i}`}
                        card={card}
                        cardKey={cardKey(msg.id, i)}
                        wallet={wallet}
                        convState={convState}
                        settledServiceIds={settledServiceIds}
                        onExecutionStateChange={onExecutionStateChange}
                        onConnect={() => void onConnect()}
                        onMint={() => void mintMockUsdt0()}
                        onBalancesRefresh={() => {
                          if (wallet) void qc.invalidateQueries({ queryKey: ["balances", wallet] });
                        }}
                        onQuickReply={(text) => {
                          setInput("");
                          chat.mutate(text);
                        }}
                        onPaidResend={(payment, meta) => {
                          const brief =
                            meta.brief ??
                            convState?.creativeBrief ??
                            [...messages].reverse().find((m) => m.role === "user")?.text ??
                            "";
                          void api
                            .agentChat({
                              agentId: meta.agentId ?? msg.agentId,
                              message: brief,
                              wallet: wallet ?? undefined,
                              conversationId: conversationId ?? undefined,
                              state: convState,
                              serviceId: meta.serviceId,
                              resource: meta.resource,
                              payment: {
                                ...payment,
                                serviceId: meta.serviceId,
                                resource: meta.resource,
                              },
                            })
                            .then((data) => {
                              setConvState(data.state);
                              if (data.conversationId) setConversationId(data.conversationId);
                              if (meta.serviceId) {
                                setSettledServiceIds((prev) => new Set(prev).add(meta.serviceId!));
                              }
                              setMessages((m) => [
                                ...m,
                                {
                                  id: crypto.randomUUID(),
                                  role: "assistant",
                                  agentId: data.agentId as AgentId,
                                  text: data.text,
                                  cards: data.cards as AgentCard[],
                                  displayModel: data.displayModel || "Beacon",
                                },
                              ]);
                              if (wallet) {
                                void qc.invalidateQueries({ queryKey: ["flow-conversations", wallet] });
                                void qc.invalidateQueries({ queryKey: ["flow-activity", wallet] });
                              }
                            });
                        }}
                      />
                    ))}
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
          {chat.isPending && (
            <div className="flex items-center gap-2 text-sm text-[var(--p-muted)]">
              <Loader2 className="size-4 animate-spin text-[var(--p-accent-text)]" />
              <span className="font-display">Thinking…</span>
            </div>
          )}
        </div>

        {/* Fixed composer */}
        <div className="shrink-0 border-t border-[var(--p-border)] bg-[var(--p-rail)] px-5 py-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-full border border-signal/50 bg-signal/15 px-3 py-1 text-xs text-[var(--p-accent-text)]"
            >
              {active.name}
            </button>
            <button
              type="button"
              onClick={() => setShowAllAgents((v) => !v)}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--p-border)] px-3 py-1 text-xs text-[var(--p-muted)] hover:border-[var(--p-border-strong)]"
            >
              All agents
              <ChevronDown className={cn("size-3 transition", showAllAgents && "rotate-180")} />
            </button>
            <AnimatePresence>
              {showAllAgents && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex w-full flex-wrap gap-1.5 overflow-hidden"
                >
                  {agents.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => {
                        setAgentId(a.id as AgentId);
                        setInput((v) => (v.includes("@") ? v : `${a.mention} `));
                        setShowAllAgents(false);
                      }}
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 text-[11px]",
                        a.id === agentId
                          ? "border-signal/50 bg-signal/15 text-[var(--p-accent-text)]"
                          : "border-[var(--p-border)] text-[var(--p-muted)] hover:border-signal/30",
                      )}
                    >
                      {a.name}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div className="flex items-end gap-2 rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] px-3 py-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={2}
              placeholder="Message Beacon… (intent auto-detects, or use @swap @bridge @image)"
              className="max-h-32 min-h-[44px] flex-1 resize-none bg-transparent text-sm text-[var(--p-fg)] outline-none placeholder:text-[var(--p-muted)]"
            />
            <button
              type="button"
              onClick={send}
              disabled={chat.isPending || !input.trim()}
              className="grid size-10 place-items-center rounded-xl bg-signal text-ink disabled:opacity-40"
            >
              <Send className="size-4" />
            </button>
          </div>
          <p className="mt-2 text-center text-[11px] text-[var(--p-muted)]">
            Flare Coston2 · FTSO · SparkDEX · LayerZero OFT · x402 · EIP-3009 · verify every tx on explorer
          </p>
        </div>
        </div>

        <ExecutionDrawer active={activeExecution} />
      </main>
    </div>
  );
}

function ActionCard({
  card,
  cardKey: execKey,
  wallet,
  convState,
  settledServiceIds,
  onExecutionStateChange,
  onConnect,
  onMint,
  onPaidResend,
  onBalancesRefresh,
  onQuickReply,
}: {
  card: AgentCard;
  cardKey: string;
  wallet: string | null;
  convState: ConvState;
  settledServiceIds: Set<string>;
  onExecutionStateChange: (key: string, state: CardExecutionState) => void;
  onConnect: () => void;
  onMint: () => void;
  onPaidResend: (payment: Record<string, unknown>, meta: PaidResendMeta) => void;
  onBalancesRefresh: () => void;
  onQuickReply: (text: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approveStatus, setApproveStatus] = useState<"idle" | "pending" | "confirmed" | "skipped">("idle");
  const [swapStatus, setSwapStatus] = useState<"idle" | "pending" | "confirmed" | "failed">("idle");
  const [sendStatus, setSendStatus] = useState<"idle" | "pending" | "confirmed" | "failed">("idle");
  const [approveHash, setApproveHash] = useState<string | null>(null);
  const [swapHash, setSwapHash] = useState<string | null>(null);
  const [sendHash, setSendHash] = useState<string | null>(null);

  useEffect(() => {
    if (
      card.type === "swap_prepare" ||
      card.type === "bridge_prepare" ||
      card.type === "x402_quote" ||
      card.type === "media_result"
    ) {
      onExecutionStateChange(execKey, {
        approveStatus,
        swapStatus,
        sendStatus,
        approveHash,
        swapHash,
        sendHash,
        payBusy: busy && card.type === "x402_quote",
      });
    }
  }, [
    card.type,
    execKey,
    approveStatus,
    swapStatus,
    sendStatus,
    approveHash,
    swapHash,
    sendHash,
    busy,
    onExecutionStateChange,
  ]);

  if (card.type === "ftso_signals") {
    const feeds = (card.feeds as Array<{ symbol: string; value: number }>) ?? [];
    return (
      <div className="overflow-hidden rounded-2xl border border-signal/25 bg-gradient-to-br from-[#12231a] to-[#0a0c0b] p-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-accent-text)]">{card.title}</p>
        <p className="mt-2 text-sm text-[var(--p-fg)]/90">{String(card.summary)}</p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {feeds.map((f) => (
            <div key={f.symbol} className="rounded-xl bg-[var(--p-bg)] px-3 py-2">
              <p className="font-mono text-[10px] text-[var(--p-muted)]">{f.symbol}</p>
              <p className="font-display text-lg text-[var(--p-fg)]">{f.value.toPrecision(5)}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 font-mono text-[10px] text-[var(--p-muted)]">bias · {String(card.bias)}</p>
      </div>
    );
  }

  if (card.type === "swap_clarify") {
    return (
      <div className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] p-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-muted)]">{card.title}</p>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div className="rounded-xl bg-[var(--p-surface-2)] px-3 py-2">
            <p className="font-mono text-[10px] text-[var(--p-muted)]">USDT0</p>
            <p className="font-display text-lg">{String(card.usdt0Balance ?? "-")}</p>
          </div>
          <div className="rounded-xl bg-[var(--p-surface-2)] px-3 py-2">
            <p className="font-mono text-[10px] text-[var(--p-muted)]">FXRP</p>
            <p className="font-display text-lg">{String(card.fxrpBalance ?? "-")}</p>
          </div>
        </dl>
        <div className="mt-3 flex flex-wrap gap-2">
          {["1", "5", "10", "all"].map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => onQuickReply(a === "all" ? "swap all" : `swap ${a}`)}
              className="rounded-full border border-[var(--p-border)] px-3 py-1.5 text-xs text-[var(--p-muted)] hover:border-signal/40"
            >
              {a === "all" ? "Swap all" : `${a} USDT0`}
            </button>
          ))}
          <a
            href={String(card.faucetHref)}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-[var(--p-border)] px-3 py-1.5 text-xs text-[var(--p-muted)]"
          >
            Faucet
          </a>
        </div>
      </div>
    );
  }

  if (card.type === "swap_quote") {
    return (
      <div className="rounded-2xl border border-signal/20 bg-gradient-to-br from-[#14201a] to-[#0a0c0b] p-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-accent-text)]">{card.title}</p>
        <div className="mt-3 flex flex-wrap items-end gap-6">
          <div>
            <p className="font-mono text-[10px] text-[var(--p-muted)]">You pay</p>
            <p className="font-display text-2xl text-[var(--p-fg)]">{String(card.amountInDisplay)} USDT0</p>
          </div>
          <div>
            <p className="font-mono text-[10px] text-[var(--p-muted)]">Est. receive</p>
            <p className="font-display text-2xl text-[var(--p-accent-text)]">~{String(card.estimatedFxrp)} FXRP</p>
          </div>
        </div>
        <p className="mt-2 text-xs text-[var(--p-muted)]">
          XRP/USD ~${Number(card.xrpUsd).toFixed(4)} · balance {String(card.usdt0Balance)} USDT0 · {String(card.network)}
        </p>
        <p className="mt-1 text-xs text-[var(--p-muted)]">{String(card.note)}</p>
        <button
          type="button"
          onClick={() => onQuickReply("confirm")}
          className="mt-4 rounded-full bg-signal px-5 py-2 text-sm font-medium text-ink"
        >
          Confirm swap
        </button>
      </div>
    );
  }

  if (card.type === "swap_prepare") {
    return (
      <div className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] p-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-accent-text)]">{card.title}</p>
        <p className="mt-2 text-sm text-[var(--p-fg)]/80">
          Swap <span className="text-[var(--p-fg)]">{String(card.amountInDisplay)} USDT0</span>
          {" → "}
          <span className="text-[var(--p-accent-text)]">~{String(card.estimatedFxrp)} FXRP</span> on SparkDEX
        </p>
        <p className="mt-1 text-xs text-[var(--p-muted)]">{String(card.warning)}</p>

        <div className="mt-4 space-y-2">
          <StatusRow
            label="Approve USDT0"
            status={approveStatus}
            hash={approveHash}
          />
          <StatusRow label="Swap" status={swapStatus} hash={swapHash} />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {!wallet && (
            <button type="button" onClick={onConnect} className="rounded-full bg-signal px-4 py-2 text-sm text-[var(--p-fg)]">
              Connect wallet
            </button>
          )}
          {wallet && swapStatus !== "confirmed" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    const result = await executeSparkDexSwap({
                      approveTo: card.approveTo as Address,
                      approveData: card.approveData as Hex,
                      swapTo: card.swapTo as Address,
                      swapData: card.swapData as Hex,
                      onStep: (s) => {
                        if (s.step === "approve") {
                          setApproveStatus(s.status);
                          if (s.hash) setApproveHash(s.hash);
                        }
                        if (s.step === "swap") {
                          setSwapStatus(s.status);
                          if (s.hash) setSwapHash(s.hash);
                        }
                      },
                    });
                    if (result.approveHash) setApproveHash(result.approveHash);
                    setSwapHash(result.swapHash);
                    setSwapStatus("confirmed");
                    onBalancesRefresh();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Swap failed");
                    setSwapStatus((prev) => (prev === "pending" ? "failed" : prev));
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
              className="rounded-full bg-signal px-4 py-2 text-sm font-medium text-ink disabled:opacity-50"
            >
              {busy ? "Confirm in wallet…" : "Approve + Swap"}
            </button>
          )}
          <a
            href={NETWORK.faucet}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-[var(--p-border)] px-4 py-2 text-sm text-[var(--p-muted)]"
          >
            Coston2 faucet
          </a>
        </div>
        {error && <p className="mt-2 text-xs text-[var(--p-danger)]">{error}</p>}
        {swapStatus === "confirmed" && swapHash && (
          <p className="mt-3 text-sm text-[var(--p-accent-text)]">
            Swap confirmed.{" "}
            <a href={explorerTx(swapHash)} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              View on explorer
            </a>
          </p>
        )}
      </div>
    );
  }

  if (card.type === "bridge_quote") {
    const fee = formatNativeFeeDisplay(String(card.nativeFeeDisplay ?? ""));
    const amount = formatTokenAmount(String(card.amountDisplay ?? ""), "FXRP");
    return (
      <div className="overflow-hidden rounded-2xl border border-[var(--p-border)] bg-[var(--p-surface)]">
        <div className="border-b border-[var(--p-border)] bg-signal/10 px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--p-accent-text)]">Live quote · LayerZero</p>
          <p className="mt-1 font-display text-lg font-semibold tracking-tight">{String(card.title)}</p>
        </div>
        <div className="grid gap-0 sm:grid-cols-3">
          <div className="border-b border-[var(--p-border)] px-4 py-4 sm:border-b-0 sm:border-r">
            <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--p-muted)]">Amount</p>
            <p className="mt-1 font-display text-2xl font-semibold tabular-nums">{amount}</p>
          </div>
          <div className="border-b border-[var(--p-border)] px-4 py-4 sm:border-b-0 sm:border-r">
            <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--p-muted)]">Destination</p>
            <p className="mt-1 font-display text-2xl font-semibold">{String(card.destination)}</p>
            <p className="mt-0.5 font-mono text-[10px] text-[var(--p-muted)]">EID {String(card.dstEid)}</p>
          </div>
          <div className="px-4 py-4">
            <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--p-muted)]">Messaging fee</p>
            <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-[var(--p-accent-text)]">{fee}</p>
            <p className="mt-0.5 font-mono text-[10px] text-[var(--p-muted)]">quoteSend · Coston2</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--p-border)] px-4 py-3">
          <p className="text-xs text-[var(--p-muted)]">
            Balance {formatTokenAmount(String(card.fxrpBalance ?? ""), "FXRP")} · {String(card.network)}
          </p>
          <button
            type="button"
            onClick={() => onQuickReply("confirm")}
            className="rounded-full bg-signal px-5 py-2 text-sm font-medium text-ink transition active:scale-[0.98]"
          >
            Confirm bridge
          </button>
        </div>
      </div>
    );
  }

  if (card.type === "bridge_prepare") {
    const lzScanBase = String(card.layerZeroScanBase ?? "https://testnet.layerzeroscan.com/tx/");
    const fee = formatNativeFeeDisplay(String(card.nativeFeeDisplay ?? ""));
    return (
      <div className="overflow-hidden rounded-2xl border border-[var(--p-border)] bg-[var(--p-surface)]">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--p-border)] px-4 py-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--p-accent-text)]">Confirm in wallet</p>
            <p className="mt-1 font-display text-base font-semibold">
              {formatTokenAmount(String(card.amountDisplay ?? ""), "FXRP")}
              <span className="mx-2 text-[var(--p-muted)]">→</span>
              {String(card.destination)}
            </p>
          </div>
          <div className="rounded-xl border border-signal/30 bg-signal/10 px-3 py-2 text-right">
            <p className="font-mono text-[10px] text-[var(--p-muted)]">Fee</p>
            <p className="font-display text-lg font-semibold tabular-nums text-[var(--p-accent-text)]">{fee}</p>
          </div>
        </div>

        <div className="space-y-2 px-4 py-4">
          <StatusRow label="Approve FXRP" status={approveStatus} hash={approveHash} />
          <StatusRow label="OFT send" status={sendStatus} hash={sendHash} />
        </div>

        <div className="flex flex-wrap gap-2 border-t border-[var(--p-border)] px-4 py-3">
          {!wallet && (
            <button type="button" onClick={onConnect} className="rounded-full bg-signal px-4 py-2 text-sm font-medium text-ink">
              Connect wallet
            </button>
          )}
          {wallet && sendStatus !== "confirmed" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    const result = await executeOftBridge({
                      approveTo: card.approveTo as Address,
                      approveData: card.approveData as Hex,
                      sendTo: card.sendTo as Address,
                      sendData: card.sendData as Hex,
                      nativeFee: BigInt(String(card.nativeFee)),
                      onStep: (s) => {
                        if (s.step === "approve") {
                          setApproveStatus(s.status);
                          if (s.hash) setApproveHash(s.hash);
                        }
                        if (s.step === "send") {
                          setSendStatus(s.status);
                          if (s.hash) setSendHash(s.hash);
                        }
                      },
                    });
                    if (result.approveHash) setApproveHash(result.approveHash);
                    setSendHash(result.sendHash);
                    setSendStatus("confirmed");
                    onBalancesRefresh();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Bridge send failed");
                    setSendStatus((prev) => (prev === "pending" ? "failed" : prev));
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
              className="rounded-full bg-signal px-4 py-2 text-sm font-medium text-ink disabled:opacity-50"
            >
              {busy ? "Confirm in wallet…" : "Approve + Send"}
            </button>
          )}
        </div>
        {error && <p className="px-4 pb-3 text-xs text-[var(--p-danger)]">{error}</p>}
        {sendStatus === "confirmed" && sendHash && (
          <div className="space-y-2 border-t border-[var(--p-border)] bg-signal/5 px-4 py-3 text-sm">
            <p className="font-medium text-[var(--p-accent-text)]">Source tx confirmed on Coston2</p>
            <div className="flex flex-wrap gap-2">
              <a
                href={explorerTx(sendHash)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-[var(--p-border)] px-3 py-1 text-xs hover:border-signal/40"
              >
                Coston2 explorer <ExternalLink className="size-3" />
              </a>
              <a
                href={`${lzScanBase}${sendHash}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-signal/40 bg-signal/10 px-3 py-1 text-xs text-[var(--p-accent-text)]"
              >
                LayerZero Scan <ExternalLink className="size-3" />
              </a>
            </div>
            <p className="text-xs text-[var(--p-muted)]">
              When LayerZero shows Delivered, open the destination tx on Sepolia from Scan. Beacon never invents fills.
            </p>
          </div>
        )}
      </div>
    );
  }

  if (card.type === "bridge_clarify" || card.type === "media_clarify") {
    const prompts = (card.prompts as string[]) ?? [];
    const isVideo = card.kind === "video";
    const isImage = card.kind === "image" || card.type === "media_clarify";
    return (
      <div className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] p-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-muted)]">{card.title}</p>
        <ul className="mt-3 space-y-1.5 text-sm text-[var(--p-muted)]">
          {prompts.map((p) => (
            <li key={p} className="flex gap-2">
              <span className="text-[var(--p-accent-text)]">·</span>
              {p}
            </li>
          ))}
        </ul>
        {isVideo && (
          <div className="mt-3 flex flex-wrap gap-2">
            {["15", "30", "60"].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => onQuickReply(`${d} sec, 9:16, cinematic`)}
                className="rounded-full border border-[var(--p-border)] px-3 py-1.5 text-xs text-[var(--p-muted)] hover:border-signal/40"
              >
                {d}s
              </button>
            ))}
          </div>
        )}
        {isImage && !isVideo && (
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              { label: "Minimal green", text: "Company Beacon, colors green + black, minimal geometric, transparent yes" },
              { label: "Bold mark", text: "Bold logo mark, high contrast, no serif, transparent background" },
              { label: "Skip to quote", text: "Name Beacon OS, colors signal green, style minimal, transparent yes" },
            ].map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={() => onQuickReply(c.text)}
                className="rounded-full border border-[var(--p-border)] px-3 py-1.5 text-xs text-[var(--p-muted)] hover:border-signal/40"
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
        {typeof card.deskHref === "string" && card.deskHref ? (
          <Link to={card.deskHref} className="mt-3 inline-flex text-sm text-[var(--p-accent-text)] underline-offset-2 hover:underline">
            Open Bound Work desk
          </Link>
        ) : null}
      </div>
    );
  }

  if (card.type === "bridge_routes") {
    const routes =
      (card.routes as Array<{
        chain: string;
        eid: number;
        asset: string;
        status: string;
        eta: string;
        fees: string;
      }>) ?? [];
    const docs = (card.docs as Array<{ label: string; href: string }>) ?? [];
    const unavailable = (card.unavailable as string[]) ?? [];
    return (
      <div className="rounded-2xl border border-signal/30 bg-gradient-to-br from-[#1a1528] to-[#0a0c0b] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-accent-text)]">{card.title}</p>
          <span className="rounded-full bg-signal/15 px-2 py-0.5 font-mono text-[10px] text-[var(--p-accent-text)]">
            LayerZero OFT · FAssets
          </span>
        </div>
        <p className="mt-2 text-xs text-[var(--p-muted)]">Source · {String(card.source)}</p>
        <div className="mt-3 space-y-2">
          {routes.map((r) => (
            <div key={r.eid} className="rounded-xl bg-[var(--p-bg)] px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-[var(--p-fg)]">{r.chain}</span>
                <span className="font-mono text-[10px] text-[var(--p-accent-text)]">{r.status}</span>
              </div>
              <p className="mt-1 font-mono text-[11px] text-[var(--p-muted)]">
                {r.asset} · EID {r.eid} · ETA {r.eta}
              </p>
              <p className="text-[11px] text-[var(--p-muted)]">{r.fees}</p>
              <button
                type="button"
                onClick={() => onQuickReply(`bridge FXRP to ${r.chain}`)}
                className="mt-2 rounded-full border border-[var(--p-border)] px-3 py-1 text-[11px] text-[var(--p-muted)] hover:border-signal/40"
              >
                Plan this route
              </button>
            </div>
          ))}
        </div>
        {unavailable.length > 0 && (
          <p className="mt-3 text-xs text-amber-200/70">Unavailable: {unavailable.join(" · ")}</p>
        )}
        <p className="mt-2 text-xs text-[var(--p-muted)]">{String(card.honesty)}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {docs.map((l) => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-[var(--p-border)] px-3 py-1.5 text-xs text-[var(--p-muted)] hover:border-signal/40"
            >
              {l.label}
            </a>
          ))}
        </div>
      </div>
    );
  }

  if (card.type === "bridge_intent") {
    const links = (card.links as Array<{ label: string; href: string }>) ?? [];
    return (
      <div className="rounded-2xl border border-[var(--p-border)] bg-[var(--p-card)] p-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-accent-text)]">{card.title}</p>
        <p className="mt-2 text-sm text-[var(--p-fg)]/90">{String(card.summary)}</p>
        <p className="mt-2 text-xs text-amber-200/80">{String(card.honesty)}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-[var(--p-border)] px-3 py-1.5 text-xs text-[var(--p-muted)] hover:border-signal/40"
            >
              {l.label}
            </a>
          ))}
        </div>
      </div>
    );
  }

  if (card.type === "x402_quote") {
    const serviceId = typeof card.serviceId === "string" ? card.serviceId : "";
    const isSettled = serviceId ? settledServiceIds.has(serviceId) : false;
    return (
      <div className="overflow-hidden rounded-2xl border border-[var(--p-border)] bg-[var(--p-surface)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--p-border)] px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--p-muted)]">{card.title}</p>
            <span className="rounded-full bg-signal/15 px-2 py-0.5 font-mono text-[10px] text-[var(--p-accent-text)]">
              {String(card.flarePrimitive ?? "x402")}
            </span>
          </div>
          {isSettled ? (
            <span className="rounded-full bg-signal/20 px-2.5 py-0.5 font-mono text-[10px] text-[var(--p-accent-text)]">Settled</span>
          ) : (
            <span className="rounded-full border border-[var(--p-border)] px-2.5 py-0.5 font-mono text-[10px] text-[var(--p-muted)]">
              Unpaid
            </span>
          )}
        </div>
        <div className="px-4 py-4">
        <p className="font-display text-3xl font-semibold tabular-nums text-[var(--p-fg)]">${String(card.priceUsdt0)}</p>
        <dl className="mt-3 space-y-1.5 text-sm text-[var(--p-muted)]">
          <div>
            <span className="text-[var(--p-muted)]">Provider · </span>
            {String(card.provider ?? "Beacon")}
          </div>
          <div>
            <span className="text-[var(--p-muted)]">Why · </span>
            {String(card.reason ?? "Paid resource")}
          </div>
          <div>
            <span className="text-[var(--p-muted)]">ETA · </span>~{String(card.etaSeconds ?? 30)}s
          </div>
          <div className="font-mono text-[11px] text-[var(--p-muted)]">
            MockUSDT0 · EIP-3009 · chain {String(card.chainId)} · {String(card.resource)}
          </div>
        </dl>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-[var(--p-border)] px-4 py-3">
          <button type="button" onClick={onMint} className="rounded-full border border-[var(--p-border)] px-4 py-2 text-sm text-[var(--p-muted)] hover:border-signal/40">
            Mint test USDT0
          </button>
          {isSettled ? (
            <span className="inline-flex items-center rounded-full bg-signal/15 px-5 py-2 text-sm font-medium text-[var(--p-accent-text)]">
              Settled for this service
            </span>
          ) : (
          <button
            type="button"
            disabled={!wallet || busy}
            onClick={() => {
              void (async () => {
                if (!wallet) return onConnect();
                setBusy(true);
                setError(null);
                try {
                  const { signX402Payment } = await import("@/lib/x402Pay");
                  const payment = await signX402Payment({
                    amountUsdt0: String(card.priceUsdt0),
                    payTo: String(card.payTo),
                    token: String(card.token),
                  });
                  onPaidResend(payment, {
                    agentId: (card.agentId as AgentId | undefined) ?? undefined,
                    serviceId: serviceId || undefined,
                    resource: typeof card.resource === "string" ? card.resource : undefined,
                    brief:
                      (typeof card.brief === "string" && card.brief) ||
                      convState?.creativeBrief ||
                      undefined,
                  });
                } catch (e) {
                  setError(e instanceof Error ? e.message : "pay failed");
                } finally {
                  setBusy(false);
                }
              })();
            }}
            className="rounded-full bg-signal px-5 py-2 text-sm font-medium text-ink disabled:opacity-40"
          >
            {busy ? "Signing…" : "Pay & run"}
          </button>
          )}
        </div>
        {error && <p className="px-4 pb-3 text-xs text-[var(--p-danger)]">{error}</p>}
      </div>
    );
  }

  if (card.type === "media_result") {
    return (
      <div className="rounded-2xl border border-signal/25 bg-[var(--p-card)] p-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--p-accent-text)]">{card.title}</p>
        <p className="mt-2 text-sm text-[var(--p-fg)]/80">{String(card.summary)}</p>
        {typeof card.paymentTxHint === "string" && card.paymentTxHint && (
          <a
            href={explorerTx(card.paymentTxHint)}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 font-mono text-[11px] text-[var(--p-accent-text)] hover:underline"
          >
            Settlement tx · {card.paymentTxHint.slice(0, 10)}…
            <ExternalLink className="size-3" />
          </a>
        )}
        {typeof card.content === "string" && card.content.startsWith("data:image") && (
          <img src={card.content} alt="Beacon result" className="mt-3 max-h-72 rounded-xl border border-[var(--p-border)]" />
        )}
        {typeof card.content === "string" && card.kind === "research" && (
          <p className="mt-3 whitespace-pre-wrap text-sm text-[var(--p-fg)]/90">{card.content}</p>
        )}
      </div>
    );
  }

  if (card.type === "desk_link") {
    return (
      <div className="rounded-2xl border border-[var(--p-border)] p-4">
        <p className="font-medium text-[var(--p-fg)]">{card.title}</p>
        <p className="mt-1 text-sm text-[var(--p-muted)]">{String(card.summary)}</p>
        <Link to={String(card.href)} className="mt-3 inline-flex rounded-full bg-signal px-4 py-2 text-sm font-medium text-ink">
          Open desk
        </Link>
      </div>
    );
  }

  if (card.type === "insufficient") {
    return (
      <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4">
        <p className="font-medium text-amber-100">{card.title}</p>
        <p className="mt-1 text-sm text-amber-100/80">{String(card.summary)}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={onConnect} className="rounded-full bg-signal px-4 py-2 text-sm text-[var(--p-fg)]">
            Connect
          </button>
          {typeof card.faucetHref === "string" && card.faucetHref ? (
            <a
              href={card.faucetHref}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-amber-200/30 px-4 py-2 text-sm text-amber-100/80"
            >
              Faucet
            </a>
          ) : null}
        </div>
      </div>
    );
  }

  return null;
}

function StatusRow({
  label,
  status,
  hash,
}: {
  label: string;
  status: string;
  hash: string | null;
}) {
  const icon =
    status === "confirmed" || status === "skipped" ? (
      <CheckCircle2 className="size-3.5 text-[var(--p-accent-text)]" />
    ) : status === "pending" ? (
      <Clock className="size-3.5 animate-pulse text-amber-300" />
    ) : status === "failed" ? (
      <span className="size-3.5 rounded-full bg-red-400" />
    ) : (
      <span className="size-3.5 rounded-full border border-[var(--p-border)]" />
    );
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--p-surface-2)] px-3 py-2 text-xs">
      <span className="flex items-center gap-2 text-[var(--p-muted)]">
        {icon}
        {label}
        <span className="font-mono text-[var(--p-muted)]">{status === "idle" ? "ready" : status}</span>
      </span>
      {hash && (
        <a href={explorerTx(hash)} target="_blank" rel="noreferrer" className="font-mono text-[var(--p-accent-text)] hover:underline">
          {hash.slice(0, 10)}…
        </a>
      )}
    </div>
  );
}
