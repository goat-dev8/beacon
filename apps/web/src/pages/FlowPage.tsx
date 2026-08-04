import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "motion/react";
import {
  Hexagon,
  Radio,
  ArrowLeftRight,
  GitBranch,
  Wallet,
  LineChart,
  Briefcase,
  Send,
  Loader2,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { connectEvmWallet, shortAddress, mintMockUsdt0, walletClient } from "@/lib/wallet";
import { NETWORK } from "@/lib/chain";
import { cn } from "@/lib/utils";
import type { Hex } from "viem";

type AgentId = "general" | "signals" | "swap" | "bridge" | "pay" | "trade" | "desk";

interface ChatMsg {
  id: string;
  role: "user" | "assistant" | "system";
  agentId?: AgentId;
  text: string;
  cards?: AgentCard[];
  model?: string;
}

type AgentCard = Record<string, unknown> & { type: string; title?: string };

const ROOM_ICONS: Record<AgentId, typeof Radio> = {
  general: Sparkles,
  signals: Radio,
  swap: ArrowLeftRight,
  bridge: GitBranch,
  pay: Wallet,
  trade: LineChart,
  desk: Briefcase,
};

export function FlowPage() {
  const [agentId, setAgentId] = useState<AgentId>("general");
  const [input, setInput] = useState("");
  const [wallet, setWallet] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      id: "welcome",
      role: "system",
      text: "Beacon Flow on Flare Coston2. Ask @signals for live FTSO prices, @swap for USDT0→FXRP, @bridge for LayerZero plans, @pay for x402, or open @desk for escrow jobs.",
    },
  ]);

  const agentsQuery = useQuery({
    queryKey: ["agents"],
    queryFn: () => api.agents(),
  });

  const chat = useMutation({
    mutationFn: (message: string) =>
      api.agentChat({ agentId, message, wallet: wallet ?? undefined }),
    onSuccess: (data, message) => {
      const nextAgent = data.agentId as AgentId;
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: "user", text: message, agentId },
        {
          id: crypto.randomUUID(),
          role: "assistant",
          agentId: nextAgent,
          text: data.text,
          cards: data.cards as AgentCard[],
          model: data.model,
        },
      ]);
    },
    onError: (err) => {
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: err instanceof ApiError ? err.message : "Agent request failed.",
        },
      ]);
    },
  });

  const agents = agentsQuery.data?.agents ?? [];
  const active = useMemo(
    () => agents.find((a) => a.id === agentId) ?? { id: agentId, name: agentId, blurb: "", builtIn: true },
    [agents, agentId],
  );

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

  return (
    <div className="flex min-h-dvh bg-[#0c0b10] text-[#f2f0ea]">
      {/* Icon rail */}
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

      {/* Rooms */}
      <aside className="hidden w-72 shrink-0 flex-col border-r border-white/10 bg-[#121118] md:flex">
        <div className="flex items-center justify-between px-4 py-4">
          <div>
            <p className="font-display text-lg font-semibold tracking-tight">beacon</p>
            <p className="font-mono text-[10px] uppercase tracking-widest text-white/40">Flare Flow · Coston2</p>
          </div>
          <span className="rounded-full bg-signal/20 px-2 py-0.5 font-mono text-[10px] text-signal">LIVE</span>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-4">
          {agents.map((a) => {
            const Icon = ROOM_ICONS[a.id as AgentId] ?? Sparkles;
            const on = a.id === agentId;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => setAgentId(a.id as AgentId)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition",
                  on ? "bg-white/10" : "hover:bg-white/5",
                )}
              >
                <span className="mt-0.5 grid size-8 place-items-center rounded-full bg-white/5">
                  <Icon className="size-4 text-signal" />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{a.name}</span>
                    {a.builtIn && (
                      <span className="rounded bg-[#3b82f6]/20 px-1.5 py-0.5 font-mono text-[9px] text-[#93c5fd]">
                        Built-in
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-white/45">{a.blurb}</span>
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Chat */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div>
            <h1 className="font-display text-xl font-semibold">{active.name}</h1>
            <p className="mt-0.5 max-w-xl text-sm text-white/50">
              {(active as { blurb?: string }).blurb ||
                "Interact with Flare agents — FTSO, SparkDEX, x402, LayerZero planner."}
            </p>
          </div>
          <div className="flex items-center gap-2">
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

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-6">
          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
              >
                {msg.role === "user" ? (
                  <div className="max-w-[85%] rounded-2xl bg-[#2563eb] px-4 py-2.5 text-sm text-white">
                    {msg.text}
                  </div>
                ) : (
                  <div className="max-w-[90%] space-y-3">
                    {msg.agentId && (
                      <p className="font-mono text-[11px] text-white/40">— from {msg.agentId}</p>
                    )}
                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm leading-relaxed text-white/90">
                      {msg.text}
                    </div>
                    {msg.cards?.map((card, i) => (
                      <ActionCard
                        key={`${msg.id}-${i}`}
                        card={card}
                        wallet={wallet}
                        onConnect={() => void onConnect()}
                        onMint={() => void mintMockUsdt0()}
                        onPaidResend={(payment) => {
                          const lastUser = [...messages].reverse().find((m) => m.role === "user");
                          if (!lastUser) return;
                          void api
                            .agentChat({
                              agentId: msg.agentId,
                              message: lastUser.text,
                              wallet: wallet ?? undefined,
                              payment,
                            })
                            .then((data) => {
                              setMessages((m) => [
                                ...m,
                                {
                                  id: crypto.randomUUID(),
                                  role: "assistant",
                                  agentId: data.agentId as AgentId,
                                  text: data.text,
                                  cards: data.cards as AgentCard[],
                                  model: data.model,
                                },
                              ]);
                            });
                        }}
                      />
                    ))}
                    {msg.role === "assistant" && (
                      <p className="text-[11px] text-white/35">
                        AI-generated · verify on Coston2 explorer · model {msg.model ?? "—"}
                      </p>
                    )}
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
          {chat.isPending && (
            <div className="flex items-center gap-2 text-sm text-white/45">
              <Loader2 className="size-4 animate-spin" /> Running Flare tools…
            </div>
          )}
        </div>

        <div className="border-t border-white/10 px-5 py-4">
          <div className="mb-3 flex flex-wrap gap-2">
            {agents.slice(0, 6).map((a) => (
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
              placeholder="Tell Beacon what to do on Flare…"
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
            Flare Coston2 · x402 · FTSO · SparkDEX · LayerZero planner · AI can be wrong — check txs.
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
}: {
  card: AgentCard;
  wallet: string | null;
  onConnect: () => void;
  onMint: () => void;
  onPaidResend: (payment: Record<string, unknown>) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [tx, setTx] = useState<string | null>(null);

  if (card.type === "ftso_signals") {
    const feeds = (card.feeds as Array<{ symbol: string; value: number }>) ?? [];
    return (
      <div className="overflow-hidden rounded-2xl border border-signal/30 bg-gradient-to-br from-[#12231a] to-[#0c0b10] p-4">
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

  if (card.type === "swap_prepare") {
    return (
      <div className="rounded-2xl border border-white/15 bg-white/[0.05] p-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-[#93c5fd]">{card.title}</p>
        <p className="mt-2 text-xs text-amber-200/90">{String(card.warning)}</p>
        <dl className="mt-3 space-y-1 font-mono text-[11px] text-white/60">
          <div>in · {String(card.tokenIn)}</div>
          <div>out · {String(card.tokenOut)}</div>
          <div>router · {String(card.router)}</div>
          <div>amountIn · {String(card.amountIn)}</div>
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          {!wallet && (
            <button type="button" onClick={onConnect} className="rounded-full bg-[#2563eb] px-4 py-2 text-sm text-white">
              Connect wallet
            </button>
          )}
          {wallet && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  try {
                    const client = walletClient();
                    const [account] = await client.getAddresses();
                    const approveHash = await client.sendTransaction({
                      account,
                      to: card.approveTo as Hex,
                      data: card.approveData as Hex,
                      chain: undefined,
                    });
                    setTx(approveHash);
                    const swapHash = await client.sendTransaction({
                      account,
                      to: card.swapTo as Hex,
                      data: card.swapData as Hex,
                      chain: undefined,
                    });
                    setTx(swapHash);
                  } catch (e) {
                    setTx(e instanceof Error ? e.message : "swap failed");
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
            href="https://faucet.flare.network/coston2"
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-white/20 px-4 py-2 text-sm text-white/70"
          >
            Coston2 faucet
          </a>
        </div>
        {tx && <p className="mt-2 break-all font-mono text-[10px] text-white/50">{tx}</p>}
      </div>
    );
  }

  if (card.type === "bridge_intent") {
    const links = (card.links as Array<{ label: string; href: string }>) ?? [];
    return (
      <div className="rounded-2xl border border-white/15 bg-white/[0.05] p-4">
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
      <div className="rounded-2xl border border-signal/25 bg-gradient-to-br from-[#1a2430] to-[#0c0b10] p-5 text-center">
        <p className="font-mono text-[11px] uppercase tracking-widest text-white/45">{card.title}</p>
        <p className="mt-3 font-display text-3xl font-semibold text-white">${String(card.priceUsdt0)}</p>
        <p className="mt-1 text-sm text-white/55">USDT0 · x402 · chain {String(card.chainId)}</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={onMint}
            className="rounded-full border border-white/20 px-4 py-2 text-sm text-white/80"
          >
            Mint test USDT0
          </button>
          <button
            type="button"
            disabled={!wallet || busy}
            onClick={() => {
              void (async () => {
                if (!wallet) return onConnect();
                setBusy(true);
                try {
                  const { signX402Payment } = await import("@/lib/x402Pay");
                  const payment = await signX402Payment({
                    amountUsdt0: String(card.priceUsdt0),
                    payTo: String(card.payTo),
                    token: String(card.token),
                  });
                  onPaidResend(payment);
                } catch (e) {
                  setTx(e instanceof Error ? e.message : "pay failed");
                } finally {
                  setBusy(false);
                }
              })();
            }}
            className="rounded-full bg-[#2563eb] px-5 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {busy ? "Signing…" : "Pay with x402"}
          </button>
        </div>
        {tx && <p className="mt-2 text-xs text-danger">{tx}</p>}
      </div>
    );
  }

  if (card.type === "desk_link") {
    return (
      <div className="rounded-2xl border border-white/15 p-4">
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
        <button type="button" onClick={onConnect} className="mt-3 rounded-full bg-[#2563eb] px-4 py-2 text-sm text-white">
          Connect
        </button>
      </div>
    );
  }

  return (
    <pre className="overflow-auto rounded-xl bg-black/40 p-3 font-mono text-[10px] text-white/60">
      {JSON.stringify(card, null, 2)}
    </pre>
  );
}

