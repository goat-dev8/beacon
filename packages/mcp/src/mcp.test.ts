import { describe, expect, it } from "vitest";
import { authorizeToolCall } from "./policyGate.js";
import { filterValidScopes, hasScope } from "./scopes.js";
import {
  issueMcpAccessToken,
  verifyMcpAccessToken,
  issueMcpRefreshToken,
  verifyMcpRefreshToken,
  newGrantId,
} from "./tokens.js";
import { isGrantActive, type McpGrant } from "./grants.js";
import { gateTool } from "./tools.js";

const secret = "test-session-secret-for-mcp";

function sampleGrant(over: Partial<McpGrant> = {}): McpGrant {
  return {
    id: newGrantId(),
    wallet: "0xabc0000000000000000000000000000000000001",
    safeAddress: "0xsafe000000000000000000000000000000000001",
    clientKind: "cursor",
    clientLabel: "Cursor",
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

describe("mcp scopes", () => {
  it("filters invalid scopes", () => {
    expect(filterValidScopes(["read:safe", "hack", "exec:swap"])).toEqual([
      "read:safe",
      "exec:swap",
    ]);
  });
});

describe("mcp tokens", () => {
  it("issues and verifies access tokens", () => {
    const grantId = newGrantId();
    const { token, expiresAt } = issueMcpAccessToken({
      grantId,
      wallet: "0xAbC0000000000000000000000000000000000001",
      secret,
    });
    const v = verifyMcpAccessToken(token, secret);
    expect(v?.grantId).toBe(grantId);
    expect(v?.wallet).toBe("0xabc0000000000000000000000000000000000001");
    expect(v?.expiresAt).toBe(expiresAt);
  });

  it("rejects tampered tokens", () => {
    const { token } = issueMcpAccessToken({
      grantId: "mcp_x",
      wallet: "0xabc0000000000000000000000000000000000001",
      secret,
    });
    expect(verifyMcpAccessToken(token + "x", secret)).toBeNull();
  });

  it("refresh tokens work", () => {
    const grantId = newGrantId();
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const refresh = issueMcpRefreshToken({
      grantId,
      wallet: "0xabc0000000000000000000000000000000000001",
      secret,
      expiresAt: exp,
    });
    const v = verifyMcpRefreshToken(refresh, secret);
    expect(v?.grantId).toBe(grantId);
  });
});

describe("mcp policy gate", () => {
  const policy = {
    emergencyPause: false,
    dailySpendUsdt0: 50,
    perJobLimitUsdt0: 10,
    spentTodayUsdt0: 0,
  };

  it("allows swap within limits", () => {
    const r = authorizeToolCall({
      grant: sampleGrant(),
      neededScope: "exec:swap",
      amountUsdt0: 3,
      policy,
    });
    expect(r.ok).toBe(true);
  });

  it("rejects swap above MCP tx limit", () => {
    const r = authorizeToolCall({
      grant: sampleGrant(),
      neededScope: "exec:swap",
      amountUsdt0: 100,
      policy,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MCP_TX_LIMIT");
  });

  it("rejects missing scope", () => {
    const r = authorizeToolCall({
      grant: sampleGrant({ scopes: ["read:safe"] }),
      neededScope: "exec:swap",
      amountUsdt0: 1,
      policy,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("SCOPE_DENIED");
  });

  it("rejects paused policy", () => {
    const r = authorizeToolCall({
      grant: sampleGrant(),
      neededScope: "exec:swap",
      amountUsdt0: 1,
      policy: { ...policy, emergencyPause: true },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("SAFE_PAUSED");
  });

  it("gateTool rejects overspend", () => {
    const g = gateTool(sampleGrant(), "swap", { amountUsdt0: 100 }, policy);
    expect(g.ok).toBe(false);
  });

  it("isGrantActive respects revoke/expiry", () => {
    expect(isGrantActive(sampleGrant()).ok).toBe(true);
    expect(isGrantActive(sampleGrant({ revokedAt: new Date().toISOString() })).ok).toBe(
      false,
    );
    expect(
      isGrantActive(
        sampleGrant({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
      ).ok,
    ).toBe(false);
  });

  it("hasScope works", () => {
    expect(hasScope(["read:safe"], "read:safe")).toBe(true);
    expect(hasScope(["read:safe"], "exec:swap")).toBe(false);
  });
});
