import { BEACON_MCP_INSTRUCTIONS } from "./policyGate.js";
import { toolsForGrant, type McpToolDef } from "./tools.js";
import type { McpGrant } from "./grants.js";
import { SCOPE_LABELS } from "./scopes.js";

export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  jsonrpc?: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

function ok(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function err(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

export function mcpInitializeResult(grant: McpGrant) {
  return {
    protocolVersion: "2025-03-26",
    capabilities: {
      tools: { listChanged: false },
      resources: { listChanged: false },
    },
    serverInfo: {
      name: "beacon-mcp",
      version: "0.1.0",
    },
    instructions: [
      BEACON_MCP_INSTRUCTIONS,
      "",
      `Wallet: ${grant.wallet}`,
      `Safe: ${grant.safeAddress ?? "not linked"}`,
      `Client: ${grant.clientLabel}`,
      `Scopes: ${grant.scopes.join(", ")}`,
      `Per-tx limit: ${grant.maxSpendPerTxUsdt0} USDT0`,
      `Daily limit: ${grant.dailyLimitUsdt0} USDT0`,
      `Expires: ${grant.expiresAt}`,
    ].join("\n"),
  };
}

export function mcpToolsListResult(grant: McpGrant) {
  const tools = toolsForGrant(grant).map((t: McpToolDef) => ({
    name: t.name,
    description: `${t.description} [scope: ${t.scope} — ${SCOPE_LABELS[t.scope]}]`,
    inputSchema: t.inputSchema,
  }));
  return { tools };
}

export function mcpResourcesListResult(_grant: McpGrant) {
  return {
    resources: [
      {
        uri: "beacon://instructions",
        name: "Beacon MCP instructions",
        mimeType: "text/plain",
        description: "How to use Beacon safely with this agent.",
      },
      {
        uri: "beacon://grant",
        name: "Current authorization",
        mimeType: "application/json",
        description: "Active MCP grant summary (no secrets).",
      },
    ],
  };
}

export function mcpResourceRead(grant: McpGrant, uri: string) {
  if (uri === "beacon://instructions") {
    return {
      contents: [
        {
          uri,
          mimeType: "text/plain",
          text: BEACON_MCP_INSTRUCTIONS,
        },
      ],
    };
  }
  if (uri === "beacon://grant") {
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              grantId: grant.id,
              wallet: grant.wallet,
              safeAddress: grant.safeAddress,
              clientKind: grant.clientKind,
              scopes: grant.scopes,
              maxSpendPerTxUsdt0: grant.maxSpendPerTxUsdt0,
              dailyLimitUsdt0: grant.dailyLimitUsdt0,
              expiresAt: grant.expiresAt,
              revoked: Boolean(grant.revokedAt),
            },
            null,
            2,
          ),
        },
      ],
    };
  }
  return null;
}

export function handleMcpJsonRpc(
  body: JsonRpcRequest,
  grant: McpGrant,
  callTool: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>,
): Promise<JsonRpcResponse> | JsonRpcResponse {
  const id = (body.id ?? null) as JsonRpcId;
  const method = body.method;

  if (method === "initialize") {
    return ok(id, mcpInitializeResult(grant));
  }
  if (method === "notifications/initialized" || method === "initialized") {
    return ok(id, {});
  }
  if (method === "ping") {
    return ok(id, {});
  }
  if (method === "tools/list") {
    return ok(id, mcpToolsListResult(grant));
  }
  if (method === "resources/list") {
    return ok(id, mcpResourcesListResult(grant));
  }
  if (method === "resources/read") {
    const uri =
      typeof body.params === "object" &&
      body.params &&
      "uri" in body.params &&
      typeof (body.params as { uri: unknown }).uri === "string"
        ? (body.params as { uri: string }).uri
        : "";
    const result = mcpResourceRead(grant, uri);
    if (!result) return err(id, -32002, `Unknown resource: ${uri}`);
    return ok(id, result);
  }
  if (method === "tools/call") {
    const params = (body.params ?? {}) as {
      name?: string;
      arguments?: Record<string, unknown>;
    };
    if (!params.name) return err(id, -32602, "tools/call requires name");
    return callTool(params.name, params.arguments ?? {}).then((result) => ok(id, result));
  }

  return err(id, -32601, `Method not found: ${method}`);
}

export { ok as jsonRpcOk, err as jsonRpcErr };
