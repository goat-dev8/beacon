import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion, AnimatePresence } from "motion/react";
import {
  Clapperboard,
  Image,
  Mic,
  Presentation,
  Code2,
  Search,
  FileText,
  ArrowLeft,
  Check,
  Loader2,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router-dom";
import { api, ApiError, subscribeJobEvents } from "@/lib/api";
import type { JobStatus, QuoteDto, ServiceId } from "@/lib/types";
import { formatEta, cn } from "@/lib/utils";
import { LIVE_STATUSES, statusLabel, statusProgress, TERMINAL_STATUSES } from "@/lib/status";
import { Button, FacetCtaPair } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { BeaconMark } from "@/components/diagrams/BeaconDiagrams";
import {
  approveJobOnChain,
  connectEvmWallet,
  hasEvmProvider,
  mintMockUsdt0,
  shortAddress,
} from "@/lib/wallet";
import { NETWORK, CONTRACTS } from "@/lib/chain";
import { FLARE_STEPS, flareStepState } from "@/lib/flareSteps";
import type { Address } from "viem";

const ICONS: Record<ServiceId, LucideIcon> = {
  video: Clapperboard,
  image: Image,
  voice: Mic,
  presentations: Presentation,
  coding: Code2,
  research: Search,
  documents: FileText,
};

const briefSchema = z.object({
  briefText: z.string().min(8, "Add a bit more detail.").max(20_000),
});

type BriefForm = z.infer<typeof briefSchema>;
type Step = "choose" | "describe" | "quote" | "live" | "result";

export function Workspace() {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>(() => {
    const q = new URLSearchParams(window.location.search).get("job");
    return q ? "result" : "choose";
  });
  const [serviceId, setServiceId] = useState<ServiceId | null>(null);
  const [jobId, setJobId] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get("job"),
  );
  const [offerId, setOfferId] = useState<string | null>(null);
  const [quote, setQuote] = useState<QuoteDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streamNote, setStreamNote] = useState<string | null>(null);
  const [account, setAccount] = useState<Address | null>(null);
  const [lockTx, setLockTx] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    const url = new URL(window.location.href);
    url.searchParams.set("job", jobId);
    window.history.replaceState({}, "", url.toString());
  }, [jobId]);

  const servicesQuery = useQuery({
    queryKey: ["services"],
    queryFn: api.services,
  });

  const jobQuery = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api.getJob(jobId!),
    enabled: Boolean(jobId),
    refetchInterval: (q) => {
      const status = q.state.data?.job.status;
      if (!status) return false;
      if (LIVE_STATUSES.includes(status) || status === "NEEDS_LOOK") return 2500;
      return false;
    },
  });

  const artifactsQuery = useQuery({
    queryKey: ["artifacts", jobId],
    queryFn: () => api.artifacts(jobId!),
    enabled: Boolean(jobId) &&
      ["PASSED", "CLOSED", "NEEDS_LOOK", "SETTLING", "FAILED", "REFUSING"].includes(
        jobQuery.data?.job.status ?? "",
      ),
  });

  useEffect(() => {
    const job = jobQuery.data?.job;
    if (!job) return;
    setServiceId((prev) => prev ?? job.service_id);
    const s = job.status;
    if (LIVE_STATUSES.includes(s)) setStep("live");
    else if (
      ["PASSED", "CLOSED", "NEEDS_LOOK", "SETTLING", "FAILED", "REFUSING"].includes(s)
    ) {
      setStep("result");
    }
  }, [jobQuery.data?.job]);

  const form = useForm<BriefForm>({
    resolver: zodResolver(briefSchema),
    defaultValues: { briefText: "" },
  });

  const connect = useMutation({
    mutationFn: connectEvmWallet,
    onSuccess: (addr) => {
      setAccount(addr);
      setError(null);
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Wallet connect failed."),
  });

  const mint = useMutation({
    mutationFn: () => mintMockUsdt0(),
    onSuccess: () => setError(null),
    onError: (err) => setError(err instanceof Error ? err.message : "Mint failed."),
  });

  const createAndQuote = useMutation({
    mutationFn: async (briefText: string) => {
      if (!serviceId) throw new Error("Pick a service first.");
      const created = await api.createJob({ serviceId, briefText });
      return api.quoteJob(created.jobId);
    },
    onSuccess: (data) => {
      setJobId(data.jobId);
      setOfferId(data.offerId);
      setQuote(data.quote);
      setStep("quote");
      setError(null);
      void qc.invalidateQueries({ queryKey: ["job", data.jobId] });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Could not create quote.");
    },
  });

  const approve = useMutation({
    mutationFn: async () => {
      if (!jobId || !offerId || !quote) throw new Error("Missing quote.");
      if (!account) throw new Error("Connect your wallet first.");
      const auth = await approveJobOnChain({
        jobId,
        priceDisplay: quote.priceDisplay,
      });
      setLockTx(auth.lockTxHash ?? null);
      return api.approveJob(jobId, offerId, {
        payer: auth.payer,
        payee: auth.payee,
        amount: auth.amount,
        validAfter: auth.validAfter,
        validBefore: auth.validBefore,
        nonce: auth.nonce,
        signature: auth.signature,
        lockTxHash: auth.lockTxHash,
      });
    },
    onSuccess: () => {
      setStep("live");
      setError(null);
      void qc.invalidateQueries({ queryKey: ["job", jobId] });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Approve failed.");
    },
  });

  const look = useMutation({
    mutationFn: (decision: "accept" | "reject") => api.look(jobId!, decision),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["job", jobId] }),
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Decision failed.");
    },
  });

  useEffect(() => {
    if (!jobId || step !== "live") return;
    return subscribeJobEvents(jobId, (event, data) => {
      if (event === "message") {
        const payload = data as { stage?: string };
        if (payload.stage) setStreamNote(String(payload.stage));
        void qc.invalidateQueries({ queryKey: ["job", jobId] });
      }
      if (event === "heartbeat") void qc.invalidateQueries({ queryKey: ["job", jobId] });
    });
  }, [jobId, step, qc]);

  const status = jobQuery.data?.job.status;
  useEffect(() => {
    if (!status) return;
    if (
      status === "NEEDS_LOOK" ||
      status === "PASSED" ||
      status === "CLOSED" ||
      status === "FAILED" ||
      status === "REFUSING"
    ) {
      setStep("result");
    }
  }, [status]);

  const progress = useMemo(() => (status ? statusProgress(status) : 0), [status]);

  function resetJob() {
    setStep("choose");
    setServiceId(null);
    setJobId(null);
    setOfferId(null);
    setQuote(null);
    setError(null);
    setStreamNote(null);
    setLockTx(null);
    form.reset();
    const url = new URL(window.location.href);
    url.searchParams.delete("job");
    window.history.replaceState({}, "", url.pathname);
  }

  return (
    <div className="min-h-dvh bg-paper crosshair-grid">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-5">
          <Link to="/" className="inline-flex items-center gap-2 text-ink" aria-label="Beacon home">
            <BeaconMark className="size-7 text-ink" />
            <span className="font-display text-lg font-bold">Beacon</span>
          </Link>
          <div className="flex items-center gap-2">
            <Badge tone="signal">Live desk</Badge>
            {account ? (
              <Badge>{shortAddress(account)}</Badge>
            ) : (
              <Button
                variant="ink"
                size="sm"
                className="clip-facet-nav-left"
                onClick={() => connect.mutate()}
                disabled={connect.isPending || !hasEvmProvider()}
              >
                <Wallet className="size-3.5" />
                {connect.isPending ? "Connecting…" : "Connect"}
              </Button>
            )}
            {step !== "choose" && (
              <Button variant="ghost" size="sm" onClick={resetJob}>
                New job
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-10">
        <StepRail step={step} />

        {!hasEvmProvider() && (
          <p className="mb-4 text-sm text-warn">
            Install MetaMask or Rabby to approve jobs on {NETWORK.name}.
          </p>
        )}

        {error && (
          <div
            role="alert"
            className="mb-6 border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger"
          >
            {error}
          </div>
        )}

        <AnimatePresence mode="wait">
          {step === "choose" && (
            <motion.div
              key="choose"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              <h1 className="font-display text-3xl font-extrabold tracking-tight md:text-4xl">
                Choose a service
              </h1>
              <p className="mt-2 text-ink-muted">One tap. Then describe the job.</p>
              <div className="mt-8 grid gap-0 border border-line sm:grid-cols-2 lg:grid-cols-3">
                {servicesQuery.isLoading &&
                  Array.from({ length: 7 }).map((_, i) => (
                    <Skeleton key={i} className="h-28 rounded-none border-b border-r border-line" />
                  ))}
                {servicesQuery.isError && (
                  <p className="col-span-full p-4 text-sm text-danger">
                    Services unavailable. The API may be waking up — retry in a moment.
                  </p>
                )}
                {servicesQuery.data?.services.map((s) => {
                  const Icon = ICONS[s.id] ?? FileText;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setServiceId(s.id);
                        setStep("describe");
                      }}
                      className={cn(
                        "border-b border-r border-line bg-surface p-5 text-left transition-opacity hover:opacity-90",
                        serviceId === s.id && "bg-signal/15",
                      )}
                    >
                      <Icon className="size-5 text-ink" />
                      <p className="mt-3 font-display text-lg font-bold">{s.name}</p>
                      <p className="mt-1 text-sm text-ink-muted">{s.description}</p>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}

          {step === "describe" && serviceId && (
            <motion.div
              key="describe"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              <button
                type="button"
                className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
                onClick={() => setStep("choose")}
              >
                <ArrowLeft className="size-4" /> Back
              </button>
              <h1 className="font-display text-3xl font-extrabold tracking-tight">Describe the job</h1>
              <p className="mt-2 text-ink-muted">
                Service: <span className="font-mono text-signal-deep">{serviceId}</span>
              </p>
              <form
                className="mt-8 space-y-4"
                onSubmit={form.handleSubmit((values) => createAndQuote.mutate(values.briefText))}
              >
                <textarea
                  {...form.register("briefText")}
                  rows={8}
                  placeholder="What should Beacon finish? Audience, tone, length, must-haves…"
                  className="w-full resize-y border border-line bg-surface px-4 py-3 text-ink outline-none transition focus:border-ink focus:ring-2 focus:ring-signal/30"
                />
                {form.formState.errors.briefText && (
                  <p className="text-sm text-danger">{form.formState.errors.briefText.message}</p>
                )}
                <Button type="submit" size="lg" disabled={createAndQuote.isPending}>
                  {createAndQuote.isPending ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Getting quote…
                    </>
                  ) : (
                    "Get instant quote"
                  )}
                </Button>
              </form>
            </motion.div>
          )}

          {step === "quote" && quote && (
            <motion.div
              key="quote"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="mx-auto max-w-lg"
            >
              <h1 className="font-display text-3xl font-extrabold tracking-tight">Your quote</h1>
              <div className="mt-8 border border-line bg-surface p-6">
                <p className="font-mono text-xs uppercase tracking-widest text-ink-faint">Price</p>
                <p className="mt-2 font-display text-4xl font-extrabold text-ink">{quote.priceDisplay}</p>
                <p className="mt-2 text-sm text-ink-muted">ETA {formatEta(quote.etaSeconds)}</p>
                <ul className="mt-6 space-y-2 border-t border-line pt-5">
                  {quote.includes.map((item) => (
                    <li key={item} className="flex items-center gap-2 text-sm text-ink-muted">
                      <Check className="size-4 text-signal-deep" /> {item}
                    </li>
                  ))}
                </ul>
                <p className="mt-4 font-mono text-[11px] text-ink-faint">
                  Expires {new Date(quote.expiresAt).toLocaleTimeString()}
                </p>
              </div>

              {!account && (
                <div className="mt-6 space-y-3 border border-dashed border-line bg-paper p-4">
                  <p className="text-sm text-ink-muted">
                    Connect a wallet on {NETWORK.name} to approve and lock funds in escrow.
                  </p>
                  <Button onClick={() => connect.mutate()} disabled={connect.isPending}>
                    <Wallet className="size-4" />
                    {connect.isPending ? "Connecting…" : "Connect wallet"}
                  </Button>
                </div>
              )}

              {account && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="ghost" size="sm" onClick={() => mint.mutate()} disabled={mint.isPending}>
                    {mint.isPending ? "Minting…" : "Mint test USD₮0"}
                  </Button>
                  <a
                    href={NETWORK.faucet}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-9 items-center rounded-full border border-line px-4 text-xs text-ink-muted hover:bg-paper-2"
                  >
                    Coston2 faucet
                  </a>
                </div>
              )}

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Button
                  size="lg"
                  onClick={() => approve.mutate()}
                  disabled={approve.isPending || !account}
                >
                  {approve.isPending ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Signing & locking…
                    </>
                  ) : (
                    "Approve"
                  )}
                </Button>
                <Button variant="ghost" size="lg" onClick={() => setStep("describe")}>
                  Edit brief
                </Button>
              </div>
              <p className="mt-3 font-mono text-[11px] text-ink-faint">
                Approve signs EIP-3009 and calls BeaconEscrow.lockWithAuthorization on Coston2.
              </p>
            </motion.div>
          )}

          {step === "live" && (
            <motion.div
              key="live"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="mx-auto max-w-lg"
            >
              <h1 className="font-display text-3xl font-extrabold tracking-tight">Live progress</h1>
              <p className="mt-2 text-ink-muted">
                {status ? statusLabel(status) : "Starting…"}
                {streamNote ? ` · ${streamNote}` : ""}
              </p>
              {lockTx && (
                <a
                  href={`${NETWORK.explorer}/tx/${lockTx}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block font-mono text-xs text-signal-deep underline"
                >
                  Escrow lock tx →
                </a>
              )}
              <div className="mt-8 h-2 overflow-hidden bg-paper-2">
                <motion.div
                  className="h-full bg-signal"
                  animate={{ width: `${Math.max(progress, 8)}%` }}
                  transition={{ type: "spring", stiffness: 80, damping: 20 }}
                />
              </div>
              <Timeline status={status} />
              <FlareRails status={status} lockTx={lockTx} />
            </motion.div>
          )}

          {step === "result" && status && (
            <ResultPanel
              status={status}
              jobId={jobId!}
              quote={quote}
              lockTx={lockTx}
              acceptance={jobQuery.data?.acceptance ?? null}
              artifacts={artifactsQuery.data?.artifacts ?? []}
              onLook={(d) => look.mutate(d)}
              lookPending={look.isPending}
              onNew={resetJob}
            />
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function StepRail({ step }: { step: Step }) {
  const items: Step[] = ["choose", "describe", "quote", "live", "result"];
  const labels: Record<Step, string> = {
    choose: "Service",
    describe: "Brief",
    quote: "Quote",
    live: "Progress",
    result: "Result",
  };
  const idx = items.indexOf(step);
  return (
    <ol className="mb-10 flex flex-wrap gap-2">
      {items.map((s, i) => (
        <li
          key={s}
          className={cn(
            "px-3 py-1 font-mono text-[10px] uppercase tracking-wider",
            i <= idx ? "bg-signal text-ink" : "bg-paper-2 text-ink-faint",
          )}
        >
          {labels[s]}
        </li>
      ))}
    </ol>
  );
}

function Timeline({ status }: { status?: JobStatus }) {
  const stages: JobStatus[] = [
    "AUTHORIZED",
    "PREPARING",
    "GENERATING",
    "COMPOSING",
    "ACCEPTING",
    "SETTLING",
    "CLOSED",
  ];
  const current = status ? stages.indexOf(status) : -1;
  return (
    <ul className="mt-8 space-y-3">
      {stages.map((s, i) => {
        const done = current > i || status === "CLOSED" || status === "PASSED";
        const active =
          status === s || (s === "CLOSED" && status != null && TERMINAL_STATUSES.includes(status));
        return (
          <li key={s} className="flex items-center gap-3 text-sm">
            <span
              className={cn(
                "size-2.5 rounded-full",
                done || active ? "bg-signal-deep" : "bg-line",
                active && "animate-pulse",
              )}
            />
            <span className={done || active ? "text-ink" : "text-ink-faint"}>{statusLabel(s)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function FlareRails({
  status,
  lockTx,
  settleTx,
  compact = false,
}: {
  status?: JobStatus;
  lockTx: string | null;
  settleTx?: string | null;
  compact?: boolean;
}) {
  return (
    <section
      className={cn(
        "border border-dashed border-line bg-paper",
        compact ? "mt-6 p-4" : "mt-10 p-5",
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-mono text-[11px] uppercase tracking-widest text-ink-faint">
          Flare rails · Coston2
        </p>
        <a
          href={NETWORK.explorer}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[10px] text-signal-deep underline"
        >
          Explorer →
        </a>
      </div>
      <ol className="mt-4 space-y-3">
        {FLARE_STEPS.map((step) => {
          const state = flareStepState(step, status, Boolean(lockTx));
          return (
            <li key={step.id} className="flex gap-3">
              <span
                className={cn(
                  "mt-1 size-2.5 shrink-0 rounded-full",
                  state === "done" && "bg-signal-deep",
                  state === "active" && "animate-pulse bg-signal",
                  state === "todo" && "bg-line",
                )}
              />
              <div className="min-w-0">
                <p
                  className={cn(
                    "text-sm font-medium",
                    state === "todo" ? "text-ink-faint" : "text-ink",
                  )}
                >
                  {step.label}
                </p>
                <p className="font-mono text-[11px] leading-relaxed text-ink-muted">{step.detail}</p>
              </div>
            </li>
          );
        })}
      </ol>
      {(lockTx || settleTx) && (
        <div className="mt-4 flex flex-wrap gap-3 border-t border-dashed border-line pt-3 font-mono text-[11px]">
          {lockTx && (
            <a
              href={`${NETWORK.explorer}/tx/${lockTx}`}
              target="_blank"
              rel="noreferrer"
              className="text-signal-deep underline"
            >
              Lock {lockTx.slice(0, 10)}…
            </a>
          )}
          {settleTx && (
            <a
              href={`${NETWORK.explorer}/tx/${settleTx}`}
              target="_blank"
              rel="noreferrer"
              className="text-signal-deep underline"
            >
              Settle {settleTx.slice(0, 10)}…
            </a>
          )}
          <a
            href={`${NETWORK.explorer}/address/${CONTRACTS.escrow}`}
            target="_blank"
            rel="noreferrer"
            className="text-ink-muted underline"
          >
            BeaconEscrow
          </a>
        </div>
      )}
    </section>
  );
}

function ResultPanel({
  status,
  jobId,
  quote,
  lockTx,
  acceptance,
  artifacts,
  onLook,
  lookPending,
  onNew,
}: {
  status: JobStatus;
  jobId: string;
  quote: QuoteDto | null;
  lockTx: string | null;
  acceptance: import("@/lib/types").AcceptanceSummary | null;
  artifacts: Array<{ id: string; kind: string; uri: string; meta?: Record<string, unknown> | null }>;
  onLook: (d: "accept" | "reject") => void;
  lookPending: boolean;
  onNew: () => void;
}) {
  const passed = status === "PASSED" || status === "CLOSED" || status === "SETTLING";
  const failed = status === "FAILED" || status === "REFUSING";
  const needsLook = status === "NEEDS_LOOK";

  const primary =
    artifacts.find((a) => a.kind === "video") ??
    artifacts.find((a) => a.kind === "image") ??
    artifacts.find((a) => a.kind === "draft") ??
    artifacts.find((a) => a.kind === "document") ??
    artifacts.find((a) => a.kind === "captions") ??
    artifacts[0];

  const contentQuery = useQuery({
    queryKey: ["artifact-content", jobId, primary?.id],
    queryFn: () => api.artifactContent(jobId, primary!.id),
    enabled: Boolean(primary?.id),
  });

  const receiptQuery = useQuery({
    queryKey: ["job-receipt", jobId],
    queryFn: () => api.jobReceipt(jobId),
    enabled: passed || failed,
  });

  const settleTx =
    receiptQuery.data?.receipt?.txHash ??
    receiptQuery.data?.receipt?.payment?.txHash ??
    null;
  const paidDisplay =
    quote?.priceDisplay ??
    (receiptQuery.data?.receipt?.payment?.amountUsdt0
      ? `$${(Number(receiptQuery.data.receipt.payment.amountUsdt0) / 1e6).toFixed(2)}`
      : null);

  const [activeId, setActiveId] = useState<string | null>(null);
  const selectedId = activeId ?? primary?.id ?? null;

  const selectedQuery = useQuery({
    queryKey: ["artifact-content", jobId, selectedId],
    queryFn: () => api.artifactContent(jobId, selectedId!),
    enabled: Boolean(selectedId),
  });

  const body = selectedQuery.data?.content ?? contentQuery.data?.content;
  const bodyKind = selectedQuery.data?.kind ?? primary?.kind ?? "result";
  const bodyMime = selectedQuery.data?.mimeType ?? "";
  const isVideo = bodyKind === "video" || bodyMime.startsWith("video/");
  const isImage =
    !isVideo &&
    (bodyKind === "image" || bodyMime.startsWith("image/") || bodyMime.includes("svg"));
  const rawSrc =
    selectedId != null ? api.artifactRawUrl(jobId, selectedId) : null;

  return (
    <motion.div
      key="result"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto w-full max-w-2xl"
    >
      <h1 className="font-display text-3xl font-extrabold tracking-tight">
        {needsLook
          ? "Needs a quick look"
          : passed
            ? "Done"
            : failed
              ? "Not charged"
              : statusLabel(status)}
      </h1>
      <p className="mt-2 text-ink-muted">
        {needsLook && "Quality is uncertain. Accept to settle, or reject with no charge."}
        {passed && paidDisplay && `Paid ${paidDisplay} · quality checks passed`}
        {passed && !paidDisplay && "Quality checks passed"}
        {failed &&
          (acceptance?.summary ??
            "This job did not pass. You were not charged — escrow is refunded.")}
      </p>

      {/* Agent-style result transcript */}
      {(passed || needsLook) && (
        <article className="mt-8 border border-line bg-surface shadow-[0_1px_0_rgba(42,39,53,0.04)]">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-widest text-ink-faint">
                Result · {bodyKind}
              </p>
              <p className="mt-0.5 text-sm text-ink-muted">Beacon finished this for you</p>
            </div>
            {selectedQuery.isFetching && (
              <Loader2 className="size-4 animate-spin text-ink-faint" aria-hidden />
            )}
          </header>

          {artifacts.length > 1 && (
            <div className="flex flex-wrap gap-2 border-b border-dashed border-line px-5 py-3">
              {artifacts.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setActiveId(a.id)}
                  className={cn(
                    "px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider",
                    (selectedId === a.id ? "bg-signal text-ink" : "bg-paper-2 text-ink-muted"),
                  )}
                >
                  {a.kind}
                </button>
              ))}
            </div>
          )}

          <div className="max-h-[min(70vh,640px)] overflow-y-auto px-5 py-6">
            {selectedQuery.isError && (
              <p className="text-sm text-danger">Could not load this file. Try another tab.</p>
            )}
            {!selectedQuery.isError && !body && selectedQuery.isLoading && (
              <div className="space-y-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
              </div>
            )}
            {body && isImage && bodyMime.includes("svg") && (
              <div
                className="overflow-hidden border border-line bg-paper [&_svg]:h-auto [&_svg]:w-full"
                dangerouslySetInnerHTML={{ __html: body }}
              />
            )}
            {isImage && rawSrc && !bodyMime.includes("svg") && (
              <img
                src={rawSrc}
                alt={`${bodyKind} result`}
                className="mx-auto max-h-[min(70vh,640px)] w-full object-contain"
              />
            )}
            {isVideo && rawSrc && (
              <video
                src={rawSrc}
                controls
                playsInline
                autoPlay
                muted
                loop
                className="mx-auto max-h-[min(70vh,640px)] w-full bg-ink"
              />
            )}
            {isImage && rawSrc && bodyMime.includes("svg") && (
              <p className="mt-3">
                <a href={rawSrc} target="_blank" rel="noreferrer" className="font-mono text-xs text-signal-deep underline">
                  Open image file →
                </a>
              </p>
            )}
            {body && !isImage && !isVideo && (
              <div className="prose-beacon whitespace-pre-wrap font-sans text-[15px] leading-7 text-ink">
                {body}
              </div>
            )}
            {!body && !isImage && !isVideo && !selectedQuery.isLoading && !selectedQuery.isError && (
              <p className="text-sm text-ink-muted">
                No preview available for this artifact type.
              </p>
            )}
            {selectedQuery.data?.truncated && (
              <p className="mt-4 font-mono text-[11px] text-ink-faint">Preview truncated.</p>
            )}
          </div>
        </article>
      )}

      {acceptance?.notes && acceptance.notes.length > 0 && (
        <ul className="mt-4 space-y-1 border border-dashed border-line bg-paper px-4 py-3 font-mono text-xs text-ink-muted">
          {acceptance.notes.slice(0, 8).map((n) => (
            <li key={n}>· {n}</li>
          ))}
        </ul>
      )}

      {needsLook && (
        <div className="mt-6 flex gap-3">
          <Button disabled={lookPending} onClick={() => onLook("accept")}>
            Accept
          </Button>
          <Button variant="danger" disabled={lookPending} onClick={() => onLook("reject")}>
            Reject
          </Button>
        </div>
      )}

      <FlareRails status={status} lockTx={lockTx} settleTx={settleTx} compact />

      <div className="mt-6 border border-line bg-surface p-5">
        <p className="font-mono text-[11px] uppercase tracking-widest text-ink-faint">Receipt</p>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Job</dt>
            <dd className="font-mono text-xs text-ink">{jobId.slice(0, 8)}…</dd>
          </div>
          {paidDisplay && (
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">Amount</dt>
              <dd>{failed ? "$0.00" : paidDisplay}</dd>
            </div>
          )}
          <div className="flex justify-between gap-4">
            <dt className="text-ink-muted">Status</dt>
            <dd>{statusLabel(status)}</dd>
          </div>
          {lockTx && (
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">Lock tx</dt>
              <dd>
                <a
                  href={`${NETWORK.explorer}/tx/${lockTx}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs text-signal-deep underline"
                >
                  {lockTx.slice(0, 10)}…
                </a>
              </dd>
            </div>
          )}
          {settleTx && (
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">Settle tx</dt>
              <dd>
                <a
                  href={`${NETWORK.explorer}/tx/${settleTx}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs text-signal-deep underline"
                >
                  {settleTx.slice(0, 10)}…
                </a>
              </dd>
            </div>
          )}
        </dl>
      </div>

      <div className="mt-6">
        <FacetCtaPair left="Home" right="New job" leftTo="/" />
        <Button className="mt-3" variant="ghost" onClick={onNew}>
          Start another job
        </Button>
      </div>
    </motion.div>
  );
}
