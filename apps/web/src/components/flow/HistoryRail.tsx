import { Search, PanelLeftClose, PanelLeft, Pencil, Star, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FlowConv } from "@/lib/flowTypes";

type Activity = {
  id: string;
  kind: string;
  title: string;
  explorer_url?: string | null;
};

type Props = {
  open: boolean;
  onToggle: () => void;
  wallet: string | null;
  conversations: FlowConv[];
  conversationId: string | null;
  convSearch: string;
  onSearch: (v: string) => void;
  renamingId: string | null;
  renameValue: string;
  onRenameValue: (v: string) => void;
  onStartRename: (id: string, title: string) => void;
  onCancelRename: () => void;
  onCommitRename: (id: string, fallbackTitle: string) => void;
  onLoad: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onArchive: (id: string) => void;
  onNewChat: () => void;
  recentActivity: Activity[];
  loading?: boolean;
};

export function HistoryRail({
  open,
  onToggle,
  wallet,
  conversations,
  conversationId,
  convSearch,
  onSearch,
  renamingId,
  renameValue,
  onRenameValue,
  onStartRename,
  onCancelRename,
  onCommitRename,
  onLoad,
  onPin,
  onArchive,
  onNewChat,
  recentActivity,
  loading,
}: Props) {
  if (!open) {
    return (
      <div className="hidden shrink-0 flex-col border-r border-[var(--p-border)] bg-[var(--p-rail)] md:flex">
        <button
          type="button"
          onClick={onToggle}
          className="grid size-11 place-items-center text-[var(--p-faint)] transition-colors hover:bg-[var(--p-hover)] hover:text-[var(--p-fg)]"
          aria-label="Open conversation history"
          title="History"
        >
          <PanelLeft className="size-[18px]" strokeWidth={1.75} />
        </button>
      </div>
    );
  }

  return (
    <aside
      className={cn(
        "flex w-[min(100%,17.5rem)] shrink-0 flex-col border-r border-[var(--p-border)] bg-[var(--p-rail)]",
        "absolute inset-y-0 left-0 z-30 shadow-[var(--p-shadow)] md:relative md:shadow-none",
      )}
      aria-label="Conversation history"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--p-border)] px-3 py-3">
        <div className="min-w-0">
          <p className="font-display text-base font-semibold tracking-tight text-[var(--p-fg)]">History</p>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--p-faint)]">
            Signal · Quote · Receipt
          </p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="grid size-9 place-items-center rounded-[var(--p-radius-sm)] text-[var(--p-faint)] hover:bg-[var(--p-hover)] hover:text-[var(--p-fg)]"
          aria-label="Collapse history"
        >
          <PanelLeftClose className="size-[18px]" strokeWidth={1.75} />
        </button>
      </div>

      <div className="shrink-0 space-y-2 border-b border-[var(--p-border)] px-3 py-3">
        <button
          type="button"
          onClick={onNewChat}
          className="flex min-h-10 w-full items-center justify-center rounded-[var(--p-radius-sm)] bg-signal px-3 text-sm font-medium text-[var(--p-on-accent)] transition-transform hover:brightness-105 active:scale-[0.99]"
        >
          New chat
        </button>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--p-muted)]" />
          <input
            value={convSearch}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search chats"
            aria-label="Search conversations"
            className="min-h-10 w-full rounded-[var(--p-radius-sm)] border border-[var(--p-border)] bg-[var(--p-bg)] py-2 pl-8 pr-2 text-[13px] text-[var(--p-fg)] outline-none placeholder:text-[var(--p-muted)] focus:border-signal/40"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {!wallet && (
          <p className="px-2 py-4 text-[13px] leading-relaxed text-[var(--p-muted)]">
            Connect your wallet so chats, swaps, payments, and receipts persist by address.
          </p>
        )}
        {wallet && conversations.length === 0 && !loading && (
          <p className="px-2 py-4 text-[13px] text-[var(--p-muted)]">No conversations yet. Send a message to start.</p>
        )}
        <div className="space-y-0.5">
          {conversations.map((c) => {
            const on = c.id === conversationId;
            return (
              <div
                key={c.id}
                className={cn(
                  "group flex items-center gap-1 rounded-[var(--p-radius-sm)] px-2 py-2 text-left text-[13px] transition",
                  on ? "bg-[var(--p-hover)]" : "hover:bg-[var(--p-hover)]",
                )}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => onLoad(c.id)}
                >
                  {renamingId === c.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => onRenameValue(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          onCommitRename(c.id, c.title);
                        }
                        if (e.key === "Escape") onCancelRename();
                      }}
                      aria-label="Rename conversation"
                      className="w-full rounded bg-[var(--p-surface-2)] px-1.5 py-0.5 text-[13px] outline-none"
                    />
                  ) : (
                    <>
                      <span className="flex items-center gap-1.5">
                        {c.pinned && (
                          <span className="font-mono text-[10px] text-[var(--p-accent-text)]">Pinned</span>
                        )}
                        <span className="truncate font-medium text-[var(--p-fg)]">{c.title}</span>
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[10px] text-[var(--p-faint)]">
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
                      aria-label="Rename"
                      className="grid size-8 place-items-center rounded text-[var(--p-muted)] hover:bg-[var(--p-hover)] hover:text-[var(--p-fg)]"
                      onClick={() => onStartRename(c.id, c.title)}
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      title={c.pinned ? "Unpin" : "Pin"}
                      aria-label={c.pinned ? "Unpin" : "Pin"}
                      className="grid size-8 place-items-center rounded text-[var(--p-muted)] hover:bg-[var(--p-hover)] hover:text-[var(--p-accent-text)]"
                      onClick={() => onPin(c.id, !c.pinned)}
                    >
                      <Star className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Archive"
                      aria-label="Archive"
                      className="grid size-8 place-items-center rounded text-[var(--p-muted)] hover:bg-[var(--p-hover)] hover:text-[var(--p-danger)]"
                      onClick={() => onArchive(c.id)}
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {recentActivity.length > 0 && (
          <div className="mt-4 border-t border-[var(--p-border)] px-1 pt-3">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--p-faint)]">
              Recent activity
            </p>
            <ul className="space-y-1.5">
              {recentActivity.map((a) => (
                <li key={a.id} className="truncate text-[12px] text-[var(--p-muted)]">
                  <span className="text-[var(--p-accent-text)]">{a.kind}</span>
                  {" · "}
                  {a.explorer_url ? (
                    <a
                      href={a.explorer_url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline-offset-2 hover:underline"
                    >
                      {a.title}
                    </a>
                  ) : (
                    a.title
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </aside>
  );
}
