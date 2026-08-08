import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion, AnimatePresence } from "motion/react";
import {
  Clapperboard,
  Image,
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
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { BeaconMark } from "@/components/diagrams/BeaconDiagrams";
import {
  approveJobOnChain,
  hasEvmProvider,
  mintMockUsdt0,
  shortAddress,
} from "@/lib/wallet";
import { useProductWallet } from "@/lib/productWallet";
import { DeskContextStrip } from "@/components/workspace/DeskContextStrip";
import { ResultExperience } from "@/components/workspace/ResultExperience";
import { NETWORK, CONTRACTS } from "@/lib/chain";
import { FLARE_STEPS, flareStepState } from "@/lib/flareSteps";

const ICONS: Record<ServiceId, LucideIcon> = {
  video: Clapperboard,
  image: Image,
  presentations: Presentation,
  coding: Code2,
  research: Search,
  documents: FileText,
  marketing: Search,
  design: Image,
  ui: Code2,
  branding: Image,
  analysis: Search,
  planning: FileText,
  agents: Code2,
};

const briefSchema = z.object({
  briefText: z.string().min(8, "Add a bit more detail.").max(20_000),
});

type BriefForm = z.infer<typeof briefSchema>;
type Step = "choose" | "describe" | "quote" | "live" | "result";

export function Workspace({ embedded = false }: { embedded?: boolean } = {}) {
  const qc = useQueryClient();
  const { wallet: account, connect, connecting } = useProductWallet();
  const [step, setStep] = useState<Step>(() => {
    const q = new URLSearchParams(window.location.search).get("job");
    if (q) return "result";
    try {
      const draft = sessionStorage.getItem("beacon.desk.draft");
      if (draft) {
        const parsed = JSON.parse(draft) as { step?: Step };
        if (parsed.step && ["choose", "describe", "quote", "live", "result"].includes(parsed.step)) {
          return parsed.step;
        }
      }
    } catch {
      /* ignore */
    }
    return "choose";
  });
  const [serviceId, setServiceId] = useState<ServiceId | null>(() => {
    try {
      const draft = sessionStorage.getItem("beacon.desk.draft");
      if (draft) {
        const parsed = JSON.parse(draft) as { serviceId?: ServiceId };
        return parsed.serviceId ?? null;
      }
    } catch {
      /* ignore */
    }
    return null;
  });
  const [jobId, setJobId] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get("job"),
  );
  const [offerId, setOfferId] = useState<string | null>(null);
  const [quote, setQuote] = useState<QuoteDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streamNote, setStreamNote] = useState<string | null>(null);
  const [lockTx, setLockTx] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    const url = new URL(window.location.href);
    url.searchParams.set("job", jobId);
    window.history.replaceState({}, "", url.toString());
  }, [jobId]);

  // Keep Bound Work draft across tab switches (Flow <-> Work) so reload feels like Flow.
  useEffect(() => {
    try {
      sessionStorage.setItem(
        "beacon.desk.draft",
        JSON.stringify({ step, serviceId, jobId, offerId }),
      );
    } catch {
      /* ignore */
    }
  }, [step, serviceId, jobId, offerId]);

  // If we restored "quote" without quote data, fall back to the brief step.
  useEffect(() => {
    if (step === "quote" && !quote) setStep(serviceId ? "describe" : "choose");
  }, [step, quote, serviceId]);

  const servicesQuery = useQuery({
    queryKey: ["services"],
    queryFn: api.services,
    staleTime: 60_000,
    retry: 3,
    retryDelay: (n) => Math.min(1000 * 2 ** n, 8000),
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

  const mint = useMutation({
    mutationFn: () => mintMockUsdt0(),
    onSuccess: () => setError(null),
    onError: (err) => setError(err instanceof Error ? err.message : "Mint failed."),
  });

  async function onConnect() {
    try {
      await connect();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wallet connect failed.");
    }
  }

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
      if (err instanceof ApiError) {
        const why =
          err.code === "NO_FIT"
            ? err.message
            : err.message || "Could not create quote.";
        setError(
          err.code === "NO_FIT"
            ? `${why} Pick another catalog service or refine the brief — coding, documents, research, and the rest are supported.`
            : why,
        );
        return;
      }
      setError("Could not create quote.");
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
    try {
      sessionStorage.removeItem("beacon.desk.draft");
    } catch {
      /* ignore */
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("job");
    window.history.replaceState({}, "", url.pathname);
  }

  return (
    <div className={cn("bg-paper", embedded ? "min-h-full" : "min-h-dvh crosshair-grid")}>
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-5">
          {embedded ? (
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-muted">
              {labelForStep(step)}
            </p>
          ) : (
            <Link to="/" className="inline-flex items-center gap-2 text-ink" aria-label="Beacon home">
              <BeaconMark className="size-7 text-ink" />
              <span className="font-display text-lg font-bold">Beacon</span>
            </Link>
          )}
          <div className="flex items-center gap-2">
            {!embedded && (
              <Link
                to="/flow"
                className="hidden rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-ink hover:border-signal sm:inline-flex"
              >
                Flow
              </Link>
            )}
            <Badge tone="signal">Live desk</Badge>
            {account ? (
              <Badge>{shortAddress(account)}</Badge>
            ) : (
              <Button
                variant="ink"
                size="sm"
                className="clip-facet-nav-left"
                onClick={() => void onConnect()}
                disabled={connecting || !hasEvmProvider()}
              >
                <Wallet className="size-3.5" />
                {connecting ? "Connecting…" : "Connect"}
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

        {!embedded && (
          <p className="mb-6 text-sm text-ink-muted">
            Need Flare swap / FTSO signals / x402 agents?{" "}
            <Link to="/flow" className="font-medium text-signal-deep underline">
              Open Beacon Flow
            </Link>
          </p>
        )}

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

        <DeskContextStrip
          escrowLockedDisplay={
            lockTx && quote?.priceDisplay ? quote.priceDisplay : null
          }
          lockTx={lockTx}
        />

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
                  <div className="col-span-full space-y-3 p-4">
                    <p className="text-sm text-danger">
                      Services unavailable. The API may be waking up. Retry in a moment.
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void servicesQuery.refetch()}
                      disabled={servicesQuery.isFetching}
                    >
                      {servicesQuery.isFetching ? "Retrying…" : "Retry"}
                    </Button>
                  </div>
                )}
                {servicesQuery.data?.services.map((s, i, all) => {
                  const Icon = ICONS[s.id] ?? FileText;
                  const isLast = i === all.length - 1;
                  const videoSoon = s.id === "video";
                  return (
                    <button
                      key={s.id}
                      type="button"
                      disabled={videoSoon}
                      onClick={() => {
                        if (videoSoon) return;
                        setServiceId(s.id);
                        setStep("describe");
                      }}
                      className={cn(
                        "border-b border-r border-line bg-surface p-5 text-left transition-colors",
                        videoSoon
                          ? "cursor-not-allowed opacity-60"
                          : "hover:bg-paper-2",
                        serviceId === s.id && !videoSoon && "bg-signal/15",
                        isLast && all.length % 2 === 1 && "sm:col-span-2",
                        isLast && all.length % 3 === 1 && "lg:col-span-3",
                        isLast && all.length % 3 === 2 && "lg:col-span-2",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <Icon className="size-5 text-ink" />
                        {videoSoon && (
                          <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-ink-faint">
                            Coming soon
                          </span>
                        )}
                      </div>
                      <p className="mt-3 font-display text-lg font-bold">{s.name}</p>
                      <p className="mt-1 text-sm text-ink-muted">
                        {videoSoon
                          ? "Video generation is coming soon."
                          : s.description}
                      </p>
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
                <Button
                  type="submit"
                  size="lg"
                  disabled={createAndQuote.isPending || (form.watch("briefText")?.trim().length ?? 0) < 8}
                >
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
              <div className="mt-8 overflow-hidden rounded-2xl border border-line bg-surface p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
                <p className="font-mono text-xs uppercase tracking-widest text-ink-faint">
                  Micro price · MockUSDT0
                </p>
                <p className="mt-2 font-display text-4xl font-extrabold text-ink">{quote.priceDisplay}</p>
                <p className="mt-2 text-sm text-ink-muted">ETA {formatEta(quote.etaSeconds)}</p>
                {quote.breakdown && (
                  <dl className="mt-5 grid gap-2 border-t border-line pt-4 text-xs text-ink-muted sm:grid-cols-2">
                    <div className="flex justify-between gap-2 sm:block">
                      <dt>Model</dt>
                      <dd className="font-mono text-ink">{quote.breakdown.model}</dd>
                    </div>
                    <div className="flex justify-between gap-2 sm:block">
                      <dt>Tokens (est.)</dt>
                      <dd className="font-mono text-ink">
                        {quote.breakdown.inputTokens} in · {quote.breakdown.outputTokens} out
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>Model cost</dt>
                      <dd className="font-mono">${quote.breakdown.modelCostUsdt0}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>Infra</dt>
                      <dd className="font-mono">${quote.breakdown.infraCostUsdt0}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>Platform fee</dt>
                      <dd className="font-mono">${quote.breakdown.platformFeeUsdt0}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>Network cushion</dt>
                      <dd className="font-mono">${quote.breakdown.networkFeeUsdt0}</dd>
                    </div>
                  </dl>
                )}
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
                <div className="mt-4 rounded-xl border border-line/80 bg-paper/40 p-3">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-signal-deep">
                    Settlement timeline
                  </p>
                  <ol className="mt-2 space-y-1.5 text-xs text-ink-muted">
                    <li>1. You sign EIP-3009 (one authorization)</li>
                    <li>2. BeaconEscrow locks MockUSDT0 on Coston2</li>
                    <li>3. Agent generates · acceptance gates run</li>
                    <li>4. Escrow release on pass · refund on fail</li>
                    <li>5. Receipt sealed with lock tx</li>
                  </ol>
                  <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
                    Bound Work escrow is separate from Beacon Safe agent spends. Safe auto-executes
                    allowlisted swaps after you fund it; Bound Work still needs this one owner
                    signature to lock the job budget (Flare EIP-3009 / escrow design).
                  </p>
                </div>
              </div>

              {!account && (
                <div className="mt-6 space-y-3 border border-dashed border-line bg-paper p-4">
                  <p className="text-sm text-ink-muted">
                    Connect a wallet on {NETWORK.name} to approve and lock funds in escrow.
                  </p>
                  <Button onClick={() => void onConnect()} disabled={connecting}>
                    <Wallet className="size-4" />
                    {connecting ? "Connecting…" : "Connect wallet"}
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
            <ResultExperience
              status={status}
              jobId={jobId!}
              quote={quote}
              lockTx={lockTx}
              acceptance={jobQuery.data?.acceptance ?? null}
              artifacts={artifactsQuery.data?.artifacts ?? []}
              onLook={(d) => look.mutate(d)}
              lookPending={look.isPending}
              onNew={resetJob}
              FlareRails={FlareRails}
            />
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

const STEP_LABELS: Record<Step, string> = {
  choose: "Service",
  describe: "Brief",
  quote: "Quote",
  live: "Progress",
  result: "Result",
};

function labelForStep(step: Step) {
  return `Bound Work · ${STEP_LABELS[step]}`;
}

function StepRail({ step }: { step: Step }) {
  const items: Step[] = ["choose", "describe", "quote", "live", "result"];
  const labels = STEP_LABELS;
  const idx = items.indexOf(step);
  return (
    <ol className="mb-10 flex flex-wrap gap-2">
      {items.map((s, i) => (
        <li
          key={s}
          className={cn(
            "rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors",
            i <= idx
              ? "bg-signal text-ink"
              : "border border-line bg-transparent text-ink-faint",
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
  const failed = status === "FAILED" || status === "REFUSING";
  return (
    <ul className="relative mt-8 space-y-0">
      <span
        className="pointer-events-none absolute bottom-2 left-[5px] top-2 w-px bg-line"
        aria-hidden
      />
      {stages.map((s, i) => {
        const done = !failed && (current > i || status === "CLOSED" || status === "PASSED");
        const active =
          status === s ||
          (s === "CLOSED" && status != null && TERMINAL_STATUSES.includes(status) && !failed);
        return (
          <li key={s} className="relative flex items-start gap-3 py-2.5 text-sm">
            <span
              className={cn(
                "relative z-[1] mt-1 size-2.5 shrink-0 rounded-full ring-4 ring-paper",
                failed && i <= 4 ? "bg-signal-deep" : null,
                failed && s === "SETTLING" ? "bg-red-500 animate-pulse" : null,
                !failed && (done || active) ? "bg-signal-deep" : null,
                !failed && !done && !active ? "bg-line" : null,
                active && !failed && "animate-pulse",
              )}
            />
            <div>
              <span className={done || active || (failed && i <= 4) ? "text-ink" : "text-ink-faint"}>
                {statusLabel(s)}
              </span>
              {active && streamNoteHint(status) ? (
                <p className="mt-0.5 font-mono text-[11px] text-ink-muted">{streamNoteHint(status)}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function streamNoteHint(status?: JobStatus): string | null {
  if (!status) return null;
  if (status === "PREPARING") return "Provisioning tools…";
  if (status === "GENERATING") return "Model generating…";
  if (status === "COMPOSING") return "Assembling delivery…";
  if (status === "ACCEPTING") return "Quality gates…";
  if (status === "SETTLING") return "Escrow release / refund…";
  return null;
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
        "overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_0_0_1px_rgba(255,255,255,0.02)]",
        compact ? "mt-6 p-4" : "mt-10 p-5",
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-widest text-signal-deep">
            x402 · Escrow · Coston2
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            Payment Required → authorize → lock → settle → receipt
          </p>
        </div>
        <a
          href={NETWORK.explorer}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[10px] text-signal-deep underline"
        >
          Explorer →
        </a>
      </div>
      <ol className="relative mt-5 space-y-0">
        <span
          className="pointer-events-none absolute bottom-3 left-[5px] top-3 w-px bg-line"
          aria-hidden
        />
        {FLARE_STEPS.map((step) => {
          const state = flareStepState(step, status, Boolean(lockTx));
          return (
            <li key={step.id} className="relative flex gap-3 py-2.5">
              <span
                className={cn(
                  "relative z-[1] mt-1 size-2.5 shrink-0 rounded-full ring-4 ring-surface",
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
        <div className="mt-4 flex flex-wrap gap-3 border-t border-line pt-3 font-mono text-[11px]">
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
