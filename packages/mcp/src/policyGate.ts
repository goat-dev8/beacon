import type { McpGrant } from "./grants.js";
import { hasScope, type McpScope } from "./scopes.js";

export type SpendPolicySnapshot = {
  emergencyPause: boolean;
  dailySpendUsdt0: number;
  perJobLimitUsdt0: number;
  spentTodayUsdt0: number;
};

export type ToolAuthzResult =
  | { ok: true; amountUsdt0: number }
  | { ok: false; code: string; message: string };

/**
 * Server-side authorization for MCP tool calls.
 * On-chain Safe policy remains the final financial boundary for executes.
 */
export function authorizeToolCall(opts: {
  grant: McpGrant;
  neededScope: McpScope;
  amountUsdt0?: number;
  policy: SpendPolicySnapshot;
}): ToolAuthzResult {
  if (!hasScope(opts.grant.scopes, opts.neededScope)) {
    return {
      ok: false,
      code: "SCOPE_DENIED",
      message: `This agent is not allowed to use scope ${opts.neededScope}.`,
    };
  }
  if (opts.policy.emergencyPause) {
    return {
      ok: false,
      code: "SAFE_PAUSED",
      message: "Beacon Safe / app policy is paused. Unlock and clear emergency pause first.",
    };
  }

  const amount = Number(opts.amountUsdt0 ?? 0);
  if (!Number.isFinite(amount) || amount < 0) {
    return { ok: false, code: "INVALID_AMOUNT", message: "Invalid spend amount." };
  }

  if (opts.neededScope.startsWith("exec:") && amount > 0) {
    if (amount > opts.grant.maxSpendPerTxUsdt0 + 1e-9) {
      return {
        ok: false,
        code: "MCP_TX_LIMIT",
        message: `Agent per-transaction limit is ${opts.grant.maxSpendPerTxUsdt0} USDT0; requested ${amount}.`,
      };
    }
    if (amount > opts.grant.dailyLimitUsdt0 + 1e-9) {
      return {
        ok: false,
        code: "MCP_DAILY_LIMIT",
        message: `Agent daily limit is ${opts.grant.dailyLimitUsdt0} USDT0; requested ${amount}.`,
      };
    }
    if (amount > opts.policy.perJobLimitUsdt0 + 1e-9) {
      return {
        ok: false,
        code: "APP_PER_JOB_LIMIT",
        message: `App per-job limit is ${opts.policy.perJobLimitUsdt0} USDT0; requested ${amount}.`,
      };
    }
    const remaining = Math.max(0, opts.policy.dailySpendUsdt0 - opts.policy.spentTodayUsdt0);
    if (amount > remaining + 1e-9) {
      return {
        ok: false,
        code: "APP_DAILY_LIMIT",
        message: `App daily remaining is ${remaining} USDT0; requested ${amount}.`,
      };
    }
  }

  return { ok: true, amountUsdt0: amount };
}

export const BEACON_MCP_INSTRUCTIONS = `You are connected to Beacon MCP — Flare AI OS (same rails as beacon-desk.vercel.app Flow).

Flow map (Coston2):
- swap: Beacon Safe USDT0 → FXRP via Coston2 swap desk (no MetaMask). Tool: swap({ amountUsdt0 }).
- bridge: Agent OFT FXRP from Coston2 → live LayerZero peer (Sepolia, Base Sepolia, BSC Testnet, …). Tool: bridge({ amountFxrp, destination }). Spend/policy is on Coston2 (114); destination is the peer chain name, NOT an allowedChains check for Sepolia.
- signals / portfolio / fassets / yield: read tools below.
- jobs / x402 / fassets_redeem: use exec tools when scoped; never invent txs.

Rules:
1. Never ask for private keys / seeds.
2. Never bypass Safe policy or MCP scopes.
3. Before spend: get_policy + get_safe.
4. On SCOPE_DENIED / MCP_TX_LIMIT / SAFE_PAUSED — stop and explain.
5. Prefer get_bridge_routes before bridge; use exact live destination names (e.g. "Sepolia").
6. On success, always show explorer / LayerZero links from the tool result.
`;
