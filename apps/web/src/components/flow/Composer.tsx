import { Send } from "lucide-react";

type Props = {
  input: string;
  onChange: (v: string) => void;
  onSend: () => void;
  pending: boolean;
  agentHint?: string;
};

export function Composer({ input, onChange, onSend, pending, agentHint }: Props) {
  return (
    <div className="shrink-0 border-t border-[var(--p-border)] bg-[var(--p-rail)] px-4 py-3 md:px-6">
      <div className="mx-auto w-full max-w-[42rem]">
        {agentHint && (
          <p className="mb-2 font-mono text-[11px] text-[var(--p-faint)]">
            Active · {agentHint}
            <span className="text-[var(--p-muted)]"> · mention @swap @bridge @image to route</span>
          </p>
        )}
        <div className="flex items-end gap-2 rounded-[var(--p-radius)] border border-[var(--p-border)] bg-[var(--p-card)] px-3 py-2 shadow-[var(--p-shadow)]">
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
            rows={2}
            placeholder="Message Beacon… signal, quote, swap, bridge, or pay"
            className="max-h-32 min-h-[44px] flex-1 resize-none bg-transparent text-[15px] leading-relaxed text-[var(--p-fg)] outline-none placeholder:text-[var(--p-muted)]"
          />
          <button
            type="button"
            onClick={onSend}
            disabled={pending || !input.trim()}
            aria-label="Send message"
            className="grid size-11 shrink-0 place-items-center rounded-[var(--p-radius-sm)] bg-signal text-[var(--p-on-accent)] disabled:opacity-40"
          >
            <Send className="size-4" />
          </button>
        </div>
        <p className="mt-2 text-center text-[11px] text-[var(--p-faint)]">
          Flare Coston2 · FTSO · SparkDEX (Mainnet) · LayerZero OFT · x402 · verify every tx
        </p>
      </div>
    </div>
  );
}
