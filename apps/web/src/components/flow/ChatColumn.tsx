import { ChatTopBar } from "@/components/flow/ChatTopBar";
import { Composer } from "@/components/flow/Composer";
import { MessageList } from "@/components/flow/MessageList";
import type { CardExecutionState, AgentCard } from "@/lib/executionPhases";
import type { ChatMsg, ConvState, PaidResendMeta } from "@/lib/flowTypes";

type Balances = {
  usdt0: { formatted: string };
  mockUsdt0?: { formatted: string } | null;
  fxrp: { formatted: string };
} | null;

type Props = {
  agentName: string;
  displayModel?: string | null;
  wallet: string | null;
  connecting: boolean;
  balances: Balances;
  onConnect: () => void;
  onOpenHistory: () => void;
  historyOpen: boolean;
  messages: ChatMsg[];
  pending: boolean;
  convState: ConvState;
  settledServiceIds: Set<string>;
  executionStates: Record<string, CardExecutionState>;
  onExecutionStateChange: (key: string, state: CardExecutionState) => void;
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
  input: string;
  onInputChange: (v: string) => void;
  onSend: () => void;
};

export function ChatColumn(props: Props) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <ChatTopBar
        agentName={props.agentName}
        displayModel={props.displayModel}
        wallet={props.wallet}
        connecting={props.connecting}
        balances={props.balances}
        onConnect={props.onConnect}
        onOpenHistory={props.onOpenHistory}
        historyOpen={props.historyOpen}
      />
      <MessageList
        messages={props.messages}
        pending={props.pending}
        wallet={props.wallet}
        convState={props.convState}
        settledServiceIds={props.settledServiceIds}
        executionStates={props.executionStates}
        onExecutionStateChange={props.onExecutionStateChange}
        onConnect={props.onConnect}
        onMint={props.onMint}
        onBalancesRefresh={props.onBalancesRefresh}
        onTxConfirmed={props.onTxConfirmed}
        onQuickReply={props.onQuickReply}
        onPaidResend={props.onPaidResend}
      />
      <Composer
        input={props.input}
        onChange={props.onInputChange}
        onSend={props.onSend}
        pending={props.pending}
        agentHint={props.agentName}
      />
    </div>
  );
}
