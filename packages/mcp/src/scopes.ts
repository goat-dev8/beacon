/** MCP permission scopes — server-enforced; models never decide allow/deny. */

export const MCP_READ_SCOPES = [
  "read:safe",
  "read:policy",
  "read:portfolio",
  "read:activity",
  "read:jobs",
  "read:signals",
  "read:fassets",
  "read:executions",
] as const;

export const MCP_EXEC_SCOPES = [
  "exec:swap",
  "exec:bridge",
  "exec:job",
  "exec:x402",
  "exec:fassets_redeem",
] as const;

export const MCP_ALL_SCOPES = [...MCP_READ_SCOPES, ...MCP_EXEC_SCOPES] as const;

export type McpScope = (typeof MCP_ALL_SCOPES)[number];

export const SCOPE_LABELS: Record<McpScope, string> = {
  "read:safe": "View your Beacon Safe",
  "read:policy": "View spending limits",
  "read:portfolio": "View balances / portfolio",
  "read:activity": "View recent activity",
  "read:jobs": "View Agent Jobs",
  "read:signals": "View market signals",
  "read:fassets": "View FAssets status",
  "read:executions": "View execution receipts",
  "exec:swap": "Run Safe swaps within limits",
  "exec:bridge": "Run Safe bridges within limits",
  "exec:job": "Start / approve Agent Jobs within limits",
  "exec:x402": "Pay Flow micropays within limits",
  "exec:fassets_redeem": "Prepare FAssets redeem (when available)",
};

export const DEFAULT_CONNECT_SCOPES: McpScope[] = [
  "read:safe",
  "read:policy",
  "read:portfolio",
  "read:activity",
  "read:jobs",
  "read:fassets",
  "read:executions",
  "exec:swap",
];

export function isMcpScope(value: string): value is McpScope {
  return (MCP_ALL_SCOPES as readonly string[]).includes(value);
}

export function hasScope(granted: readonly string[], needed: McpScope): boolean {
  return granted.includes(needed);
}

export function filterValidScopes(input: unknown): McpScope[] {
  if (!Array.isArray(input)) return [];
  const out: McpScope[] = [];
  for (const item of input) {
    if (typeof item === "string" && isMcpScope(item) && !out.includes(item)) {
      out.push(item);
    }
  }
  return out;
}
