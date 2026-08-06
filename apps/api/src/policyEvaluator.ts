import type { Redis } from "@upstash/redis";
import {
  getDailySpendUsdt0,
  isSessionExpired,
  loadPolicy,
  type BeaconSecurityPolicy,
} from "./securityPolicy.js";

export const POLICY_VERSION = "1.0.0";

export type PolicyDecision = {
  allowed: boolean;
  reason: string;
  policyVersion: string;
  enforcement: "server";
  fccMode: "simulated" | "unavailable" | "verified";
  checks: Record<string, unknown>;
};

export type PolicyEvaluateInput = {
  wallet?: string | null;
  workflowType?: string;
  agentId?: string;
  amountUsdt0?: number;
  chainId?: number;
  serviceId?: string;
  durationSeconds?: number;
};

function resolveFccMode(): PolicyDecision["fccMode"] {
  const raw = (process.env.FCC_MODE ?? "unavailable").toLowerCase();
  if (raw === "verified") return "verified";
  if (raw === "simulated") return "simulated";
  return "unavailable";
}

function agentFromWorkflow(workflowType?: string): string | undefined {
  if (!workflowType) return undefined;
  const map: Record<string, string> = {
    "swap.usdt0_fxrp": "swap",
    "bridge.fxrp_oft": "bridge",
    "media.image": "image",
    "research.report": "research",
    bound_work: "desk",
    "trade.signal_action": "trade",
    "signals.deep": "signals",
  };
  return map[workflowType];
}

function serviceFromWorkflow(workflowType?: string): string | undefined {
  if (workflowType === "media.image") return "image";
  if (workflowType?.startsWith("media.")) return "video";
  return undefined;
}

