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

export const DEFAULT_SECURITY_POLICY: BeaconSecurityPolicy = {
  dailySpendUsdt0: 50,
  perJobLimitUsdt0: 25,
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
  allowedChains: [114, 14],
  maxImageCostUsdt0: 10,
  maxVideoSeconds: 60,
  emergencyPause: false,
  sessionExpiryHours: 24,
};

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

function migrateStoredPolicy(stored: BeaconSecurityPolicy): BeaconSecurityPolicy {
  const allowedAgents = [
    ...new Set([...stored.allowedAgents.filter((a) => a !== "video"), ...OS_AGENT_ROLLOUT]),
  ];
  const allowedChains = [...new Set([...(stored.allowedChains ?? [114]), 14])];
  return { ...stored, allowedAgents, allowedChains };
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
  const started =
    policy.sessionStartedAt ?? policy.updatedAt ?? null;
  if (!started) return false;
  const startMs = Date.parse(started);
  if (!Number.isFinite(startMs)) return false;
  const hours = policy.sessionExpiryHours ?? DEFAULT_SECURITY_POLICY.sessionExpiryHours;
  return now - startMs > hours * 60 * 60 * 1000;
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
  if (!stored) return { policy: DEFAULT_SECURITY_POLICY, source: "default" };
  return { policy: migrateStoredPolicy(stored), source: "redis" };
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
