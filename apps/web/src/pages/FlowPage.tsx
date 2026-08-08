import { useEffect, useMemo, useState, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { mintMockUsdt0 } from "@/lib/wallet";
import { useProductWallet } from "@/lib/productWallet";
import { ChatColumn } from "@/components/flow/ChatColumn";
import { HistoryRail } from "@/components/flow/HistoryRail";
import { EvidencePanel } from "@/components/ExecutionDrawer";
import { WhyFlareDrawer } from "@/components/landing/WhyFlare";
import { useNavigate } from "react-router-dom";
import { shouldShowGetStarted } from "@/pages/GetStartedPage";
import {
  OnboardingWalkthrough,
  shouldShowOnboarding,
} from "@/components/onboarding/OnboardingWalkthrough";
import {
  findActiveExecution,
  inferSettledServiceIds,
  type CardExecutionState,
  type AgentCard,
} from "@/lib/executionPhases";
import {
  WELCOME,
  type AgentId,
  type ChatMsg,
  type ConvState,
  type FlowConv,
  type PaidResendMeta,
} from "@/lib/flowTypes";
import { cn } from "@/lib/utils";

export function FlowPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { wallet, connect, connecting } = useProductWallet();
  const [agentId, setAgentId] = useState<AgentId>("general");
  const [input, setInput] = useState("");
  const [convState, setConvState] = useState<ConvState>(null);
  const [settledServiceIds, setSettledServiceIds] = useState<Set<string>>(() => new Set());
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([WELCOME]);
  const [convSearch, setConvSearch] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [executionStates, setExecutionStates] = useState<Record<string, CardExecutionState>>({});
  const [historyOpen, setHistoryOpen] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 768px)").matches : true,
  );
  const [dismissedExecKey, setDismissedExecKey] = useState<string | null>(null);
  const [whyFlareOpen, setWhyFlareOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);

  useEffect(() => {
    if (shouldShowGetStarted()) {
      navigate("/start", { replace: true });
      return;
    }
    setOnboardingOpen(shouldShowOnboarding());
  }, [navigate]);

  const onExecutionStateChange = useCallback((key: string, state: CardExecutionState) => {
    setExecutionStates((prev) => ({ ...prev, [key]: { ...prev[key], ...state } }));
  }, []);

  useEffect(() => {
    if (!conversationId) return;
    try {
      sessionStorage.setItem(`beacon.exec.${conversationId}`, JSON.stringify(executionStates));
    } catch {
      /* ignore quota */
    }
  }, [conversationId, executionStates]);

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

  const fccQuery = useQuery({
    queryKey: ["fcc-status"],
    queryFn: () => api.getFccStatus(),
    staleTime: 60_000,
    retry: 1,
  });

  const fccMode = fccQuery.data?.mode ?? "unavailable";
  const fccPrimitive =
    fccMode === "simulated"
      ? "Confidential policy (simulated TEE)"
      : fccMode === "verified"
        ? "Confidential policy (verified TEE)"
        : "Security Policy · server-enforced";

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
    try {
      const raw = sessionStorage.getItem(`beacon.exec.${id}`);
      setExecutionStates(raw ? (JSON.parse(raw) as Record<string, CardExecutionState>) : {});
    } catch {
      setExecutionStates({});
    }
    setDismissedExecKey(null);
    setMessages(loaded);
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
      setHistoryOpen(false);
    }
  }

  async function startNewChat() {
    if (!wallet) {
      setConversationId(null);
      setConvState(null);
      setSettledServiceIds(new Set());
      setExecutionStates({});
      setDismissedExecKey(null);
      setAgentId("general");
      setMessages([WELCOME]);
      return;
    }
    setAgentId("general");
    setConvState(null);
    setSettledServiceIds(new Set());
    setExecutionStates({});
    setDismissedExecKey(null);
    setMessages([WELCOME]);
    const { conversation } = await api.createFlowConversation(wallet, "New chat", "general");
    setConversationId(conversation.id);
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
      setDismissedExecKey(null);
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: "user", text: message, agentId },
        {
          id: crypto.randomUUID(),
          role: "assistant",
          agentId: nextAgent,
          text: data.text,
          cards: data.cards as AgentCard[],
          displayModel: data.displayModel || "deterministic fallback",
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
          displayModel: "deterministic fallback",
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
    await connect();
  }

  function send() {
    const text = input.trim();
    if (!text || chat.isPending) return;
    setInput("");
    chat.mutate(text);
  }

  const bal = balancesQuery.data?.balances ?? null;
  const recentActivity = activityQuery.data?.activity?.slice(0, 5) ?? [];
  const latestModel = [...messages].reverse().find((m) => m.role === "assistant" && m.displayModel)?.displayModel;

  const activeExecution = useMemo(() => {
    const found = findActiveExecution(messages, executionStates, settledServiceIds, convState);
    if (!found) return null;
    const key = `${found.msgId}:${found.cardIndex}`;
    if (dismissedExecKey === key && found.dismissible) return null;
    return found;
  }, [messages, executionStates, settledServiceIds, convState, dismissedExecKey]);

  function handlePaidResend(
    payment: Record<string, unknown>,
    meta: PaidResendMeta,
    card: AgentCard,
    msg: ChatMsg,
  ) {
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
        setDismissedExecKey(null);
        setMessages((m) => [
          ...m,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            agentId: data.agentId as AgentId,
            text: data.text,
            cards: data.cards as AgentCard[],
            displayModel: data.displayModel || "deterministic fallback",
          },
        ]);
        if (wallet) {
          void qc.invalidateQueries({ queryKey: ["flow-conversations", wallet] });
          void qc.invalidateQueries({ queryKey: ["flow-activity", wallet] });
        }
      })
      .catch((e) => {
        const reason = e instanceof Error ? e.message : "Payment blocked by policy.";
        setMessages((m) => [
          ...m,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            agentId: (meta.agentId ?? msg.agentId) as AgentId,
            text: "Authorization Receipt · spend policy blocked this settle before on-chain transfer.",
            cards: [
              {
                type: "authorization_receipt",
                title: "Authorization Receipt",
                allowed: false,
                reason,
                agentId: meta.agentId ?? msg.agentId,
                serviceId: meta.serviceId,
                priceUsdt0:
                  typeof card.priceUsdt0 === "string" || typeof card.priceUsdt0 === "number"
                    ? card.priceUsdt0
                    : undefined,
                flarePrimitive: fccPrimitive,
                fccMode,
              },
            ],
            displayModel: "Beacon Policy",
          },
        ]);
      });
  }

  return (
    <div className="relative flex h-full max-h-dvh overflow-hidden bg-[var(--p-bg)] text-[var(--p-fg)]">
      {historyOpen && (
        <button
          type="button"
          className="absolute inset-0 z-20 bg-black/40 md:hidden"
          aria-label="Close history"
          onClick={() => setHistoryOpen(false)}
        />
      )}

      <HistoryRail
        open={historyOpen}
        onToggle={() => setHistoryOpen((v) => !v)}
        wallet={wallet}
        conversations={conversations}
        conversationId={conversationId}
        convSearch={convSearch}
        onSearch={setConvSearch}
        renamingId={renamingId}
        renameValue={renameValue}
        onRenameValue={setRenameValue}
        onStartRename={(id, title) => {
          setRenamingId(id);
          setRenameValue(title);
        }}
        onCancelRename={() => setRenamingId(null)}
        onCommitRename={(id, fallback) => {
          if (!wallet) return;
          void api
            .patchFlowConversation(id, { wallet, title: renameValue.trim() || fallback })
            .then(() => {
              setRenamingId(null);
              void qc.invalidateQueries({ queryKey: ["flow-conversations", wallet] });
            });
        }}
        onLoad={(id) => {
          if (wallet) void loadConversation(id, wallet);
        }}
        onPin={(id, pinned) => {
          if (!wallet) return;
          void api
            .patchFlowConversation(id, { wallet, pinned })
            .then(() => qc.invalidateQueries({ queryKey: ["flow-conversations", wallet] }));
        }}
        onArchive={(id) => {
          if (!wallet) return;
          void api.patchFlowConversation(id, { wallet, archive: true }).then(() => {
            if (conversationId === id) void startNewChat();
            void qc.invalidateQueries({ queryKey: ["flow-conversations", wallet] });
          });
        }}
        onNewChat={() => void startNewChat()}
        recentActivity={recentActivity}
        loading={conversationsQuery.isLoading}
      />

      <main className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:flex-row")}>
        <ChatColumn
          agentName={active.name}
          displayModel={latestModel}
          wallet={wallet}
          connecting={connecting}
          balances={bal}
          onConnect={() => void onConnect()}
          onOpenHistory={() => setHistoryOpen(true)}
          historyOpen={historyOpen}
          onOpenWhyFlare={() => setWhyFlareOpen(true)}
          messages={messages}
          pending={chat.isPending}
          convState={convState}
          settledServiceIds={settledServiceIds}
          executionStates={executionStates}
          onExecutionStateChange={onExecutionStateChange}
          onMint={() => void mintMockUsdt0()}
          onBalancesRefresh={() => {
            if (wallet) void qc.invalidateQueries({ queryKey: ["balances", wallet] });
          }}
          onTxConfirmed={(info) => {
            if (!wallet) return;
            void api
              .recordFlowActivity({
                wallet,
                kind: info.kind,
                title: info.title,
                explorerUrl: info.explorerUrl,
                refId: info.hash,
                meta: info.meta,
              })
              .then(() => qc.invalidateQueries({ queryKey: ["flow-activity", wallet] }))
              .catch(() => undefined);
          }}
          onQuickReply={(text) => {
            setInput("");
            chat.mutate(text);
          }}
          onPaidResend={handlePaidResend}
          input={input}
          onInputChange={setInput}
          onSend={send}
        />

        <EvidencePanel
          active={activeExecution}
          onDismiss={() => {
            if (!activeExecution) return;
            setDismissedExecKey(`${activeExecution.msgId}:${activeExecution.cardIndex}`);
          }}
          onNextSuggestion={(text) => {
            setInput(text);
          }}
        />
      </main>

      <WhyFlareDrawer open={whyFlareOpen} onClose={() => setWhyFlareOpen(false)} />
      <OnboardingWalkthrough open={onboardingOpen} onComplete={() => setOnboardingOpen(false)} />
    </div>
  );
}
