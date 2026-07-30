import { keccak256, toUtf8Bytes } from "ethers";
import { chatForRole, extractJsonObject, isAiConfigured, loadEnv, newId } from "@beacon/shared";

export type ServiceId =
  | "video"
  | "image"
  | "voice"
  | "presentations"
  | "coding"
  | "research"
  | "documents";

export interface QuoteInput {
  serviceId: ServiceId;
  briefText: string;
  assetCount?: number;
  durationSeconds?: number;
  slideCount?: number;
  wordCount?: number;
}

export interface CostBreakdown {
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
}

export interface QuoteDto {
  quoteId: string;
  priceDisplay: string;
  etaSeconds: number;
  includes: string[];
  expiresAt: string;
  capability: "FIT" | "NO_FIT";
}

const MARGIN_RATE = 0.25;

const BASE_COSTS: Record<ServiceId, number> = {
  video: 1200,
  image: 350,
  voice: 450,
  presentations: 800,
  coding: 900,
  research: 1100,
  documents: 600,
};

export function hashBrief(briefText: string): string {
  return keccak256(toUtf8Bytes(briefText.trim()));
}

export function hashRubric(serviceId: ServiceId, version = "v1"): string {
  return keccak256(toUtf8Bytes(`${serviceId}:${version}`));
}

export function hashOffer(briefHash: string, rubricHash: string, priceUsdt0: bigint): string {
  return keccak256(
    toUtf8Bytes(`${briefHash}:${rubricHash}:${priceUsdt0.toString()}`),
  );
}

export function estimateCost(input: QuoteInput): CostBreakdown {
  const baseCents = BASE_COSTS[input.serviceId];
  let variableCents = 0;

  switch (input.serviceId) {
    case "video":
      variableCents = Math.round(((input.durationSeconds ?? 15) / 15) * 400);
      variableCents += (input.assetCount ?? 0) * 50;
      break;
    case "image":
      variableCents = (input.assetCount ?? 1) * 120;
      break;
    case "voice":
      variableCents = Math.round(((input.wordCount ?? 150) / 150) * 200);
      break;
    case "presentations":
      variableCents = (input.slideCount ?? 10) * 35;
      break;
    case "coding":
      variableCents = Math.round(((input.wordCount ?? 500) / 500) * 300);
      break;
    case "research":
      variableCents = Math.round(((input.wordCount ?? 800) / 800) * 350);
      break;
    case "documents":
      variableCents = Math.round(((input.wordCount ?? 600) / 600) * 250);
      break;
  }

  const subtotal = baseCents + variableCents;
  const marginCents = Math.round(subtotal * MARGIN_RATE);
  return {
    baseCents,
    variableCents,
    marginCents,
    totalCents: subtotal + marginCents,
  };
}

export function centsToUsdt0(totalCents: number): bigint {
  return BigInt(totalCents) * 10_000n;
}

export function formatPriceDisplay(totalCents: number): string {
  return `$${(totalCents / 100).toFixed(2)}`;
}

export function buildBoundOffer(input: QuoteInput, capability: "FIT" | "NO_FIT"): BoundOfferDraft {
  const cost = estimateCost(input);
  const briefHash = hashBrief(input.briefText);
  const rubricVersion = "v1";
  const rubricHash = hashRubric(input.serviceId, rubricVersion);
  const priceUsdt0 = centsToUsdt0(cost.totalCents);
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
  };
}

export function toQuoteDto(offer: BoundOfferDraft): QuoteDto {
  const totalCents = Number(offer.priceUsdt0 / 10_000n);
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  return {
    quoteId: offer.offerId,
    priceDisplay: formatPriceDisplay(totalCents),
    etaSeconds: offer.slaSeconds,
    includes: includesForService(offer.serviceId),
    expiresAt,
    capability: offer.capability,
  };
}

function slaForService(serviceId: ServiceId): number {
  const map: Record<ServiceId, number> = {
    video: 900,
    image: 300,
    voice: 420,
    presentations: 600,
    coding: 720,
    research: 780,
    documents: 540,
  };
  return map[serviceId];
}

function includesForService(serviceId: ServiceId): string[] {
  const map: Record<ServiceId, string[]> = {
    video: ["Planning", "Generation", "Captioned export", "Quality check"],
    image: ["Creative generation", "Brand-safe review", "Export pack"],
    voice: ["Script polish", "Voice render", "Quality check"],
    presentations: ["Outline", "Slide design", "Speaker notes"],
    coding: ["Implementation", "Review summary", "Docs snippet"],
    research: ["Source sweep", "Structured brief", "Executive summary"],
    documents: ["Draft", "Formatting", "Quality check"],
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
    return { capability: "NO_FIT", reason: "Brief is empty." };
  }

  if (input.briefText.length > 20_000) {
    return { capability: "NO_FIT", reason: "Brief is too long for this service." };
  }

  const heuristicNoFit =
    input.serviceId === "video" && (input.durationSeconds ?? 0) > 120
      ? "Video length exceeds current template limit."
      : undefined;

  if (heuristicNoFit) {
    return { capability: "NO_FIT", reason: heuristicNoFit };
  }

  const env = loadEnv();
  const useAi = Boolean(options.aiBaseUrl && options.aiApiKey) || isAiConfigured(env);
  if (useAi) {
    try {
      return await aiCapabilityCheck(input, options);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const transient = /AI provider (429|502|503|504)/.test(message);
      // Heuristic Sealed Fit remains authoritative when the live provider is capacity-limited.
      // Generation/judge still honor AI_REQUIRE_REAL separately.
      if (transient) {
        return { capability: "FIT", reason: `Provider transient (${message.slice(0, 80)}); heuristic FIT.` };
      }
      if (env.AI_REQUIRE_REAL) throw err;
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
        content:
          'You decide if a creative job fits Beacon\'s first-party services. Reply JSON only: {"fit":true|false,"reason":"short"}.',
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
  { id: "video", name: "Video", description: "Ads, social packs, captioned cuts" },
  { id: "image", name: "Image", description: "Creatives, thumbnails, product shots" },
  { id: "voice", name: "Voice", description: "Narration and multilingual VO" },
  { id: "presentations", name: "Presentations", description: "Decks from brief and assets" },
  { id: "coding", name: "Coding", description: "UI variants, docs, review summaries" },
  { id: "research", name: "Research", description: "Competitor and market packs" },
  { id: "documents", name: "Documents", description: "Reports, SOPs, proposals" },
];
