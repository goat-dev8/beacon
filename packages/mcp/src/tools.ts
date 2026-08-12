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
    description: "Get Coston2 USDT0 balance available in the Beacon Safe prepaid pool.",
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
    description: "Portfolio desk: Safe + wallet balances / exposure Beacon can read on Coston2.",
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
    description: "FTSO / market signals Beacon uses before trades (Flow Signals rail).",
    scope: "read:signals",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_fassets",
    description: "FAssets / FXRP desk status on Coston2 (mint is docs handoff; redeem prepare is real).",
    scope: "read:fassets",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_yield",
    description: "Yield / vault desk paths Beacon surfaces on Coston2 (Flow Yield rail).",
    scope: "read:portfolio",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_bridge_routes",
    description:
      "List live LayerZero OFT peer destinations for FXRP from Coston2 (e.g. Sepolia, Base Sepolia).",
    scope: "read:portfolio",
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
      "Beacon Safe swap on Coston2: spend USDT0 from Safe → FXRP via swap desk (no MetaMask). Same as Flow Swap. amountUsdt0 is Coston2 faucet USDT0 in.",
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
    description:
      "Beacon Agent OFT bridge (Flow Bridge): send FXRP from Coston2 to a live LayerZero peer. Destination is the peer chain name (e.g. Sepolia). Policy spend is evaluated on Coston2; Sepolia does NOT need to be in allowedChains. May auto top-up FXRP from Safe USDT0.",
    scope: "exec:bridge",
    inputSchema: {
      type: "object",
      properties: {
        amountFxrp: {
          type: "number",
          exclusiveMinimum: 0,
          description: "FXRP amount to bridge (Coston2 → destination).",
        },
        amountUsdt0: {
          type: "number",
          exclusiveMinimum: 0,
          description: "Optional alias; treated as FXRP amount if amountFxrp omitted.",
        },
        destination: {
          type: "string",
          minLength: 2,
          maxLength: 40,
          description: 'Live peer name from get_bridge_routes (default "Sepolia").',
        },
        note: { type: "string", maxLength: 200 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "create_job",
    description:
      "Create an Agent Job on Beacon Jobs desk (quote path). Same services as /flow/desk.",
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
      "Fetch x402 payment requirements for a Flow paid resource (returns 402 fields). Settlement still needs owner USDT0 approve in Flow when required.",
    scope: "exec:x402",
    inputSchema: {
      type: "object",
      properties: {
        amountUsdt0: { type: "number", exclusiveMinimum: 0 },
        resource: {
          type: "string",
          maxLength: 200,
          description: "Resource id/path e.g. research, image-logo, ftso-pack",
        },
      },
      required: ["amountUsdt0"],
      additionalProperties: false,
    },
  },
  {
    name: "fassets_redeem",
    description:
      "Prepare FAssets FXRP redeem calldata/lots on Coston2 (Flow FAssets rail). Does not invent COMPLETED without on-chain evidence.",
    scope: "exec:fassets_redeem",
    inputSchema: {
      type: "object",
      properties: {
        lots: { type: "number", exclusiveMinimum: 0 },
        underlyingAddress: {
          type: "string",
          description: "XRPL classic address (r…) required to prepare redeem calldata.",
        },
      },
      additionalProperties: false,
    },
  },
];

export function toolsForGrant(grant: McpGrant): McpToolDef[] {
  return MCP_TOOL_DEFS.filter((t) => hasScope(grant.scopes, t.scope));
}

export function spendAmountFromArgs(args: Record<string, unknown>): number {
  if (typeof args.amountUsdt0 === "number" && Number.isFinite(args.amountUsdt0)) {
    return args.amountUsdt0;
  }
  if (typeof args.amountFxrp === "number" && Number.isFinite(args.amountFxrp)) {
    return args.amountFxrp;
  }
  return 0;
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
  const amount = spendAmountFromArgs(args);
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