export async function evaluatePolicy(
  redis: Redis | null,
  input: PolicyEvaluateInput,
): Promise<PolicyDecision> {
  const fccMode = resolveFccMode();
  const agentId = input.agentId ?? agentFromWorkflow(input.workflowType);
  const serviceId = input.serviceId ?? serviceFromWorkflow(input.workflowType);
  const needsSpendAccounting =
    (input.amountUsdt0 != null && input.amountUsdt0 > 0) ||
    Boolean(input.workflowType) ||
    serviceId === "image" ||
    serviceId === "video";

  if (!input.wallet) {
    return {
      allowed: true,
      reason: "No wallet — policy skipped",
      policyVersion: POLICY_VERSION,
      enforcement: "server",
      fccMode,
      checks: { walletRequired: false },
    };
  }

  // Fail closed: delegated execution / spend accounting requires Redis.
  if (!redis && needsSpendAccounting) {
    return {
      allowed: false,
      reason:
        "Security policy spend accounting requires Redis. Refusing spend while Redis is unavailable (fail closed).",
      policyVersion: POLICY_VERSION,
      enforcement: "server",
      fccMode,
      checks: { redisRequired: true, redisAvailable: false },
    };
  }

  const { policy, source } = await loadPolicy(redis, input.wallet);
  const spentToday = await getDailySpendUsdt0(redis, input.wallet);
  const checks: Record<string, unknown> = {
    policySource: source,
    spentTodayUsdt0: spentToday,
    emergencyPause: policy.emergencyPause,
    agentId,
    serviceId,
    amountUsdt0: input.amountUsdt0,
    chainId: input.chainId,
    allowedChains: policy.allowedChains,
    sessionExpiryHours: policy.sessionExpiryHours,
    sessionStartedAt: policy.sessionStartedAt ?? policy.updatedAt ?? null,
  };

  if (source === "unavailable" && needsSpendAccounting) {
    return {
      allowed: false,
      reason:
        "Security policy store unavailable — spend denied (fail closed). Configure Upstash Redis.",
      policyVersion: POLICY_VERSION,
      enforcement: "server",
      fccMode,
      checks,
    };
  }

  if (isSessionExpired(policy)) {
    return {
      allowed: false,
      reason: `Security session expired after ${policy.sessionExpiryHours}h. Refresh policy in Security Center.`,
      policyVersion: POLICY_VERSION,
      enforcement: "server",
      fccMode,
      checks: { ...checks, sessionExpired: true },
    };
  }
  checks.sessionExpired = false;

  if (input.chainId != null && policy.allowedChains.length > 0) {
    if (!policy.allowedChains.includes(input.chainId)) {
      return {
        allowed: false,
        reason: `Chain ${input.chainId} is not allowed by your spending policy.`,
        policyVersion: POLICY_VERSION,
        enforcement: "server",
        fccMode,
        checks: { ...checks, chainAllowed: false },
      };
    }
    checks.chainAllowed = true;
  }

  if (policy.emergencyPause) {
    return {
      allowed: false,
      reason: "Emergency pause is on in Security Center. Resume spending to continue.",
      policyVersion: POLICY_VERSION,
      enforcement: "server",
      fccMode,
      checks,
    };
  }

  if (agentId && policy.allowedAgents.length > 0 && !policy.allowedAgents.includes(agentId)) {
    return {
      allowed: false,
      reason: `Agent "${agentId}" is blocked by your spending policy.`,
      policyVersion: POLICY_VERSION,
      enforcement: "server",
      fccMode,
      checks: { ...checks, agentAllowed: false },
    };
  }
  checks.agentAllowed = agentId ? true : undefined;

  if (input.amountUsdt0 != null && input.amountUsdt0 > 0) {
    if (!redis) {
      return {
        allowed: false,
        reason: "Cannot verify daily spend without Redis (fail closed).",
        policyVersion: POLICY_VERSION,
        enforcement: "server",
        fccMode,
        checks: { ...checks, redisRequired: true },
      };
    }
    if (input.amountUsdt0 > policy.perJobLimitUsdt0) {
      return {
        allowed: false,
        reason: `Per-job limit is ${policy.perJobLimitUsdt0} USDT0; this job is ${input.amountUsdt0.toFixed(2)}.`,
        policyVersion: POLICY_VERSION,
        enforcement: "server",
        fccMode,
        checks: { ...checks, perJobLimitUsdt0: policy.perJobLimitUsdt0 },
      };
    }
    if (spentToday + input.amountUsdt0 > policy.dailySpendUsdt0) {
      return {
        allowed: false,
        reason: `Daily budget ${policy.dailySpendUsdt0} USDT0 exceeded (spent ${spentToday.toFixed(2)} today).`,
        policyVersion: POLICY_VERSION,
        enforcement: "server",
        fccMode,
        checks: {
          ...checks,
          dailySpendUsdt0: policy.dailySpendUsdt0,
          remainingUsdt0: Math.max(0, policy.dailySpendUsdt0 - spentToday),
        },
      };
    }
  }

  if (serviceId === "image" && input.amountUsdt0 != null) {
    if (input.amountUsdt0 > policy.maxImageCostUsdt0) {
      return {
        allowed: false,
        reason: `Max image cost is ${policy.maxImageCostUsdt0} USDT0 under your policy.`,
        policyVersion: POLICY_VERSION,
        enforcement: "server",
        fccMode,
        checks: { ...checks, maxImageCostUsdt0: policy.maxImageCostUsdt0 },
      };
    }
  }

  if (
    serviceId === "video" &&
    input.durationSeconds != null &&
    input.durationSeconds > policy.maxVideoSeconds
  ) {
    return {
      allowed: false,
      reason: `Max video duration is ${policy.maxVideoSeconds}s under your policy.`,
      policyVersion: POLICY_VERSION,
      enforcement: "server",
      fccMode,
      checks: { ...checks, maxVideoSeconds: policy.maxVideoSeconds },
    };
  }

  return {
    allowed: true,
    reason: "Policy checks passed (server-enforced).",
    policyVersion: POLICY_VERSION,
    enforcement: "server",
    fccMode,
    checks: {
      ...checks,
      dailySpendUsdt0: policy.dailySpendUsdt0,
      perJobLimitUsdt0: policy.perJobLimitUsdt0,
      remainingUsdt0: Math.max(0, policy.dailySpendUsdt0 - spentToday),
    },
  };
}

export type PolicyCheckResult = {
  policy: BeaconSecurityPolicy;
  spentToday: number;
};
