import { useEffect, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Loader2 } from "lucide-react";
import { AgentText } from "@/components/AgentText";
import { ActionCard } from "@/components/flow/ActionCards";
import { FeatureDiscovery } from "@/components/flow/FeatureDiscovery";
import { cardKey, type CardExecutionState, type AgentCard } from "@/lib/executionPhases";
import { cardsForDisplay, type ChatMsg, type ConvState, type PaidResendMeta } from "@/lib/flowTypes";
import { cn } from "@/lib/utils";

type Props = {
  messages: ChatMsg[];
  pending: boolean;
  wallet: string | null;
  convState: ConvState;
  settledServiceIds: Set<string>;
  executionStates: Record<string, CardExecutionState>;
  onExecutionStateChange: (key: string, state: CardExecutionState) => void;
  onConnect: () => void;
  onMint: () => void;
  onBalancesRefresh: () => void;
  onTxConfirmed: (info: {
    kind: "swap" | "bridge";
    title: string;
    hash: string;
    explorerUrl: string;
    meta?: Record<string, unknown>;
  }) => void;
  onQuickReply: (text: string) => void;
  onPaidResend: (payment: Record<string, unknown>, meta: PaidResendMeta, card: AgentCard, msg: ChatMsg) => void;
  onFillComposer: (text: string) => void;
  onOpenWhyFlare?: () => void;
};

function CompactCard({ card }: { card: AgentCard }) {
  const title = String(card.title ?? card.type.replace(/_/g, " "));
  return (
    <div className="inline-flex max-w-full items-center gap-2 rounded-[var(--p-radius-sm)] border border-[var(--p-border)] bg-[var(--p-surface)] px-3 py-1.5 text-[12px] text-[var(--p-muted)]">
      <span className="size-1.5 shrink-0 rounded-full bg-[var(--p-faint)]" />
      <span className="truncate">{title}</span>
      <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--p-faint)]">past</span>
    </div>
  );
}

export function MessageList({
  messages,
  pending,
  wallet,
  convState,
  settledServiceIds,
  executionStates,
  onExecutionStateChange,
  onConnect,
  onMint,
  onBalancesRefresh,
  onTxConfirmed,
  onQuickReply,
  onPaidResend,
  onFillComposer,
  onOpenWhyFlare,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const showDiscovery = messages.length <= 1 && !pending;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "end",
    });
  }, [messages, pending, reduce]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[42rem] space-y-6 px-4 py-6 md:px-6">
        <AnimatePresence initial={false}>
          {messages.map((msg, msgIndex) => (
            <motion.div
              key={msg.id}
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
            >
              {msg.role === "user" ? (
                <div className="max-w-[85%] rounded-[var(--p-radius)] bg-[var(--p-user-bubble)] px-4 py-2.5 text-[15px] leading-relaxed text-[var(--p-fg)]">
                  {msg.text}
                </div>
              ) : msg.role === "system" ? (
                <div className="max-w-[95%] rounded-[var(--p-radius)] border border-[var(--p-border)] bg-[var(--p-card)] px-4 py-3 text-[15px] leading-relaxed text-[var(--p-muted)]">
                  {msg.text}
                </div>
              ) : (
                <div className="w-full max-w-[95%] space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-[13px] font-semibold tracking-tight text-[var(--p-fg)]">
                      Beacon
                    </span>
                    {msg.displayModel && (
                      <span className="rounded-full border border-[var(--p-border)] bg-[var(--p-card)] px-2 py-0.5 font-mono text-[10px] text-[var(--p-muted)]">
                        {msg.displayModel}
                      </span>
                    )}
                  </div>
                  <AgentText text={msg.text} />
                  {cardsForDisplay(msg, msgIndex, messages).map(({ card, index, mode }) =>
                    mode === "compact" ? (
                      <CompactCard key={`${msg.id}-${index}`} card={card} />
                    ) : (
                      <ActionCard
                        key={`${msg.id}-${index}`}
                        card={card}
                        cardKey={cardKey(msg.id, index)}
                        wallet={wallet}
                        convState={convState}
                        settledServiceIds={settledServiceIds}
                        savedExec={executionStates[cardKey(msg.id, index)]}
                        onExecutionStateChange={onExecutionStateChange}
                        onConnect={onConnect}
                        onMint={onMint}
                        onBalancesRefresh={onBalancesRefresh}
                        onTxConfirmed={onTxConfirmed}
                        onQuickReply={onQuickReply}
                        onPaidResend={(payment, meta) => onPaidResend(payment, meta, card, msg)}
                      />
                    ),
                  )}
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
        {pending && (
          <div className="flex items-center gap-2 text-[15px] text-[var(--p-muted)]" role="status" aria-live="polite">
            <Loader2 className="size-4 animate-spin text-[var(--p-accent-text)]" />
            <span className="font-display">Thinking…</span>
          </div>
        )}
        <div ref={bottomRef} aria-hidden />
      </div>

      {showDiscovery && (
        <FeatureDiscovery
          onTry={(prompt, mode) => {
            if (mode === "send") onQuickReply(prompt);
            else onFillComposer(prompt);
          }}
          onOpenWhyFlare={onOpenWhyFlare}
        />
      )}
    </div>
  );
}
