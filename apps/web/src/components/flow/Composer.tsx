import { Send } from "lucide-react";
import { SuggestionChips } from "@/components/flow/SuggestionChips";

type Props = {
  input: string;
  onChange: (v: string) => void;
  onSend: () => void;
  pending: boolean;
  agentHint?: string;
  onSuggestion: (text: string) => void;
};

export function Composer({ input, onChange, onSend, pending, agentHint, onSuggestion }: Props) {
  return (
    <div className="shrink-0 border-t border-[var(--p-border)] bg-[var(--p-rail)] px-3 py-2.5 md:px-6">
      <div className="mx-auto w-full max-w-[42rem]">
        <SuggestionChips onSelect={onSuggestion} disabled={pending} />
        {agentHint && (
          <p className="mb-1.5 font-mono text-[10px] text-[var(--p-faint)]">
            Active · {agentHint}
            <span className="text-[var(--p-muted)]"> · @swap @bridge @signals @fassets</span>
          </p>
        )}
        <div className="flex items-center gap-2 rounded-full border border-[var(--p-border)] bg-[var(--p-card)] py-1 pl-3.5 pr-1 shadow-[var(--p-shadow)]">
          <label htmlFor="beacon-composer" className="sr-only">
            Message Beacon
          </label>
          <textarea
            id="beacon-composer"
            value={input}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            rows={1}
            placeholder="Message Beacon…"
            className="max-h-20 min-h-[36px] flex-1 resize-none bg-transparent py-2 text-[14px] leading-snug text-[var(--p-fg)] outline-none placeholder:text-[var(--p-muted)]"
          />
          <button
            type="button"
            onClick={onSend}
            disabled={pending || !input.trim()}
            aria-label="Send message"
            className="grid size-9 shrink-0 place-items-center rounded-full bg-signal text-[var(--p-on-accent)] transition-transform active:scale-[0.96] disabled:opacity-40"
          >
            <Send className="size-3.5" />
          </button>
        </div>
        <p className="mt-1.5 text-center text-[10px] text-[var(--p-faint)]">
          Flare Coston2 · FTSO · LayerZero · x402 · verify every tx
        </p>
      </div>
    </div>
  );
}
