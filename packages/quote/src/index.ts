import { keccak256, toUtf8Bytes } from "ethers";
import { chatForRole, extractJsonObject, isAiConfigured, loadEnv, newId } from "@beacon/shared";

export type ServiceId =
  | "video"
  | "image"
  | "presentations"
  | "coding"
  | "research"
  | "documents"
  | "marketing"
  | "design"
  | "ui"
  | "branding"
  | "analysis"
  | "planning"
  | "agents";

export interface QuoteInput {
  serviceId: ServiceId;
  briefText: string;
  assetCount?: number;
  durationSeconds?: number;
  slideCount?: number;
  wordCount?: number;
}

/** Micro-pricing breakdown in USDT0 (6 decimals as number for display). */
export interface CostBreakdown {
  model: string;
  inputTokens: number;
  outputTokens: number;
  modelCostUsdt0: number;
  infraCostUsdt0: number;
  platformFeeUsdt0: number;
  networkFeeUsdt0: number;
  totalUsdt0: number;
  /** @deprecated legacy cent fields kept for tests / receipts */
  baseCents: number;
  variableCents: number;
  marginCents: number;
  totalCents: number;
}

export interface BoundOfferDraft {
  offerId: string;
  serviceId: ServiceId;
  briefHash: string;
  rubricVersion: string;
  rubricHash: string;
  priceUsdt0: bigint;
  slaSeconds: number;
  capability: "FIT" | "NO_FIT";
  offerHash: string;
  breakdown: CostBreakdown;
}

export interface QuoteDto {
  quoteId: string;
  priceDisplay: string;
  etaSeconds: number;
  includes: string[];
  expiresAt: string;
  capability: "FIT" | "NO_FIT";
  breakdown?: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    modelCostUsdt0: string;
    infraCostUsdt0: string;
    platformFeeUsdt0: string;
    networkFeeUsdt0: string;
    totalUsdt0: string;
  };
}

const PLATFORM_FEE_RATE = 0.15;
const NETWORK_FEE_USDT0 = 0.001; // Coston2 gas cushion in USDT0 terms (display)
const MIN_PRICE_USDT0 = 0.005;
const MAX_PRICE_USDT0 = 0.08;

/** Rough model rate table (USDT0 per 1M tokens) for demo honesty. */
const MODEL_RATES: Record<string, { in: number; out: number; label: string }> = {
  coding: { in: 0.8, out: 3.2, label: "gpt-5.6-sol" },
  documents: { in: 0.5, out: 2.0, label: "gpt-5.6-sol" },
  research: { in: 1.0, out: 4.0, label: "claude-opus-5" },
  presentations: { in: 0.6, out: 2.4, label: "gpt-5.6-sol" },
  image: { in: 0.4, out: 1.0, label: "flux" },
  video: { in: 0.8, out: 2.0, label: "flux+ffmpeg" },
  marketing: { in: 0.6, out: 2.5, label: "gpt-5.6-sol" },
  design: { in: 0.5, out: 1.5, label: "flux" },
  ui: { in: 0.7, out: 2.8, label: "gpt-5.6-sol" },
  branding: { in: 0.5, out: 1.8, label: "flux" },
  analysis: { in: 0.9, out: 3.5, label: "claude-opus-5" },
  planning: { in: 0.6, out: 2.2, label: "gpt-5.6-sol" },
  agents: { in: 1.0, out: 3.0, label: "gpt-5.6-sol" },
};

const INFRA_USDT0: Record<ServiceId, number> = {
  video: 0.02,
  image: 0.008,
  presentations: 0.006,
  coding: 0.004,
  research: 0.007,
  documents: 0.003,
  marketing: 0.005,
  design: 0.009,
  ui: 0.006,
  branding: 0.008,
  analysis: 0.006,
  planning: 0.004,
  agents: 0.01,
};

