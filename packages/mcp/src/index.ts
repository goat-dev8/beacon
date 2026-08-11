export * from "./scopes.js";
export * from "./tokens.js";
export * from "./grants.js";
export * from "./policyGate.js";
export * from "./tools.js";
export * from "./protocol.js";

export function buildSetupPrompt(opts: {
  apiBase: string;
  webBase: string;
  grantId: string;
  wallet: string;
  scopes: string[];
  maxSpendPerTxUsdt0: number;
  dailyLimitUsdt0: number;
  expiresAt: string;
}): string {
  return [
    "You are helping me use Beacon via Beacon MCP.",
    "",
    "Beacon is a Flare AI OS: intent → quote → policy → pay → execute → explorer receipt.",
    "My agent never receives my private key. Beacon Safe policy is the final spend boundary.",
    "",
    "Connection details (no secrets in this prompt):",
    `- MCP endpoint: ${opts.apiBase.replace(/\/$/, "")}/mcp`,
    `- Connect Agents page: ${opts.webBase.replace(/\/$/, "")}/mcp`,
    `- Grant id: ${opts.grantId}`,
    `- Wallet: ${opts.wallet}`,
    `- Scopes: ${opts.scopes.join(", ")}`,
    `- Per-tx limit: ${opts.maxSpendPerTxUsdt0} USDT0`,
    `- Daily limit: ${opts.dailyLimitUsdt0} USDT0`,
    `- Expires: ${opts.expiresAt}`,
    "",
    "Please:",
    "1) Confirm you can reach Beacon MCP tools (list tools).",
    "2) Call get_safe and get_policy.",
    "3) Summarize what you can and cannot do.",
    "4) Never exceed policy; if a tool rejects a spend, explain why.",
    "5) When setup looks good, reply exactly with a short status block:",
    "Beacon connected.",
    "Safe: …",
    "Permissions: …",
    "Per-transaction limit: …",
    "Daily limit: …",
    "Available actions: …",
  ].join("\n");
}

export function buildCursorMcpConfig(opts: {
  apiBase: string;
  accessToken: string;
}): string {
  const url = `${opts.apiBase.replace(/\/$/, "")}/mcp`;
  return JSON.stringify(
    {
      mcpServers: {
        beacon: {
          url,
          headers: {
            Authorization: `Bearer ${opts.accessToken}`,
          },
        },
      },
    },
    null,
    2,
  );
}
