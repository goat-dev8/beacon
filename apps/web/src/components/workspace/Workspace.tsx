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
  openCoston2Faucet,
  shortAddress,
} from "@/lib/wallet";
import { useProductWallet } from "@/lib/productWallet";
import { ensureSafeAgentSession, readSafeAgentSession } from "@/lib/safeSession";
import { DeskContextStrip } from "@/components/workspace/DeskContextStrip";
import { ResultExperience } from "@/components/workspace/ResultExperience";
import { NETWORK, CONTRACTS } from "@/lib/chain";
import { FLARE_STEPS_SAFE, FLARE_STEPS_WALLET, flareStepState } from "@/lib/flareSteps";

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

const SERVICE_HINTS: Partial<
  Record<ServiceId, { blurb: string; examples: string[]; placeholder?: string }>
> = {
  research: {
    blurb:
      "Research a protocol, product, competitor, market, project, or topic. You get what was researched, key findings, conclusions, and caveats — not invented citations.",
    examples: [
      "Research SparkDEX",
      "Compare two DeFi protocols",
      "Research the latest XRP ecosystem developments",
      "Analyze a protocol before I use it",
    ],
    placeholder: "What should Beacon research?",
  },
  coding: {
    blurb: "Describe the program or snippet you need. You should get runnable code, not a scaffold.",
    examples: [
      "Python calculator: two numbers and + - * / from input, print the result",
      "TypeScript function that formats a Coston2 address",
    ],
  },
  documents: {
    blurb: "Reports, SOPs, school or work docs — say audience, length, and must-haves.",
    examples: ["One-page SOP for depositing Coston2 USDT0 into Beacon Safe"],
  },
  marketing: {
    blurb: "Campaign copy you can ship: headlines, body, CTA, channel notes.",
    examples: ["Landing headlines for Beacon Safe on Flare Coston2"],
  },
  design: {
    blurb: "Visual direction plus a generated creative. Name the surface, mood, and constraints.",
    examples: ["App icon for a Flare wallet: signal green, geometric, dark background"],
  },
  image: {
    blurb: "A generated still: thumbnail, product shot, or creative.",
    examples: ["Square thumbnail: Beacon mark, paper background, signal-green accent"],
  },
  ui: {
    blurb: "Layouts, components, and handoff notes. Prefer a single screen and platform.",
    examples: ["Mobile jobs quote screen: price, Safe pay, wallet fallback"],
  },
  branding: {
    blurb: "Name, personality, usage, and a generated mark visual.",
    examples: ["Brand pack for a Coston2 research desk named Signal Brief"],
  },
  analysis: {
    blurb: "A real analysis: question, findings, trade-offs, recommendation, caveats.",
    examples: ["Analyze whether to swap USDT0→FXRP on Coston2 vs waiting for mainnet SparkDEX"],
  },
  presentations: {
    blurb: "A usable deck: slides with headlines, bullets, and speaker notes.",
    examples: ["8-slide deck: how Beacon Safe + FCC gates agent spend on Coston2"],
  },
  planning: {
    blurb: "An actionable plan: goal, milestones, risks, next step.",
    examples: ["Plan a 7-day Coston2 test: faucet, Safe, swap, one research job"],
  },
  agents: {
    blurb: "An agent spec: role, tools, guardrails, sample first message.",
    examples: ["Agent brief for a Flare research assistant that never invents URLs"],
  },
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
  const [thinkingLines, setThinkingLines] = useState<string[]>([]);
  const [lockTx, setLockTx] = useState<string | null>(null);
  const [payMode, setPayMode] = useState<"safe" | "wallet" | null>(null);
  const [liveTick, setLiveTick] = useState(0);

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
      if (LIVE_STATUSES.includes(status) || status === "NEEDS_LOOK") return 1200;
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
    const rail = jobQuery.data?.paymentRail;
    if (rail) {
      setPayMode(rail.mode);
      setLockTx(rail.lockTxHash);
    }
    const s = job.status;
    if (LIVE_STATUSES.includes(s)) setStep("live");
    else if (
      ["PASSED", "CLOSED", "NEEDS_LOOK", "SETTLING", "FAILED", "REFUSING"].includes(s)
    ) {
      setStep("result");
    }
  }, [jobQuery.data?.job, jobQuery.data?.paymentRail]);

  const form = useForm<BriefForm>({
    resolver: zodResolver(briefSchema),
    defaultValues: { briefText: "" },
  });

  const mint = useMutation({
    mutationFn: async () => {
      openCoston2Faucet();
    },
    onSuccess: () => setError(null),
    onError: (err) => setError(err instanceof Error ? err.message : "Could not open faucet."),
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
      setPayMode("wallet");
      return api.approveJob(
        jobId,
        offerId,
        {
          payer: auth.payer,
          payee: auth.payee,
          amount: auth.amount,
          validAfter: auth.validAfter,
          validBefore: auth.validBefore,
          nonce: auth.nonce,
          signature: auth.signature,
          lockTxHash: auth.lockTxHash,
        },
        { mode: "wallet" },
      );
    },
    onSuccess: () => {
      setStep("live");
      setError(null);
      void qc.invalidateQueries({ queryKey: ["job", jobId] });
      void qc.invalidateQueries({ queryKey: ["agent-vault-status"] });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Approve failed.");
    },
  });

  const approveSafe = useMutation({
    mutationFn: async () => {
      if (!jobId || !offerId || !quote) throw new Error("Missing quote.");
      if (!account) throw new Error("Connect your wallet first.");
      const session = await ensureSafeAgentSession(account);
      const result = await api.approveJobFromSafe(jobId, offerId, {
        ownerWallet: account,
        sessionToken: session.token,
      });
      setLockTx(result.lockTxHash ?? null);
      setPayMode("safe");
      return result;
    },
    onSuccess: () => {
      setStep("live");
      setError(null);
      void qc.invalidateQueries({ queryKey: ["job", jobId] });
      void qc.invalidateQueries({ queryKey: ["agent-vault-status", account] });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Safe approve failed.");
    },
  });

  const vaultQuery = useQuery({
    queryKey: ["agent-vault-status", account ?? "none"],
    queryFn: () => api.getVaultStatus({ wallet: account ?? undefined }),
    enabled: Boolean(account),
    refetchInterval: 12_000,
  });
  const vaultLive = vaultQuery.data?.status?.configured ? vaultQuery.data.status : null;
  const agentSession = readSafeAgentSession(account);
  const safeCanPay =
    Boolean(vaultLive) &&
    !vaultLive!.paused &&
    vaultLive!.sessionActive &&
    Number(vaultLive!.balanceDisplay) >= Number(quote?.priceDisplay?.replace(/^\$/, "") ?? Infinity);

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
        const rec = data as { type?: string; payload?: { text?: string; stage?: string; status?: string } };
        const text = rec.payload?.text || rec.payload?.stage;
        if (rec.type === "thinking" && rec.payload?.text) {
          const line = rec.payload.text;
          setStreamNote(line);
          setThinkingLines((prev) => {
            if (prev[prev.length - 1] === line) return prev;
            return [...prev.slice(-7), line];
          });
        } else if (text) {
          setStreamNote(String(text));
        }
        void qc.invalidateQueries({ queryKey: ["job", jobId] });
      }
      if (event === "heartbeat") void qc.invalidateQueries({ queryKey: ["job", jobId] });
    });
  }, [jobId, step, qc]);

  useEffect(() => {
    const events = jobQuery.data?.recentEvents ?? [];
    const texts = events
      .filter((e) => e.type === "thinking")
      .map((e) => (e.payload as { text?: string } | null)?.text)
      .filter((t): t is string => Boolean(t))
      .reverse();
    if (texts.length) {
      setThinkingLines((prev) => (prev.length >= texts.length ? prev : texts.slice(-8)));
      setStreamNote(texts[texts.length - 1] ?? null);
    }
  }, [jobQuery.data?.recentEvents]);

  useEffect(() => {
    if (step !== "live") return;
    setLiveTick(0);
    const t = setInterval(() => setLiveTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [step, jobId]);

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
    setThinkingLines([]);
    setLockTx(null);
    setPayMode(null);
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
        <div className="mx-auto flex min-h-14 max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-5">
          {embedded ? (
            <p className="min-w-0 truncate font-mono text-[11px] uppercase tracking-[0.16em] text-ink-muted">
              {labelForStep(step)}
            </p>
          ) : (
            <Link to="/" className="inline-flex items-center gap-2 text-ink" aria-label="Beacon home">
              <BeaconMark className="size-7 text-ink" />
              <span className="font-display text-lg font-bold">Beacon</span>
            </Link>
          )}
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            {!embedded && (
              <Link
                to="/flow"
                className="hidden rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-ink hover:border-signal sm:inline-flex"
              >
                Flow
              </Link>
            )}
            <Badge tone="signal" className="hidden min-[380px]:inline-flex">
              Live desk
            </Badge>
            {account ? (
              <Badge>{shortAddress(account)}</Badge>
            ) : (
              <Button
                variant="ink"
                size="sm"
                className="clip-facet-nav-left"
                onClick={() => void onConnect()}
                disabled={connecting}
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

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-5 sm:py-10">
        <StepRail step={step} />

        {!embedded && (
          <p className="mb-6 text-sm text-ink-muted">
            Need Flare swap / FTSO signals / x402 agents?{" "}
            <Link to="/flow" className="font-medium text-signal-deep underline">
              Open Beacon Flow
            </Link>
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
              <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl md:text-4xl">
                Choose a service
              </h1>
              <p className="mt-2 text-sm text-ink-muted sm:text-base">One tap. Then describe the job.</p>
              <div className="mt-6 grid gap-0 border border-line sm:mt-8 sm:grid-cols-2 lg:grid-cols-3">
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
                        "border-b border-r border-line bg-surface p-4 text-left transition-colors sm:p-5",
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
              <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
                Describe the job
              </h1>
              <p className="mt-2 text-sm text-ink-muted sm:text-base">
                Service: <span className="font-mono text-signal-deep">{serviceId}</span>
              </p>
              {SERVICE_HINTS[serviceId]?.blurb && (
                <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-muted">
                  {SERVICE_HINTS[serviceId]?.blurb}
                </p>
              )}
              {SERVICE_HINTS[serviceId]?.examples && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {SERVICE_HINTS[serviceId]!.examples.map((example) => (
                    <button
                      key={example}
                      type="button"
                      onClick={() => form.setValue("briefText", example, { shouldValidate: true })}
                      className="max-w-full rounded-full border border-line bg-surface px-3 py-1.5 text-left text-xs text-ink-muted hover:border-signal/50 hover:text-ink"
                    >
                      {example}
                    </button>
                  ))}
                </div>
              )}
              <form
                className="mt-6 space-y-4 sm:mt-8"
                onSubmit={form.handleSubmit((values) => createAndQuote.mutate(values.briefText))}
              >
                <textarea
                  {...form.register("briefText")}
                  rows={8}
                  placeholder={
                    SERVICE_HINTS[serviceId]?.placeholder ??
                    "What should Beacon finish? Audience, tone, length, must-haves…"
                  }
                  className="w-full max-w-full resize-y border border-line bg-surface px-4 py-3 text-ink outline-none transition focus:border-ink focus:ring-2 focus:ring-signal/30"
                />
                {form.formState.errors.briefText && (
                  <p className="text-sm text-danger">{form.formState.errors.briefText.message}</p>
                )}
                <Button
                  type="submit"
                  size="lg"
                  className="w-full sm:w-auto"
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
              <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">Your quote</h1>
              <div className="mt-6 overflow-hidden rounded-2xl border border-line bg-surface p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] sm:mt-8 sm:p-6">
                <p className="font-mono text-xs uppercase tracking-widest text-ink-faint">
                  Micro price · USDT0
                </p>
                <p className="mt-2 break-all font-display text-3xl font-extrabold text-ink sm:text-4xl">{quote.priceDisplay}</p>
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
                    <li>1. Unlock Beacon Agent once per browser session</li>
                    <li>2. Agent executor pays from your Safe (no per-job wallet prompt)</li>
                    <li>3. BeaconEscrow locks Coston2 USDT0</li>
                    <li>4. Agent generates · acceptance gates run</li>
                    <li>5. Escrow release on pass · refund to Safe/wallet on fail</li>
                  </ol>
                  <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
                    Safe path: your session proves who requested the job; the on-chain Safe policy
                    authorizes vault.execute(transfer→escrow), then lockPrepaid. Wallet fallback
                    uses ERC-20 approve + lockFrom.
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
                    {mint.isPending ? "Opening faucet…" : "Get Coston2 USDT0"}
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

              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <Button
                  size="lg"
                  className="w-full sm:w-auto"
                  onClick={() => approveSafe.mutate()}
                  disabled={approveSafe.isPending || approve.isPending || !safeCanPay}
                >
                  {approveSafe.isPending ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Paying from Safe…
                    </>
                  ) : (
                    agentSession ? "Pay from Beacon Safe" : "Unlock agent & pay"
                  )}
                </Button>
                <Button
                  size="lg"
                  variant="ghost"
                  className="w-full sm:w-auto"
                  onClick={() => approve.mutate()}
                  disabled={approve.isPending || approveSafe.isPending || !account}
                >
                  {approve.isPending ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Signing & locking…
                    </>
                  ) : (
                    "Pay with wallet"
                  )}
                </Button>
                <Button variant="ghost" size="lg" className="w-full sm:w-auto" onClick={() => setStep("describe")}>
                  Edit brief
                </Button>
              </div>
              <p className="mt-3 text-sm text-ink-muted">
                {safeCanPay
                  ? agentSession
                    ? "Agent session active: the executor locks from your Safe within policy — no MetaMask for this job."
                    : "One wallet signature unlocks this browser session; then the executor handles jobs without per-job prompts."
                  : "Fund Beacon Safe (and set policy) for zero MetaMask job locks, or pay once with wallet USDT0."}
              </p>
              <p className="mt-1 font-mono text-[11px] text-ink-faint">
                Wallet fallback: ERC-20 approve → BeaconEscrow.lockFrom. Safe path:
                vault.execute(transfer) → escrow.lockPrepaid.
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
              <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">Live progress</h1>
              <p className="mt-2 text-ink-muted">
                {status ? statusLabel(status) : "Starting…"}
                {streamNote ? ` · ${streamNote}` : ""}
              </p>
              <p className="mt-1 font-mono text-[11px] text-ink-faint">
                gpt-5.6-sol · {liveTick}s elapsed · real model, live retrieval
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
              <Timeline
                status={status}
                thinking={streamNote}
                refunded={
                  jobQuery.data?.acceptance?.result === "FAIL" ||
                  (jobQuery.data?.recentEvents ?? []).some((e) => {
                    const p = e.payload as { trigger?: string } | null | undefined;
                    return e.type === "status" && p?.trigger === "generation_failed";
                  })
                }
              />
              <FlareRails
                status={status}
                lockTx={lockTx}
                payMode={payMode}
                thinkingLines={thinkingLines}
              />
            </motion.div>
          )}

          {step === "result" && status && (
            <ResultExperience
              status={status}
              jobId={jobId!}
              quote={quote}
              lockTx={lockTx}
              payMode={payMode}
              acceptance={jobQuery.data?.acceptance ?? null}
              artifacts={artifactsQuery.data?.artifacts ?? []}
              recentEvents={jobQuery.data?.recentEvents ?? []}
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
  return `Agent Jobs · ${STEP_LABELS[step]}`;
}

function StepRail({ step }: { step: Step }) {
  const items: Step[] = ["choose", "describe", "quote", "live", "result"];
  const labels = STEP_LABELS;
  const idx = items.indexOf(step);
  return (
    <ol className="mb-8 flex flex-wrap gap-1.5 sm:mb-10 sm:gap-2">
      {items.map((s, i) => (
        <li
          key={s}
          className={cn(
            "rounded-full px-2.5 py-1 font-mono text-[9px] uppercase tracking-wider transition-colors sm:px-3 sm:text-[10px]",
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

function Timeline({
  status,
  refunded = false,
  thinking,
}: {
  status?: JobStatus;
  refunded?: boolean;
  thinking?: string | null;
}) {
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
  const failed = status === "FAILED" || status === "REFUSING" || refunded;
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
                {failed && s === "SETTLING"
                  ? status === "FAILED"
                    ? "Refund queued"
                    : "Refunding escrow"
                  : statusLabel(s)}
              </span>
              {active && (thinking || streamNoteHint(status)) ? (
                <p className="mt-0.5 font-mono text-[11px] text-ink-muted">
                  {thinking || streamNoteHint(status)}
                </p>
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
  if (status === "PREPARING") return "Worker picked up the locked job…";
  if (status === "GENERATING") return "gpt-5.6-sol thinking · retrieving sources · composing…";
  if (status === "COMPOSING") return "Handing artifacts to quality checks…";
  if (status === "ACCEPTING") return "Objective and brand gates; AI judge when available…";
  if (status === "SETTLING") return "Releasing escrow to the configured payee…";
  return null;
}

function FlareRails({
  status,
  lockTx,
  settleTx,
  compact = false,
  payMode = null,
  thinkingLines = [],
}: {
  status?: JobStatus;
  lockTx: string | null;
  settleTx?: string | null;
  compact?: boolean;
  payMode?: "safe" | "wallet" | null;
  thinkingLines?: string[];
}) {
  const steps = payMode === "wallet" ? FLARE_STEPS_WALLET : FLARE_STEPS_SAFE;
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
            {payMode === "wallet"
              ? "ERC-20 lockFrom · Coston2 USDT0 escrow"
              : "Beacon Safe · Coston2 USDT0 escrow"}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            {payMode === "wallet"
              ? "Payment Required → authorize → lock → settle → receipt"
              : "Fund Safe → vault.execute → lockPrepaid → settle → receipt"}
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
        {steps.map((step) => {
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
                {step.id === "generate" && state === "active" && thinkingLines.length > 0 ? (
                  <ul className="mt-2 space-y-1 border-l border-signal/40 pl-3">
                    {thinkingLines.map((line, i) => (
                      <li
                        key={`${i}-${line.slice(0, 24)}`}
                        className={cn(
                          "font-mono text-[11px] leading-relaxed",
                          i === thinkingLines.length - 1 ? "text-signal-deep" : "text-ink-muted",
                        )}
                      >
                        {i === thinkingLines.length - 1 ? "▸ " : "· "}
                        {line}
                      </li>
                    ))}
                  </ul>
                ) : null}
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
