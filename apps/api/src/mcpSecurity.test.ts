/**
 * Beacon MCP security regression checks (unit-style against policy gate + tokens).
 * Run: npx vitest run apps/api/src/mcpSecurity.test.ts
 */
import { describe, expect, it } from "vitest";
import {
  authorizeToolCall,
  gateTool,
  issueMcpAccessToken,
  verifyMcpAccessToken,
  isGrantActive,
  type McpGrant,
  newGrantId,
} from "@beacon/mcp";

const secret = "mcp-security-test-secret";

function grant(over: Partial<McpGrant> = {}): McpGrant {
  return {
    id: newGrantId(),
    wallet: "0xabc0000000000000000000000000000000000001",
    safeAddress: "0xsafe000000000000000000000000000000000001",
    clientKind: "generic",
    clientLabel: "Test",
    scopes: ["read:safe", "read:policy", "exec:swap"],
    maxSpendPerTxUsdt0: 5,
    dailyLimitUsdt0: 20,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    revokedAt: null,
    refreshTokenHash: null,
    ...over,
  };
}

const policyOk = {
  emergencyPause: false,
  dailySpendUsdt0: 50,
  perJobLimitUsdt0: 10,
  spentTodayUsdt0: 0,
};

describe("mcp security boundaries", () => {
  it("rejects expired access tokens", () => {
    const { token } = issueMcpAccessToken({
      grantId: "mcp_x",
      wallet: "0xabc0000000000000000000000000000000000001",
      secret,
      ttlSeconds: 1,
      nowSeconds: 1_700_000_000,
    });
    expect(verifyMcpAccessToken(token, secret, 1_700_000_000 + 120)).toBeNull();
  });

  it("rejects malformed tokens", () => {
    expect(verifyMcpAccessToken("not.a.token", secret)).toBeNull();
    expect(verifyMcpAccessToken("", secret)).toBeNull();
  });

  it("rejects revoked grants", () => {
    const g = grant({ revokedAt: new Date().toISOString() });
    expect(isGrantActive(g).ok).toBe(false);
  });

  it("rejects expired grants", () => {
    const g = grant({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect(isGrantActive(g).ok).toBe(false);
  });

  it("rejects swap above MCP per-tx limit", () => {
    const gated = gateTool(grant(), "swap", { amountUsdt0: 100 }, policyOk);
    expect(gated.ok).toBe(false);
    if (!gated.ok) expect(gated.code).toBe("MCP_TX_LIMIT");
  });

  it("rejects exec without scope (privilege escalation)", () => {
    const g = grant({ scopes: ["read:safe", "read:policy"] });
    const gated = gateTool(g, "swap", { amountUsdt0: 1 }, policyOk);
    expect(gated.ok).toBe(false);
    if (!gated.ok) expect(gated.code).toBe("SCOPE_DENIED");
  });

  it("rejects when emergency pause is on", () => {
    const authz = authorizeToolCall({
      grant: grant(),
      neededScope: "exec:swap",
      amountUsdt0: 1,
      policy: { ...policyOk, emergencyPause: true },
    });
    expect(authz.ok).toBe(false);
    if (!authz.ok) expect(authz.code).toBe("SAFE_PAUSED");
  });

  it("rejects above app daily remaining", () => {
    const authz = authorizeToolCall({
      grant: grant(),
      neededScope: "exec:swap",
      amountUsdt0: 5,
      policy: { ...policyOk, dailySpendUsdt0: 10, spentTodayUsdt0: 8 },
    });
    expect(authz.ok).toBe(false);
    if (!authz.ok) expect(authz.code).toBe("APP_DAILY_LIMIT");
  });

  it("allows in-limit swap", () => {
    const gated = gateTool(grant(), "swap", { amountUsdt0: 2 }, policyOk);
    expect(gated.ok).toBe(true);
  });
});
