import type { Redis } from "@upstash/redis";
import { AppError } from "@beacon/shared";

export type BeaconSecurityPolicy = {
  dailySpendUsdt0: number;
  perJobLimitUsdt0: number;
  allowedAgents: string[];
  allowedChains: number[];
  maxImageCostUsdt0: number;
  maxVideoSeconds: number;
  emergencyPause: boolean;
  sessionExpiryHours: number;
};

export const DEFAULT_SECURITY_POLICY: BeaconSecurityPolicy = {
  dailySpendUsdt0: 50,
  perJobLimitUsdt0: 25,
  allowedAgents: [
    "general",
    "signals",
    "swap",
    "bridge",
    "pay",
    "trade",
    "desk",
    "image",
    "video",
    "research",
  ],
  allowedChains: [114],
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

export async function loadPolicy(
  redis: Redis | null,
  wallet: string,
): Promise<{ policy: BeaconSecurityPolicy; source: "redis" | "default" }> {
  if (!redis) return { policy: DEFAULT_SECURITY_POLICY, source: "default" };
  const stored = await redis.get<BeaconSecurityPolicy>(policyKey(wallet));
  return { policy: stored ?? DEFAULT_SECURITY_POLICY, source: stored ? "redis" : "default" };
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
  if (!redis || amountUsdt0 <= 0) return amountUsdt0;
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
  const { policy } = await loadPolicy(redis, input.wallet);
  const spentToday = await getDailySpendUsdt0(redis, input.wallet);

  if (policy.emergencyPause) {
    throw new AppError("VALIDATION", {
      message: "Emergency pause is on in Security Center. Resume spending to continue.",
    });
  }

  if (
    input.agentId &&
    policy.allowedAgents.length > 0 &&
    !policy.allowedAgents.includes(input.agentId)
  ) {
    throw new AppError("VALIDATION", {
      message: `Agent "${input.agentId}" is blocked by your spending policy.`,
    });
  }

  if (input.amountUsdt0 != null && input.amountUsdt0 > 0) {
    if (input.amountUsdt0 > policy.perJobLimitUsdt0) {
      throw new AppError("VALIDATION", {
        message: `Per-job limit is ${policy.perJobLimitUsdt0} USDT0; this job is ${input.amountUsdt0.toFixed(2)}.`,
      });
    }
    if (spentToday + input.amountUsdt0 > policy.dailySpendUsdt0) {
      throw new AppError("VALIDATION", {
        message: `Daily budget ${policy.dailySpendUsdt0} USDT0 exceeded (spent ${spentToday.toFixed(2)} today).`,
      });
    }
  }

  if (input.serviceId === "image" && input.amountUsdt0 != null) {
    if (input.amountUsdt0 > policy.maxImageCostUsdt0) {
      throw new AppError("VALIDATION", {
        message: `Max image cost is ${policy.maxImageCostUsdt0} USDT0 under your policy.`,
      });
    }
  }

  if (
    input.serviceId === "video" &&
    input.durationSeconds != null &&
    input.durationSeconds > policy.maxVideoSeconds
  ) {
    throw new AppError("VALIDATION", {
      message: `Max video duration is ${policy.maxVideoSeconds}s under your policy.`,
    });
  }

  return { policy, spentToday };
}
