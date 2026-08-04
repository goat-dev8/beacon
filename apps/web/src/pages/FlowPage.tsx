import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "motion/react";
import {
  Hexagon,
  Briefcase,
  Send,
  Loader2,
  ExternalLink,
  Sparkles,
  Shield,
  Search,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import {
  connectEvmWallet,
  shortAddress,
  mintMockUsdt0,
  executeSparkDexSwap,
  tryRestoreWallet,
} from "@/lib/wallet";
import { NETWORK } from "@/lib/chain";
import { cn } from "@/lib/utils";
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

type AgentCard = Record<string, unknown> & { type: string; title?: string };

type ConvState = {
  intent: string;
  phase: string;
  amountInUnits?: string;
  bridgeFrom?: string;
  bridgeTo?: string;
} | null;

function explorerTx(hash: string) {
  return `${NETWORK.explorer}/tx/${hash}`;
}

const WELCOME: ChatMsg = {
  id: "welcome",
  role: "system",
  text: "Hi — I'm Beacon on Flare Coston2. Intent → Quote → Pay (if needed) → Execute → Receipt. Ask for FTSO, swap, bridge routes, a logo, or Bound Work.",
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
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([WELCOME]);
  const [convSearch, setConvSearch] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

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
    setMessages(loaded);
  }

  async function startNewChat() {
    if (!wallet) {
      setConversationId(null);
      setConvState(null);
      setAgentId("general");
      setMessages([WELCOME]);
      return;
    }
    const { conversation } = await api.createFlowConversation(wallet, "New chat", agentId);
    setConversationId(conversation.id);
    setConvState(null);
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

  return (
    <div className="flex h-dvh max-h-dvh overflow-hidden bg-[#0a0c0b] text-[#f0f2ef]">
      {/* Icon rail — fixed */}
      <aside className="flex w-14 shrink-0 flex-col items-center gap-3 border-r border-white/10 py-4">
        <Link to="/" className="grid size-9 place-items-center rounded-xl bg-signal text-ink" title="Beacon">
          <Hexagon className="size-5" />
        </Link>
        <Link to="/flow" className="grid size-9 place-items-center rounded-xl bg-white/10 text-signal" title="Flow">
          <Sparkles className="size-4" />
        </Link>
        <Link to="/app" className="grid size-9 place-items-center rounded-xl text-white/50 hover:bg-white/10" title="Desk">
          <Briefcase className="size-4" />
        </Link>
        <Link
          to="/flow/security"
          className="grid size-9 place-items-center rounded-xl text-white/50 hover:bg-white/10"
          title="Security"
        >
          <Shield className="size-4" />
        </Link>
        <a
          href={NETWORK.explorer}
          target="_blank"
          rel="noreferrer"
          className="mt-auto grid size-9 place-items-center rounded-xl text-white/40 hover:bg-white/10"
          title="Explorer"
        >
          <ExternalLink className="size-4" />
        </a>
      </aside>

      {/* Conversations sidebar — ChatGPT-style */}
      <aside className="hidden w-72 shrink-0 flex-col border-r border-white/10 bg-[#101412] md:flex">
        <div className="shrink-0 space-y-3 border-b border-white/10 px-3 py-3">
          <div className="flex items-center justify-between px-1">
            <div>
              <p className="font-display text-lg font-semibold tracking-tight">beacon</p>
              <p className="font-mono text-[10px] uppercase tracking-widest text-white/40">AI OS · Coston2</p>
            </div>
            <span className="rounded-full bg-signal/20 px-2 py-0.5 font-mono text-[10px] text-signal">LIVE</span>
          </div>
          <button
            type="button"
            onClick={() => void startNewChat()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-signal/90 px-3 py-2 text-sm font-medium text-ink hover:bg-signal"
          >
            New chat
          </button>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-white/35" />
            <input
              value={convSearch}
              onChange={(e) => setConvSearch(e.target.value)}
              placeholder="Search chats…"
              className="w-full rounded-lg border border-white/10 bg-black/20 py-2 pl-8 pr-2 text-xs text-white outline-none placeholder:text-white/30 focus:border-signal/40"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {!wallet && (
            <p className="px-2 py-4 text-xs leading-relaxed text-white/40">
              Connect your wallet — chats, swaps, payments, and receipts persist by address across refresh and devices.
            </p>
          )}
          {wallet && conversations.length === 0 && !conversationsQuery.isLoading && (
            <p className="px-2 py-4 text-xs text-white/40">No conversations yet. Send a message to start.</p>
          )}
          <div className="space-y-0.5">
            {conversations.map((c) => {
              const on = c.id === conversationId;
              return (
                <div
                  key={c.id}
                  className={cn(
                    "group flex items-center gap-1 rounded-lg px-2 py-2 text-left text-sm transition",
                    on ? "bg-white/10" : "hover:bg-white/5",
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
                        className="w-full rounded bg-black/40 px-1.5 py-0.5 text-xs outline-none"
                      />
                    ) : (
                      <>
                        <span className="flex items-center gap-1.5">
                          {c.pinned && <span className="text-[10px] text-signal">Pinned</span>}
                          <span className="truncate font-medium">{c.title}</span>
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-[10px] text-white/35">
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
                        className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-white"
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
                        className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-signal"
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
                        className="rounded p-1 text-white/40 hover:bg-white/10 hover:text-red-300"
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
            <div className="mt-4 border-t border-white/10 px-1 pt-3">
              <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-white/35">Recent activity</p>
              <ul className="space-y-1.5">
                {recentActivity.map((a) => (
                  <li key={a.id} className="truncate text-[11px] text-white/45">
                    <span className="text-signal">{a.kind}</span> · {a.title}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-white/10 px-3 py-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-white/35">Agents (shortcut)</p>
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
                    ? "border-signal/50 bg-signal/15 text-signal"
                    : "border-white/10 text-white/50 hover:border-white/25",
                )}
              >
                {a.name}
              </button>
            ))}
          </div>
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* Fixed header */}
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-3">
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold">{active.name}</h1>
            <p className="mt-0.5 max-w-xl truncate text-sm text-white/50">
              {(active as { blurb?: string }).blurb || "Intent → Quote → Pay → Execute → Receipt"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {wallet && bal && (
              <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 font-mono text-[11px] text-white/65 sm:flex">
                <span>{bal.usdt0.formatted} USDT0</span>
                <span className="text-white/25">·</span>
                <span>{bal.fxrp.formatted} FXRP</span>
              </div>
            )}
            <button
              type="button"
              onClick={() => void startNewChat()}
              className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/60 hover:border-signal/40 md:hidden"
            >
              New
            </button>
            <Link
              to="/flow/security"
              className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/60 hover:border-signal/40 hover:text-signal"
            >
              Security
            </Link>
            {wallet ? (
              <span className="rounded-full border border-white/15 px-3 py-1.5 font-mono text-xs text-white/70">
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
                  <div className="max-w-[85%] rounded-2xl bg-[#1e4d3a] px-4 py-2.5 text-sm text-white">
                    {msg.text}
                  </div>
                ) : msg.role === "system" ? (
                  <div className="max-w-[90%] rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm leading-relaxed text-white/70">
                    {msg.text}
                  </div>
                ) : (
                  <div className="max-w-[90%] space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="font-display text-sm font-semibold tracking-tight text-white">Beacon</span>
                      {msg.displayModel && (
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] text-white/45">
                          Powered by {msg.displayModel}
                        </span>
                      )}
                    </div>
                    <div className="whitespace-pre-wrap text-sm leading-relaxed text-white/90">{msg.text}</div>
                    {msg.cards?.map((card, i) => (
                      <ActionCard
                        key={`${msg.id}-${i}`}
                        card={card}
                        wallet={wallet}
                        onConnect={() => void onConnect()}
                        onMint={() => void mintMockUsdt0()}
                        onBalancesRefresh={() => {
                          if (wallet) void qc.invalidateQueries({ queryKey: ["balances", wallet] });
                        }}
                        onQuickReply={(text) => {
                          setInput("");
                          chat.mutate(text);
                        }}
                        onPaidResend={(payment) => {
                          const lastUser = [...messages].reverse().find((m) => m.role === "user");
                          if (!lastUser) return;
                          void api
                            .agentChat({
                              agentId: msg.agentId,
                              message: lastUser.text,
                              wallet: wallet ?? undefined,
                              conversationId: conversationId ?? undefined,
                              state: convState,
                              payment,
                            })
                            .then((data) => {
                              setConvState(data.state);
                              if (data.conversationId) setConversationId(data.conversationId);
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
            <div className="flex items-center gap-2 text-sm text-white/50">
              <Loader2 className="size-4 animate-spin text-signal" />
              <span className="font-display">Thinking…</span>
            </div>
          )}
        </div>

        {/* Fixed composer */}
        <div className="shrink-0 border-t border-white/10 bg-[#0a0c0b] px-5 py-3">
          <div className="mb-2 flex flex-wrap gap-2">
            {agents.slice(0, 8).map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  setAgentId(a.id as AgentId);
                  setInput((v) => (v.includes("@") ? v : `${a.mention} `));
                }}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs",
                  a.id === agentId
                    ? "border-signal/50 bg-signal/15 text-signal"
                    : "border-white/15 text-white/60 hover:border-white/30",
                )}
              >
                {a.name}
              </button>
            ))}
          </div>
          <div className="flex items-end gap-2 rounded-2xl border border-white/15 bg-white/[0.04] px-3 py-2">
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
              placeholder="Message Beacon… (intent auto-detects — or use @swap @bridge @image)"
              className="max-h-32 min-h-[44px] flex-1 resize-none bg-transparent text-sm text-white outline-none placeholder:text-white/35"
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
          <p className="mt-2 text-center text-[11px] text-white/30">
            Flare Coston2 · FTSO · SparkDEX · LayerZero OFT · x402 · EIP-3009 · verify every tx on explorer
          </p>
        </div>
      </main>
    </div>
  );
}

function ActionCard({
  card,
  wallet,
  onConnect,
  onMint,
  onPaidResend,
  onBalancesRefresh,
  onQuickReply,
}: {
  card: AgentCard;
  wallet: string | null;
  onConnect: () => void;
  onMint: () => void;
  onPaidResend: (payment: Record<string, unknown>) => void;
  onBalancesRefresh: () => void;
  onQuickReply: (text: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approveStatus, setApproveStatus] = useState<"idle" | "pending" | "confirmed" | "skipped">("idle");
  const [swapStatus, setSwapStatus] = useState<"idle" | "pending" | "confirmed" | "failed">("idle");
  const [approveHash, setApproveHash] = useState<string | null>(null);
  const [swapHash, setSwapHash] = useState<string | null>(null);

  if (card.type === "ftso_signals") {
    const feeds = (card.feeds as Array<{ symbol: string; value: number }>) ?? [];
    return (
      <div className="overflow-hidden rounded-2xl border border-signal/25 bg-gradient-to-br from-[#12231a] to-[#0a0c0b] p-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-signal">{card.title}</p>
        <p className="mt-2 text-sm text-white/80">{String(card.summary)}</p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {feeds.map((f) => (
            <div key={f.symbol} className="rounded-xl bg-black/30 px-3 py-2">
              <p className="font-mono text-[10px] text-white/45">{f.symbol}</p>
              <p className="font-display text-lg text-white">{f.value.toPrecision(5)}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 font-mono text-[10px] text-white/40">bias · {String(card.bias)}</p>
      </div>
    );
  }

  if (card.type === "swap_clarify") {
    return (
      <div className="rounded-2xl border border-white/12 bg-white/[0.04] p-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-white/45">{card.title}</p>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div className="rounded-xl bg-black/25 px-3 py-2">
            <p className="font-mono text-[10px] text-white/40">USDT0</p>
            <p className="font-display text-lg">{String(card.usdt0Balance ?? "—")}</p>
          </div>
          <div className="rounded-xl bg-black/25 px-3 py-2">
            <p className="font-mono text-[10px] text-white/40">FXRP</p>
            <p className="font-display text-lg">{String(card.fxrpBalance ?? "—")}</p>
          </div>
        </dl>
        <div className="mt-3 flex flex-wrap gap-2">
          {["1", "5", "10", "all"].map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => onQuickReply(a === "all" ? "swap all" : `swap ${a}`)}
              className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:border-signal/40"
            >
              {a === "all" ? "Swap all" : `${a} USDT0`}
            </button>
          ))}
          <a
            href={String(card.faucetHref)}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/50"
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
        <p className="font-mono text-[11px] uppercase tracking-widest text-signal">{card.title}</p>
        <div className="mt-3 flex flex-wrap items-end gap-6">
          <div>
            <p className="font-mono text-[10px] text-white/40">You pay</p>
            <p className="font-display text-2xl text-white">{String(card.amountInDisplay)} USDT0</p>
          </div>
          <div>
            <p className="font-mono text-[10px] text-white/40">Est. receive</p>
            <p className="font-display text-2xl text-signal">~{String(card.estimatedFxrp)} FXRP</p>
          </div>
        </div>
        <p className="mt-2 text-xs text-white/45">
          XRP/USD ~${Number(card.xrpUsd).toFixed(4)} · balance {String(card.usdt0Balance)} USDT0 · {String(card.network)}
        </p>
        <p className="mt-1 text-xs text-white/35">{String(card.note)}</p>
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
      <div className="rounded-2xl border border-white/12 bg-white/[0.04] p-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-[#93c5fd]">{card.title}</p>
        <p className="mt-2 text-sm text-white/75">
          Swap <span className="text-white">{String(card.amountInDisplay)} USDT0</span>
          {" → "}
          <span className="text-signal">~{String(card.estimatedFxrp)} FXRP</span> on SparkDEX
        </p>
        <p className="mt-1 text-xs text-white/40">{String(card.warning)}</p>

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
            <button type="button" onClick={onConnect} className="rounded-full bg-[#2563eb] px-4 py-2 text-sm text-white">
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
            className="rounded-full border border-white/20 px-4 py-2 text-sm text-white/70"
          >
            Coston2 faucet
          </a>
        </div>
        {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
        {swapStatus === "confirmed" && swapHash && (
          <p className="mt-3 text-sm text-signal">
            Swap confirmed.{" "}
            <a href={explorerTx(swapHash)} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              View on explorer
            </a>
          </p>
        )}
      </div>
    );
  }

  if (card.type === "bridge_clarify" || card.type === "media_clarify") {
    const prompts = (card.prompts as string[]) ?? [];
    const isVideo = card.kind === "video";
    const isImage = card.kind === "image" || card.type === "media_clarify";
    return (
      <div className="rounded-2xl border border-white/12 bg-white/[0.04] p-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-white/45">{card.title}</p>
        <ul className="mt-3 space-y-1.5 text-sm text-white/70">
          {prompts.map((p) => (
            <li key={p} className="flex gap-2">
              <span className="text-signal">·</span>
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
                className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:border-signal/40"
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
                className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:border-signal/40"
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
        {typeof card.deskHref === "string" && card.deskHref ? (
          <Link to={card.deskHref} className="mt-3 inline-flex text-sm text-signal underline-offset-2 hover:underline">
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
      <div className="rounded-2xl border border-[#c4b5fd]/30 bg-gradient-to-br from-[#1a1528] to-[#0a0c0b] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-mono text-[11px] uppercase tracking-widest text-[#c4b5fd]">{card.title}</p>
          <span className="rounded-full bg-[#c4b5fd]/15 px-2 py-0.5 font-mono text-[10px] text-[#c4b5fd]">
            LayerZero OFT · FAssets
          </span>
        </div>
        <p className="mt-2 text-xs text-white/50">Source · {String(card.source)}</p>
        <div className="mt-3 space-y-2">
          {routes.map((r) => (
            <div key={r.eid} className="rounded-xl bg-black/30 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-white">{r.chain}</span>
                <span className="font-mono text-[10px] text-signal">{r.status}</span>
              </div>
              <p className="mt-1 font-mono text-[11px] text-white/45">
                {r.asset} · EID {r.eid} · ETA {r.eta}
              </p>
              <p className="text-[11px] text-white/35">{r.fees}</p>
              <button
                type="button"
                onClick={() => onQuickReply(`bridge FXRP to ${r.chain}`)}
                className="mt-2 rounded-full border border-white/15 px-3 py-1 text-[11px] text-white/70 hover:border-signal/40"
              >
                Plan this route
              </button>
            </div>
          ))}
        </div>
        {unavailable.length > 0 && (
          <p className="mt-3 text-xs text-amber-200/70">Unavailable: {unavailable.join(" · ")}</p>
        )}
        <p className="mt-2 text-xs text-white/40">{String(card.honesty)}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {docs.map((l) => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-white/20 px-3 py-1.5 text-xs text-white/70 hover:border-signal/40"
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
      <div className="rounded-2xl border border-white/12 bg-white/[0.04] p-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-[#c4b5fd]">{card.title}</p>
        <p className="mt-2 text-sm text-white/80">{String(card.summary)}</p>
        <p className="mt-2 text-xs text-amber-200/80">{String(card.honesty)}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-white/20 px-3 py-1.5 text-xs text-white/70 hover:border-signal/40"
            >
              {l.label}
            </a>
          ))}
        </div>
      </div>
    );
  }

  if (card.type === "x402_quote") {
    return (
      <div className="rounded-2xl border border-signal/25 bg-gradient-to-br from-[#1a2430] to-[#0a0c0b] p-5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-mono text-[11px] uppercase tracking-widest text-white/45">{card.title}</p>
          <span className="rounded-full bg-signal/15 px-2 py-0.5 font-mono text-[10px] text-signal">
            {String(card.flarePrimitive ?? "x402")}
          </span>
        </div>
        <p className="mt-3 font-display text-3xl font-semibold text-white">${String(card.priceUsdt0)}</p>
        <dl className="mt-3 space-y-1.5 text-sm text-white/65">
          <div>
            <span className="text-white/40">Provider · </span>
            {String(card.provider ?? "Beacon")}
          </div>
          <div>
            <span className="text-white/40">Why · </span>
            {String(card.reason ?? "Paid resource")}
          </div>
          <div>
            <span className="text-white/40">ETA · </span>~{String(card.etaSeconds ?? 30)}s
          </div>
          <div className="font-mono text-[11px] text-white/35">
            MockUSDT0 · EIP-3009 · chain {String(card.chainId)} · {String(card.resource)}
          </div>
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={onMint} className="rounded-full border border-white/20 px-4 py-2 text-sm text-white/80">
            Mint test USDT0
          </button>
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
                  onPaidResend(payment);
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
        </div>
        {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
      </div>
    );
  }

  if (card.type === "media_result") {
    return (
      <div className="rounded-2xl border border-signal/25 bg-white/[0.04] p-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-signal">{card.title}</p>
        <p className="mt-2 text-sm text-white/75">{String(card.summary)}</p>
        {typeof card.content === "string" && card.content.startsWith("data:image") && (
          <img src={card.content} alt="Beacon result" className="mt-3 max-h-72 rounded-xl border border-white/10" />
        )}
        {typeof card.content === "string" && card.kind === "research" && (
          <p className="mt-3 whitespace-pre-wrap text-sm text-white/80">{card.content}</p>
        )}
      </div>
    );
  }

  if (card.type === "desk_link") {
    return (
      <div className="rounded-2xl border border-white/12 p-4">
        <p className="font-medium text-white">{card.title}</p>
        <p className="mt-1 text-sm text-white/60">{String(card.summary)}</p>
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
          <button type="button" onClick={onConnect} className="rounded-full bg-[#2563eb] px-4 py-2 text-sm text-white">
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
      <CheckCircle2 className="size-3.5 text-signal" />
    ) : status === "pending" ? (
      <Clock className="size-3.5 animate-pulse text-amber-300" />
    ) : status === "failed" ? (
      <span className="size-3.5 rounded-full bg-red-400" />
    ) : (
      <span className="size-3.5 rounded-full border border-white/20" />
    );
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-black/25 px-3 py-2 text-xs">
      <span className="flex items-center gap-2 text-white/70">
        {icon}
        {label}
        <span className="font-mono text-white/35">{status === "idle" ? "ready" : status}</span>
      </span>
      {hash && (
        <a href={explorerTx(hash)} target="_blank" rel="noreferrer" className="font-mono text-signal hover:underline">
          {hash.slice(0, 10)}…
        </a>
      )}
    </div>
  );
}
