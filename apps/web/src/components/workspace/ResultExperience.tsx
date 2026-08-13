import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import {
  Check,
  Copy,
  Download,
  Expand,
  Loader2,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import type { JobStatus, QuoteDto } from "@/lib/types";
import { statusLabel } from "@/lib/status";
import { cn } from "@/lib/utils";
import { Button, FacetCtaPair } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { NETWORK } from "@/lib/chain";
import "highlight.js/styles/github-dark.css";

type Artifact = {
  id: string;
  kind: string;
  uri: string;
  meta?: Record<string, unknown> | null;
};

const TAB_ORDER = ["summary", "code", "draft", "document", "plan", "index", "image", "video", "assets"] as const;

function normalizeTab(kind: string): string {
  const k = kind.toLowerCase();
  if (k.includes("plan")) return "plan";
  if (k.includes("index")) return "index";
  if (k.includes("doc")) return "document";
  if (k.includes("draft") || k.includes("markdown") || k.includes("text")) return "draft";
  if (k.includes("code") || k.includes("snippet")) return "code";
  if (k.includes("image") || k.includes("svg")) return "image";
  if (k.includes("video")) return "video";
  return kind;
}

export function ResultExperience({
  status,
  jobId,
  quote,
  lockTx,
  payMode = null,
  acceptance,
  artifacts,
  recentEvents = [],
  onLook,
  lookPending,
  onNew,
  FlareRails,
}: {
  status: JobStatus;
  jobId: string;
  quote: QuoteDto | null;
  lockTx: string | null;
  payMode?: "safe" | "wallet" | null;
  acceptance: import("@/lib/types").AcceptanceSummary | null;
  artifacts: Artifact[];
  recentEvents?: Array<{ type: string; payload?: unknown }>;
  onLook: (d: "accept" | "reject") => void;
  lookPending: boolean;
  onNew: () => void;
  FlareRails: React.ComponentType<{
    status?: JobStatus;
    lockTx: string | null;
    settleTx?: string | null;
    compact?: boolean;
    payMode?: "safe" | "wallet" | null;
  }>;
}) {
  const genFailed = recentEvents.some((e) => {
    const p = e.payload as { trigger?: string } | null | undefined;
    return e.type === "status" && p?.trigger === "generation_failed";
  });
  const acceptFail = acceptance?.result === "FAIL";
  const failed =
    status === "FAILED" || status === "REFUSING" || acceptFail || genFailed;
  const passed =
    !failed && (status === "PASSED" || status === "SETTLING" || status === "CLOSED");
  const needsLook = status === "NEEDS_LOOK";
  const failBlurb = genFailed
    ? "Generation failed. You were not charged."
    : acceptance?.summary ??
      "This job did not pass. You were not charged; escrow is refunded.";

  const sorted = useMemo(() => {
    const list = [...artifacts];
    list.sort((a, b) => {
      const ai = TAB_ORDER.indexOf(normalizeTab(a.kind) as (typeof TAB_ORDER)[number]);
      const bi = TAB_ORDER.indexOf(normalizeTab(b.kind) as (typeof TAB_ORDER)[number]);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
    return list;
  }, [artifacts]);

  const primary = useMemo(() => {
    const code = sorted.find((a) => normalizeTab(a.kind) === "code");
    return code ?? sorted[0];
  }, [sorted]);
  const [mode, setMode] = useState<"artifact" | "summary">("artifact");
  const [activeId, setActiveId] = useState<string | null>(null);
  const selectedId = mode === "summary" ? null : activeId ?? primary?.id ?? null;
  const selected = sorted.find((a) => a.id === selectedId) ?? primary;

  const contentQuery = useQuery({
    queryKey: ["artifact-content", jobId, selectedId],
    queryFn: () => api.artifactContent(jobId, selectedId!),
    enabled: Boolean(selectedId) && mode === "artifact",
  });

  const receiptQuery = useQuery({
    queryKey: ["job-receipt", jobId],
    queryFn: () => api.jobReceipt(jobId),
    enabled: passed || failed,
  });
  const receipt = receiptQuery.data?.receipt;
  const receiptNotCharged =
    receipt?.display?.statusLabel === "Not charged" || receipt?.accept?.result === "FAIL";
  const receiptPaid = receipt?.display?.statusLabel === "Paid" && receipt?.accept?.result === "PASS";
  const outcomeFailed = failed || receiptNotCharged;
  const outcomePassed = (passed || receiptPaid) && !outcomeFailed;

  const settleTx =
    receiptQuery.data?.receipt?.txHash ??
    receiptQuery.data?.receipt?.payment?.txHash ??
    null;
  const paidDisplay =
    quote?.priceDisplay ??
    (receiptQuery.data?.receipt?.payment?.amountUsdt0
      ? `$${(Number(receiptQuery.data.receipt.payment.amountUsdt0) / 1e6).toFixed(6)}`
      : null);

  const body = contentQuery.data?.content;
  const bodyKind = contentQuery.data?.kind ?? selected?.kind ?? "result";
  const bodyMime = contentQuery.data?.mimeType ?? "";
  const isVideo = bodyKind === "video" || bodyMime.startsWith("video/");
  const isImage =
    !isVideo &&
    (bodyKind === "image" || bodyMime.startsWith("image/") || bodyMime.includes("svg"));
  const isText = Boolean(body) && !isImage && !isVideo;
  const rawSrc = selectedId != null ? api.artifactRawUrl(jobId, selectedId) : null;

  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const onCopy = useCallback(async () => {
    if (!body) return;
    await navigator.clipboard.writeText(body);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }, [body]);

  const onDownload = useCallback(() => {
    if (rawSrc) {
      const a = document.createElement("a");
      a.href = rawSrc;
      a.download = `${bodyKind}-${jobId.slice(0, 8)}`;
      a.target = "_blank";
      a.rel = "noreferrer";
      a.click();
      return;
    }
    if (!body) return;
    const blob = new Blob([body], { type: bodyMime || "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${bodyKind}-${jobId.slice(0, 8)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [rawSrc, body, bodyMime, bodyKind, jobId]);

  const meta = quote?.breakdown;
  const draftMeta = useMemo(() => {
    const code = artifacts.find((a) => a.kind === "code");
    const draft = artifacts.find((a) => a.kind === "draft");
    const doc = artifacts.find((a) => a.kind === "document");
    const hit = code ?? draft ?? doc;
    return (hit?.meta ?? null) as { provider?: string; model?: string; language?: string } | null;
  }, [artifacts]);
  const liveModel =
    (typeof draftMeta?.model === "string" && draftMeta.model) ||
    (typeof draftMeta?.provider === "string" && draftMeta.provider) ||
    meta?.model ||
    null;

  const panel = (
    <article
      className={cn(
        "overflow-hidden rounded-2xl border border-line bg-surface",
        "shadow-[0_1px_0_rgba(255,255,255,0.03)]",
        fullscreen && "fixed inset-2 z-50 flex flex-col md:inset-6",
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-signal-deep">
            Result · {normalizeTab(bodyKind)}
            {liveModel ? " · live" : ""}
          </p>
          <p className="mt-0.5 font-display text-lg font-semibold tracking-tight text-ink">
            {outcomeFailed ? "Generation failed. You were not charged." : "Beacon finished this for you"}
          </p>
          {liveModel && (
            <p className="mt-1 font-mono text-[11px] text-ink-faint">
              {liveModel}
              {draftMeta?.language ? ` · ${draftMeta.language}` : ""}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {contentQuery.isFetching && (
            <Loader2 className="size-4 animate-spin text-ink-faint" aria-hidden />
          )}
          {isText && (
            <IconBtn onClick={() => void onCopy()} label={copied ? "Copied" : "Copy"}>
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </IconBtn>
          )}
          <IconBtn onClick={onDownload} label="Download">
            <Download className="size-3.5" />
          </IconBtn>
          <IconBtn onClick={() => setExpanded((v) => !v)} label={expanded ? "Collapse" : "Expand"}>
            <Expand className="size-3.5" />
          </IconBtn>
          <IconBtn
            onClick={() => setFullscreen((v) => !v)}
            label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </IconBtn>
          {fullscreen && (
            <IconBtn onClick={() => setFullscreen(false)} label="Close">
              <X className="size-3.5" />
            </IconBtn>
          )}
        </div>
      </header>

      {sorted.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-line px-4 py-2.5 sm:px-5">
          <button
            type="button"
            onClick={() => setMode("summary")}
            className={cn(
              "rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-wider transition-transform active:scale-[0.98]",
              mode === "summary"
                ? "bg-signal text-ink"
                : "border border-line bg-paper text-ink-muted hover:text-ink",
            )}
          >
            Summary
          </button>
          {sorted.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                setMode("artifact");
                setActiveId(a.id);
              }}
              className={cn(
                "rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-wider transition-transform active:scale-[0.98]",
                mode === "artifact" && selectedId === a.id
                  ? "bg-signal text-ink"
                  : "border border-line bg-paper text-ink-muted hover:text-ink",
              )}
            >
              {normalizeTab(a.kind)}
            </button>
          ))}
        </div>
      )}

      <div
        className={cn(
          "overflow-y-auto px-4 py-5 sm:px-6",
          fullscreen ? "flex-1" : expanded ? "max-h-[min(90vh,900px)]" : "max-h-[min(70vh,640px)]",
        )}
      >
        {mode === "summary" && (
          <SummaryBlock acceptance={acceptance} quote={quote} status={status} />
        )}
        {mode === "artifact" && contentQuery.isError && (
          <p className="text-sm text-danger">Could not load this file. Try another tab.</p>
        )}
        {mode === "artifact" && !contentQuery.isError && !body && contentQuery.isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}

        {mode === "artifact" && body && isImage && bodyMime.includes("svg") && (
          <div
            className="overflow-hidden rounded-xl border border-line bg-paper [&_svg]:h-auto [&_svg]:w-full"
            dangerouslySetInnerHTML={{ __html: body }}
          />
        )}
        {mode === "artifact" && isImage && rawSrc && !bodyMime.includes("svg") && (
          <img
            src={rawSrc}
            alt={`${bodyKind} result`}
            className="mx-auto max-h-[min(70vh,640px)] w-full rounded-xl object-contain"
          />
        )}
        {mode === "artifact" && isVideo && rawSrc && (
          <video
            src={rawSrc}
            controls
            playsInline
            className="mx-auto max-h-[min(70vh,640px)] w-full rounded-xl bg-ink"
          />
        )}
        {mode === "artifact" && isText && body && (
          <div className="prose-beacon max-w-none overflow-x-auto text-[15px] leading-7 text-ink [&_img]:max-w-full [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-line [&_pre]:bg-[#0d1117] [&_pre]:p-4 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_code]:font-mono [&_code]:text-[13px] [&_h1]:font-display [&_h1]:text-xl [&_h1]:font-semibold sm:[&_h1]:text-2xl [&_h2]:mt-6 [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-semibold sm:[&_h2]:text-xl [&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
              {body}
            </ReactMarkdown>
          </div>
        )}
        {mode === "artifact" &&
          !body &&
          !isImage &&
          !isVideo &&
          !contentQuery.isLoading &&
          !contentQuery.isError && (
            <SummaryBlock acceptance={acceptance} quote={quote} status={status} />
          )}
        {mode === "artifact" && contentQuery.data?.truncated && (
          <p className="mt-4 font-mono text-[11px] text-ink-faint">Preview truncated.</p>
        )}
      </div>
    </article>
  );

  return (
    <motion.div
      key="result"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto w-full max-w-3xl"
    >
      <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl md:text-4xl">
        {needsLook
          ? "Needs a quick look"
          : outcomePassed
            ? "Done"
            : outcomeFailed
              ? "Generation failed"
              : statusLabel(status)}
      </h1>
      <p className="mt-2 max-w-[65ch] text-ink-muted">
        {needsLook && "Quality is uncertain. Accept to settle, or reject with no charge."}
        {outcomePassed && paidDisplay && `Paid ${paidDisplay} · quality checks passed`}
        {outcomePassed && !paidDisplay && "Quality checks passed"}
        {outcomeFailed && failBlurb}
      </p>

      {(meta || quote) && (
        <dl className="mt-5 grid grid-cols-2 gap-3 rounded-2xl border border-line bg-paper/40 p-4 text-xs sm:grid-cols-4">
          <MetaCell label="Model" value={meta?.model ?? "—"} />
          <MetaCell
            label="Tokens"
            value={
              meta ? `${meta.inputTokens} in · ${meta.outputTokens} out` : "—"
            }
          />
          <MetaCell label="Total" value={quote?.priceDisplay ?? "—"} />
          <MetaCell label="ETA was" value={quote ? `~${Math.round(quote.etaSeconds / 60)} min` : "—"} />
        </dl>
      )}

      {(outcomePassed || needsLook || (outcomeFailed && sorted.length > 0)) && (
        <div className="mt-6">{panel}</div>
      )}

      {acceptance?.notes && acceptance.notes.length > 0 && (
        <ul className="mt-4 space-y-1 rounded-xl border border-dashed border-line bg-paper px-4 py-3 font-mono text-xs text-ink-muted">
          {acceptance.notes.slice(0, 8).map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      {needsLook && (
        <div className="mt-6 flex flex-wrap gap-3">
          <Button disabled={lookPending} onClick={() => onLook("accept")}>
            Accept
          </Button>
          <Button variant="danger" disabled={lookPending} onClick={() => onLook("reject")}>
            Reject
          </Button>
        </div>
      )}

      <FlareRails status={status} lockTx={lockTx} settleTx={settleTx} compact payMode={payMode} />

      <div className="mt-6 rounded-2xl border border-line bg-surface p-5">
        <p className="font-mono text-[11px] uppercase tracking-widest text-ink-faint">Receipt</p>
        <dl className="mt-3 space-y-2 text-sm">
          <Row label="Job" value={`${jobId.slice(0, 8)}…`} mono />
          {paidDisplay && (
            <Row label="Amount" value={outcomeFailed ? "$0.00" : paidDisplay} />
          )}
          <Row
            label="Status"
            value={
              outcomeFailed
                ? (receipt?.display?.statusLabel ?? "Not charged")
                : outcomePassed
                  ? (receipt?.display?.statusLabel ?? "Paid")
                  : statusLabel(status)
            }
          />
          {lockTx && (
            <Row
              label="Lock tx"
              value={
                <a
                  href={`${NETWORK.explorer}/tx/${lockTx}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs text-signal-deep underline"
                >
                  {lockTx.slice(0, 10)}…
                </a>
              }
            />
          )}
          {settleTx && (
            <Row
              label="Settle tx"
              value={
                <a
                  href={`${NETWORK.explorer}/tx/${settleTx}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs text-signal-deep underline"
                >
                  {settleTx.slice(0, 10)}…
                </a>
              }
            />
          )}
        </dl>
      </div>

      <div className="mt-6">
        <FacetCtaPair left="Home" right="New job" leftTo="/" />
        <Button className="mt-3" variant="ghost" onClick={onNew}>
          Start another job
        </Button>
      </div>

      {fullscreen && (
        <div
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm"
          aria-hidden
          onClick={() => setFullscreen(false)}
        />
      )}
    </motion.div>
  );
}

function SummaryBlock({
  acceptance,
  quote,
  status,
}: {
  acceptance: import("@/lib/types").AcceptanceSummary | null;
  quote: QuoteDto | null;
  status: JobStatus;
}) {
  return (
    <div className="space-y-3 text-sm text-ink-muted">
      <p className="font-display text-lg font-semibold text-ink">Delivery summary</p>
      <p>{acceptance?.summary ?? statusLabel(status)}</p>
      {quote?.includes?.length ? (
        <ul className="list-disc space-y-1 pl-5">
          {quote.includes.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  label,
}: {
  children: ReactNode;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="inline-flex size-8 items-center justify-center rounded-full border border-line bg-paper text-ink-muted transition-transform hover:text-ink active:scale-[0.96]"
    >
      {children}
    </button>
  );
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">{label}</dt>
      <dd className="mt-0.5 font-mono text-ink">{value}</dd>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-ink-muted">{label}</dt>
      <dd className={cn(mono && "font-mono text-xs text-ink")}>{value}</dd>
    </div>
  );
}