const CATALOG_IDS = new Set<string>([
  "video",
  "image",
  "presentations",
  "coding",
  "research",
  "documents",
  "marketing",
  "design",
  "ui",
  "branding",
  "analysis",
  "planning",
  "agents",
]);

export function hashBrief(briefText: string): string {
  return keccak256(toUtf8Bytes(briefText.trim()));
}

export function hashRubric(serviceId: ServiceId, version = "v1"): string {
  return keccak256(toUtf8Bytes(`${serviceId}:${version}`));
}

export function hashOffer(briefHash: string, rubricHash: string, priceUsdt0: bigint): string {
  return keccak256(toUtf8Bytes(`${briefHash}:${rubricHash}:${priceUsdt0.toString()}`));
}

function estimateTokens(input: QuoteInput): { inputTokens: number; outputTokens: number } {
  const briefChars = input.briefText.trim().length;
  const inputTokens = Math.max(80, Math.ceil(briefChars / 4) + 40);
  const defaults: Record<ServiceId, number> = {
    video: 900,
    image: 400,
    presentations: Math.max(600, (input.slideCount ?? 8) * 80),
    coding: Math.max(700, Math.ceil((input.wordCount ?? 400) * 1.4)),
    research: Math.max(900, Math.ceil((input.wordCount ?? 600) * 1.6)),
    documents: Math.max(500, Math.ceil((input.wordCount ?? 500) * 1.3)),
    marketing: 700,
    design: 450,
    ui: 800,
    branding: 500,
    analysis: 1000,
    planning: 750,
    agents: 850,
  };
  return { inputTokens, outputTokens: defaults[input.serviceId] };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function estimateCost(input: QuoteInput): CostBreakdown {
  const rates = MODEL_RATES[input.serviceId] ?? MODEL_RATES.documents;
  const { inputTokens, outputTokens } = estimateTokens(input);
  const modelCost =
    (inputTokens / 1_000_000) * rates.in + (outputTokens / 1_000_000) * rates.out;
  const infra = INFRA_USDT0[input.serviceId] ?? 0.004;
  const subtotal = modelCost + infra;
  const platformFee = subtotal * PLATFORM_FEE_RATE;
  const networkFee = NETWORK_FEE_USDT0;
  let total = round6(subtotal + platformFee + networkFee);
  total = clamp(total, MIN_PRICE_USDT0, MAX_PRICE_USDT0);
  // Keep tiny cent-ish fields for legacy tests (scaled micro → synthetic cents)
  const totalCents = Math.max(1, Math.round(total * 100));
  return {
    model: rates.label,
    inputTokens,
    outputTokens,
    modelCostUsdt0: round6(modelCost),
    infraCostUsdt0: round6(infra),
    platformFeeUsdt0: round6(platformFee),
    networkFeeUsdt0: networkFee,
    totalUsdt0: total,
    baseCents: Math.round(modelCost * 100),
    variableCents: Math.round(infra * 100),
    marginCents: Math.round(platformFee * 100),
    totalCents,
  };
}

/** Convert USDT0 float → 6-decimal integer. */
export function usdt0ToRaw(amount: number): bigint {
  return BigInt(Math.round(amount * 1e6));
}

/** @deprecated use usdt0ToRaw — kept for older callers expecting cents→raw */
export function centsToUsdt0(totalCents: number): bigint {
  // Interpret as legacy cents of a dollar display ($10.63 → 10.63 USDT0)
  return BigInt(totalCents) * 10_000n;
}

export function formatPriceDisplay(totalUsdt0: number): string {
  if (totalUsdt0 < 0.01) return `$${totalUsdt0.toFixed(3)}`;
  return `$${totalUsdt0.toFixed(3)}`;
}

export function buildBoundOffer(input: QuoteInput, capability: "FIT" | "NO_FIT"): BoundOfferDraft {
  const cost = estimateCost(input);
  const briefHash = hashBrief(input.briefText);
  const rubricVersion = "v1";
  const rubricHash = hashRubric(input.serviceId, rubricVersion);
  const priceUsdt0 = usdt0ToRaw(cost.totalUsdt0);
  const offerHash = hashOffer(briefHash, rubricHash, priceUsdt0);

  return {
    offerId: newId(),
    serviceId: input.serviceId,
    briefHash,
    rubricVersion,
    rubricHash,
    priceUsdt0,
    slaSeconds: slaForService(input.serviceId),
    capability,
    offerHash,
    breakdown: cost,
  };
}

export function toQuoteDto(offer: BoundOfferDraft): QuoteDto {
  const total = Number(offer.priceUsdt0) / 1e6;
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  const b = offer.breakdown;
  return {
    quoteId: offer.offerId,
    priceDisplay: formatPriceDisplay(total),
    etaSeconds: offer.slaSeconds,
    includes: includesForService(offer.serviceId),
    expiresAt,
    capability: offer.capability,
    breakdown: b
      ? {
          model: b.model,
          inputTokens: b.inputTokens,
          outputTokens: b.outputTokens,
          modelCostUsdt0: b.modelCostUsdt0.toFixed(6),
          infraCostUsdt0: b.infraCostUsdt0.toFixed(6),
          platformFeeUsdt0: b.platformFeeUsdt0.toFixed(6),
          networkFeeUsdt0: b.networkFeeUsdt0.toFixed(6),
          totalUsdt0: b.totalUsdt0.toFixed(6),
        }
      : undefined,
  };
}

function slaForService(serviceId: ServiceId): number {
  const map: Record<ServiceId, number> = {
    video: 900,
    image: 300,
    presentations: 600,
    coding: 480,
    research: 600,
    documents: 420,
    marketing: 540,
    design: 480,
    ui: 600,
    branding: 540,
    analysis: 600,
    planning: 480,
    agents: 720,
  };
  return map[serviceId];
}

function includesForService(serviceId: ServiceId): string[] {
  const map: Record<ServiceId, string[]> = {
    video: ["Planning", "Generation", "Captioned export", "Quality check"],
    image: ["Creative generation", "Brand-safe review", "Export pack"],
    presentations: ["Outline", "Slide design", "Speaker notes"],
    coding: ["Implementation", "Review summary", "Docs snippet"],
    research: ["Source sweep", "Structured brief", "Executive summary"],
    documents: ["Draft", "Formatting", "Quality check"],
    marketing: ["Brief", "Copy variants", "Channel notes"],
    design: ["Concept", "Visual draft", "Export"],
    ui: ["Layout sketch", "Component notes", "Handoff"],
    branding: ["Direction", "Mark exploration", "Usage notes"],
    analysis: ["Data pass", "Findings", "Recommendations"],
    planning: ["Goals", "Milestones", "Risks"],
    agents: ["Agent brief", "Tool plan", "Guardrails"],
  };
  return map[serviceId];
}

export interface SealedFitOptions {
  aiBaseUrl?: string;
  aiApiKey?: string;
  aiModel?: string;
}

export async function evaluateSealedFit(
  input: QuoteInput,
  options: SealedFitOptions = {},
): Promise<{ capability: "FIT" | "NO_FIT"; reason?: string }> {
  if (!input.briefText.trim()) {
    return { capability: "NO_FIT", reason: "Brief is empty. Add a short description of the job." };
  }

  if (input.briefText.length > 20_000) {
    return { capability: "NO_FIT", reason: "Brief is too long for this service (max 20k characters)." };
  }

  if (!CATALOG_IDS.has(input.serviceId)) {
    return {
      capability: "NO_FIT",
      reason: `"${input.serviceId}" is not an Agent Jobs service. Pick one from the catalog.`,
    };
  }

  if (input.serviceId === "video") {
    return {
      capability: "NO_FIT",
      reason: "Video generation is coming soon. Pick Coding, Documents, Images, or another live service.",
    };
  }

  // Catalog services are supported — do not let the quote model invent "unsupported".
  // Optional AI pass only soft-warns; never blocks coding/documents/etc.
  const env = loadEnv();
  const useAi = Boolean(options.aiBaseUrl && options.aiApiKey) || isAiConfigured(env);
  if (useAi) {
    try {
      const ai = await aiCapabilityCheck(input, options);
      if (ai.capability === "NO_FIT") {
        // Soft: still FIT for catalog, attach advisory reason for UI logging only
        return {
          capability: "FIT",
          reason: `Catalog service accepted. Advisory: ${ai.reason ?? "narrow the brief for best quality."}`,
        };
      }
      return ai;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const transient =
        /AI (?:provider |temporarily unavailable \()(405|429|502|503|504)/.test(message) ||
        /AI provider (405|429|502|503|504)/.test(message);
      if (transient) {
        return { capability: "FIT", reason: `Provider transient; catalog FIT.` };
      }
      if (env.AI_REQUIRE_REAL) {
        // Still accept catalog jobs — quote AI is advisory
        return { capability: "FIT", reason: `Quote AI unavailable; catalog FIT.` };
      }
      return { capability: "FIT" };
    }
  }

  return { capability: "FIT" };
}

async function aiCapabilityCheck(
  input: QuoteInput,
  options: SealedFitOptions,
): Promise<{ capability: "FIT" | "NO_FIT"; reason?: string }> {
  const result = await chatForRole(
    "quote",
    [
      {
        role: "system",
        content: `Beacon Bound Work supports: video, image, presentations, coding, research, documents, marketing, design, ui, branding, analysis, planning, agents.
If the serviceId is in that list and the brief is non-empty, reply {"fit":true,"reason":"ok"}.
Only fit:false for empty/nonsense briefs or clear off-platform asks (e.g. illegal content).
Reply JSON only: {"fit":true|false,"reason":"short"}.`,
      },
      {
        role: "user",
        content: JSON.stringify({
          service: input.serviceId,
          brief: input.briefText.slice(0, 4000),
          assets: input.assetCount ?? 0,
          preferredModel: options.aiModel,
        }),
      },
    ],
    { temperature: 0, maxTokens: 256 },
  );

  try {
    const parsed = extractJsonObject<{ fit?: boolean; reason?: string }>(result.content);
    return parsed.fit
      ? { capability: "FIT" }
      : { capability: "NO_FIT", reason: parsed.reason ?? "Outside current capabilities." };
  } catch {
    const lower = result.content.toLowerCase();
    if (lower.includes("false") || lower.includes('"fit": false')) {
      return { capability: "NO_FIT", reason: "Outside current capabilities." };
    }
    return { capability: "FIT" };
  }
}

export const SERVICE_CATALOG: Array<{ id: ServiceId; name: string; description: string }> = [
  { id: "coding", name: "Coding", description: "UI variants, snippets, review summaries" },
  { id: "documents", name: "Documents", description: "Reports, SOPs, school / work docs" },
  { id: "research", name: "Research", description: "Competitor and market packs" },
  { id: "marketing", name: "Marketing", description: "Campaign copy and channel notes" },
  { id: "design", name: "Design", description: "Visual concepts and export packs" },
  { id: "image", name: "Images", description: "Creatives, thumbnails, product shots" },
  { id: "ui", name: "UI", description: "Layout sketches and component notes" },
  { id: "branding", name: "Branding", description: "Mark exploration and usage notes" },
  { id: "analysis", name: "Analysis", description: "Findings and recommendations" },
  { id: "presentations", name: "Presentation", description: "Decks from brief and assets" },
  { id: "planning", name: "Planning", description: "Goals, milestones, risks" },
  { id: "agents", name: "Agents", description: "Agent briefs, tools, guardrails" },
  { id: "video", name: "Video", description: "Coming soon — video generation is not available yet" },
];
