import { authorizeToolCall, type SpendPolicySnapshot } from "./policyGate.js";
import type { McpGrant } from "./grants.js";
import { hasScope, type McpScope } from "./scopes.js";

export type McpToolDef = {
  name: string;
  description: string;
  scope: McpScope;
  inputSchema: Record<string, unknown>;
};

export const MCP_TOOL_DEFS: McpToolDef[] = [
  {
    name: "get_safe",
    description: "Get the user's Beacon Safe address and status on Coston2.",
    scope: "read:safe",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_balance",
    description: "Get MockUSDT0 balance available in the Beacon Safe prepaid pool.",
    scope: "read:portfolio",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_policy",
    description: "Get MCP agent limits and Beacon app/Safe spending policy.",
    scope: "read:policy",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_portfolio",
    description: "Summarize Safe + wallet-facing portfolio fields Beacon can read.",
    scope: "read:portfolio",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_activity",
    description: "List recent MCP audit events for this authorized agent.",
    scope: "read:activity",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", minimum: 1, maximum: 50 } },
      additionalProperties: false,
    },
  },
  {
    name: "get_job",
    description: "Get an Agent Job by id (only jobs owned by this user).",
    scope: "read:jobs",
    inputSchema: {
      type: "object",
      properties: { jobId: { type: "string", minLength: 8 } },
      required: ["jobId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_execution",
    description: "Get an execution / receipt summary by id when available.",
    scope: "read:executions",
    inputSchema: {
      type: "object",
      properties: { executionId: { type: "string", minLength: 4 } },
      required: ["executionId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_signals",
    description: "Read Beacon Flow signal/research snapshot if available.",
    scope: "read:signals",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_fassets",
    description: "Read FAssets / FXRP status Beacon can report on Coston2.",
    scope: "read:fassets",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_supported_actions",
    description: "List tools this agent may use given its scopes and current policy.",
    scope: "read:policy",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "swap",
    description:
      "Execute a Beacon Safe swap within MCP + app + on-chain Safe limits. Amount is USDT0.",
    scope: "exec:swap",
    inputSchema: {
      type: "object",
      properties: {
        amountUsdt0: { type: "number", exclusiveMinimum: 0 },
        note: { type: "string", maxLength: 200 },
      },
      required: ["amountUsdt0"],
      additionalProperties: false,
    },
  },
  {
    name: "bridge",
    description: "Execute a Beacon Safe bridge action within limits (Coston2 agent bridge).",
    scope: "exec:bridge",
    inputSchema: {
      type: "object",
      properties: {
        amountUsdt0: {
          type: "number",
          exclusiveMinimum: 0,
          description: "Spend sized in USDT0 (Safe funds FXRP for the OFT send).",
        },
        destination: {
          type: "string",
          minLength: 2,
          maxLength: 40,
          description: "Live LayerZero peer chain key (e.g. base-sepolia).",
        },
        note: { type: "string", maxLength: 200 },
      },
      required: ["amountUsdt0"],
      additionalProperties: false,
    },
  },
  {
    name: "create_job",
    description: "Create an Agent Job brief (quote path). Approval still requires Beacon policy.",
    scope: "exec:job",
    inputSchema: {
      type: "object",
      properties: {
        service: { type: "string", minLength: 2, maxLength: 40 },
        brief: { type: "string", minLength: 8, maxLength: 4000 },
      },
      required: ["service", "brief"],
      additionalProperties: false,
    },
  },
  {
    name: "get_job_status",
    description: "Alias of get_job for status polling.",
    scope: "read:jobs",
    inputSchema: {
      type: "object",
      properties: { jobId: { type: "string", minLength: 8 } },
      required: ["jobId"],
      additionalProperties: false,
    },
  },
  {
    name: "x402_pay",
    description:
      "Prepare an x402 micropayment intent for Flow. Does not expose keys; user/session rails settle.",
    scope: "exec:x402",
    inputSchema: {
      type: "object",
      properties: {
        amountUsdt0: { type: "number", exclusiveMinimum: 0 },
        resource: { type: "string", maxLength: 200 },
      },
      required: ["amountUsdt0"],
      additionalProperties: false,
    },
  },
  {
    name: "fassets_redeem",
    description: "Prepare FAssets redeem info when Beacon supports it; never fabricates txs.",
    scope: "exec:fassets_redeem",
    inputSchema: {
      type: "object",
      properties: {
        lots: { type: "number", exclusiveMinimum: 0 },
      },
      additionalProperties: false,
    },
  },
];

export function toolsForGrant(grant: McpGrant): McpToolDef[] {
  return MCP_TOOL_DEFS.filter((t) => hasScope(grant.scopes, t.scope));
}

export function gateTool(
  grant: McpGrant,
  toolName: string,
  args: Record<string, unknown>,
  policy: SpendPolicySnapshot,
) {
  const def = MCP_TOOL_DEFS.find((t) => t.name === toolName);
  if (!def) {
    return {
      ok: false as const,
      code: "UNKNOWN_TOOL",
      message: `Unknown tool: ${toolName}`,
    };
  }
  const amount =
    typeof args.amountUsdt0 === "number"
      ? args.amountUsdt0
      : def.scope.startsWith("exec:")
        ? 0
        : 0;
  const authz = authorizeToolCall({
    grant,
    neededScope: def.scope,
    amountUsdt0: amount,
    policy,
  });
  if (!authz.ok) {
    return { ok: false as const, code: authz.code, message: authz.message, def };
  }
  return { ok: true as const, def, amountUsdt0: authz.amountUsdt0 };
}
