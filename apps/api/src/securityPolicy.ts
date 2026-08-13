import type { Redis } from "@upstash/redis";
import { AppError } from "@beacon/shared";
import { evaluatePolicy } from "./policyEvaluator.js";

export type BeaconSecurityPolicy = {
  dailySpendUsdt0: number;
  perJobLimitUsdt0: number;
  allowedAgents: string[];
  allowedChains: number[];
  maxImageCostUsdt0: number;
  maxVideoSeconds: number;
  emergencyPause: boolean;
  sessionExpiryHours: number;
  /** ISO timestamp when policy/session was last established (for expiry). */
  sessionStartedAt?: string;
  updatedAt?: string;
};

/**
 * Defaults match Beacon Safe factory on-chain caps (10 USDT0 per tx / 50 rolling)
 * and Flare Coston2 demos that swap 1 USDT0. The old 5 / 0.1 pair blocked first Flow swaps.
 */
export const DEFAULT_SECURITY_POLICY: BeaconSecurityPolicy = {
  dailySpendUsdt0: 50,
  perJobLimitUsdt0: 10,
  allowedAgents: [
    "general",
    "signals",
    "intel",
    "portfolio",
    "fassets",
    "swap",
    "liquidity",
    "bridge",
    "crosschain",
    "xrpfi",
    "yield",
    "risk",
    "treasury",
    "pay",
    "trade",
    "desk",
    "image",
    "research",
  ],
  allowedChains: [114],
  maxImageCostUsdt0: 0.05,
  maxVideoSeconds: 60,
  emergencyPause: false,
  sessionExpiryHours: 24,
};

/** First-ship Redis defaults that blocked standard 1 USDT0 Coston2 demos. */
const LEGACY_TIGHT_DAILY = 5;
const LEGACY_TIGHT_PER_JOB = 0.1;

export function policyKey(wallet: string): string {
  return `security:policy:${wallet.toLowerCase()}`;
}

export function spendKey(wallet: string, day = utcDay()): string {
  return `security:spend:${wallet.toLowerCase()}:${day}`;
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Agents introduced after the first Security Center ship — auto-union into stale Redis policies. */
const OS_AGENT_ROLLOUT = [
  "intel",
  "portfolio",
  "fassets",
  "liquidity",
  "crosschain",
  "xrpfi",
  "yield",
  "risk",
  "treasury",
] as const;

/** Flow header defaults to `general`. Chat must not be bricked if those chips were left off. */
const CHAT_AGENT_ROLLOUT = ["general", "signals", "research"] as const;

export function isLegacyTightDefaultPolicy(policy: BeaconSecurityPolicy): boolean {
  return (
    !policy.emergencyPause &&
    Number(policy.dailySpendUsdt0) === LEGACY_TIGHT_DAILY &&
    Number(policy.perJobLimitUsdt0) === LEGACY_TIGHT_PER_JOB
  );
}

export function migrateStoredPolicy(stored: BeaconSecurityPolicy): BeaconSecurityPolicy {
  const allowedAgents = [
    ...new Set([
      ...stored.allowedAgents.filter((a) => a !== "video"),
      ...OS_AGENT_ROLLOUT,
      ...CHAT_AGENT_ROLLOUT,
    ]),
  ];
  const allowedChains = [...new Set([...(stored.allowedChains ?? [114]), 14])];
  const next: BeaconSecurityPolicy = { ...stored, allowedAgents, allowedChains };
  if (isLegacyTightDefaultPolicy(stored)) {
    next.dailySpendUsdt0 = DEFAULT_SECURITY_POLICY.dailySpendUsdt0;
    next.perJobLimitUsdt0 = DEFAULT_SECURITY_POLICY.perJobLimitUsdt0;
    next.updatedAt = new Date().toISOString();
  }
  return next;
}

/**
 * Spend accounting and session policy require Redis.
 * Without Redis we fail closed for any monetary / delegated spend path.
 */
export function redisRequiredForSpend(redis: Redis | null): asserts redis is Redis {
  if (!redis) {
    throw new AppError("VALIDATION", {
      message:
        "Security policy spend accounting requires Redis. Refusing spend while Redis is unavailable (fail closed).",
      statusCode: 503,
    });
  }
}

export function isSessionExpired(policy: BeaconSecurityPolicy, now = Date.now()): boolean {
  const hours = Number(policy.sessionExpiryHours ?? DEFAULT_SECURITY_POLICY.sessionExpiryHours);
  if (!Number.isFinite(hours) || hours <= 0) return false;
  // Only an explicit session start counts. `updatedAt` is a policy-edit stamp and
  // must not brick a new Safe on a reused wallet.
  const started = policy.sessionStartedAt ?? null;
  if (!started) return false;
  const startMs = Date.parse(started);
  if (!Number.isFinite(startMs)) return false;
  return now - startMs > hours * 60 * 60 * 1000;
}

/** Persist a fresh server session so Flow/Jobs are not blocked by a stale Redis clock. */
export async function refreshSecuritySession(
  redis: Redis | null,
  wallet: string,
): Promise<BeaconSecurityPolicy | null> {
  if (!redis) return null;
  const { policy, source } = await loadPolicy(redis, wallet);
  if (source === "unavailable") return null;
  const nowIso = new Date().toISOString();
  const next: BeaconSecurityPolicy = {
    ...policy,
    sessionStartedAt: nowIso,
    updatedAt: nowIso,
  };
  await redis.set(policyKey(wallet), next);
  return next;
}

export async function loadPolicy(
  redis: Redis | null,
  wallet: string,
): Promise<{ policy: BeaconSecurityPolicy; source: "redis" | "default" | "unavailable" }> {
  if (!redis) {
    // Defaults only — spend paths fail closed in evaluatePolicy when source is unavailable.
    return { policy: { ...DEFAULT_SECURITY_POLICY }, source: "unavailable" };
  }
  const stored = await redis.get<BeaconSecurityPolicy>(policyKey(wallet));
  if (!stored) return { policy: { ...DEFAULT_SECURITY_POLICY }, source: "default" };
  const policy = migrateStoredPolicy(stored);
  const agentsAdded = policy.allowedAgents.some((a) => !stored.allowedAgents.includes(a));
  if (isLegacyTightDefaultPolicy(stored) || agentsAdded) {
    // Persist so Safe UI and Flow stop disagreeing.
    await redis.set(policyKey(wallet), policy);
  }
  // Stale Redis sessionStartedAt (reused wallet / old App limits save) must not
  // block a freshly created Safe. On-chain sessionExpiresAt is the spend clock.
  if (isSessionExpired(policy) && !policy.emergencyPause) {
    const nowIso = new Date().toISOString();
    policy.sessionStartedAt = nowIso;
    policy.updatedAt = nowIso;
    await redis.set(policyKey(wallet), policy);
  }
  return { policy, source: "redis" };
}

export async function getDailySpendUsdt0(redis: Redis | null, wallet: string): Promise<number> {
  if (!redis) return 0;
  const raw = await redis.get<number | string>(spendKey(wallet));
  return Number(raw ?? 0) || 0;
}

export async function recordSpendUsdt0(
  redis: Redis | null,
  wallet: string,
  amountUsdt0: number,
): Promise<number> {
  if (amountUsdt0 <= 0) return 0;
  redisRequiredForSpend(redis);
  const key = spendKey(wallet);
  const next = (await getDailySpendUsdt0(redis, wallet)) + amountUsdt0;
  await redis.set(key, next, { ex: 60 * 60 * 36 });
  return next;
}

/** Reverse a recorded spend after an on-chain job refund (same UTC day window). */
export async function reverseSpendUsdt0(
  redis: Redis | null,
  wallet: string,
  amountUsdt0: number,
): Promise<number> {
  if (amountUsdt0 <= 0) return 0;
  if (!redis) return 0;
  const key = spendKey(wallet);
  const current = await getDailySpendUsdt0(redis, wallet);
  const next = Math.max(0, current - amountUsdt0);
  await redis.set(key, next, { ex: 60 * 60 * 36 });
  return next;
}

/** Parse "$12.50" or "12.50" → number. */
export function parseUsdt0Display(amount: string | number | bigint): number {
  if (typeof amount === "bigint") return Number(amount) / 1e6;
  if (typeof amount === "number") return amount;
  const cleaned = amount.replace(/[^0-9.]/g, "");
  return Number(cleaned) || 0;
}

export type PolicyCheckInput = {
  wallet?: string | null;
  agentId?: string;
  serviceId?: string;
  amountUsdt0?: number;
  durationSeconds?: number;
};

export async function assertPolicyAllows(
  redis: Redis | null,
  input: PolicyCheckInput,
): Promise<{ policy: BeaconSecurityPolicy; spentToday: number }> {
  if (!input.wallet) {
    return { policy: DEFAULT_SECURITY_POLICY, spentToday: 0 };
  }

  const decision = await evaluatePolicy(redis, input);
  if (!decision.allowed) {
    throw new AppError("VALIDATION", { message: decision.reason });
  }

  const { policy } = await loadPolicy(redis, input.wallet);
  const spentToday = await getDailySpendUsdt0(redis, input.wallet);
  return { policy, spentToday };
}
