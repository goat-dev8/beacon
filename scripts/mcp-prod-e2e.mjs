/**
 * Production Beacon MCP E2E (no secrets printed).
 * Uses DEPLOYER_PRIVATE_KEY for Safe-session unlock of that wallet only.
 */
import fs from "fs";
import { Wallet } from "ethers";

const env = Object.fromEntries(
  fs
    .readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const API = "https://beacon-api-97gl.onrender.com";
const wallet = new Wallet(env.DEPLOYER_PRIVATE_KEY);
const short = `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`;
console.log("wallet", short);

const ch = await (
  await fetch(`${API}/v1/auth/safe-session/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet: wallet.address }),
  })
).json();
if (!ch.ok) throw new Error(`challenge_fail ${JSON.stringify(ch)}`);
const signature = await wallet.signMessage(ch.message);
const sess = await (
  await fetch(`${API}/v1/auth/safe-session/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      wallet: wallet.address,
      message: ch.message,
      signature,
    }),
  })
).json();
if (!sess.ok) throw new Error(`session_fail ${JSON.stringify(sess)}`);
console.log("PASS session");

const grantRes = await fetch(`${API}/v1/mcp/grants`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${sess.token}`,
  },
  body: JSON.stringify({
    wallet: wallet.address,
    clientKind: "generic",
    clientLabel: "E2E MCP",
    scopes: [
      "read:safe",
      "read:policy",
      "read:portfolio",
      "read:activity",
      "exec:swap",
    ],
    maxSpendPerTxUsdt0: 5,
    dailyLimitUsdt0: 20,
    ttlHours: 2,
  }),
});
const grant = await grantRes.json();
if (!grant.ok) throw new Error(`grant_fail ${grantRes.status} ${JSON.stringify(grant)}`);
console.log(
  "PASS grant",
  grant.grant.id,
  "safe",
  grant.grant.safeAddress ? `${grant.grant.safeAddress.slice(0, 8)}…` : "none",
);
const token = grant.accessToken;

async function mcp(method, params) {
  const res = await fetch(`${API}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return { status: res.status, body: await res.json() };
}

const list = await mcp("tools/list");
const tools = list.body?.result?.tools?.map((t) => t.name) || [];
console.log("PASS tools_list", tools.join(","));

const safe = await mcp("tools/call", { name: "get_safe", arguments: {} });
const safeText = safe.body?.result?.content?.[0]?.text || "";
const safeOk = safeText.includes('"ok": true') || safeText.includes('"ok":true');
console.log(safeOk ? "PASS" : "FAIL", "get_safe");

const pol = await mcp("tools/call", { name: "get_policy", arguments: {} });
const polText = pol.body?.result?.content?.[0]?.text || "";
console.log(
  polText.includes("maxSpendPerTxUsdt0") ? "PASS" : "FAIL",
  "get_policy",
);

const over = await mcp("tools/call", { name: "swap", arguments: { amountUsdt0: 100 } });
const overText = over.body?.result?.content?.[0]?.text || JSON.stringify(over.body);
const overOk =
  over.body?.result?.isError === true || overText.includes("MCP_TX_LIMIT");
console.log(overOk ? "PASS" : "FAIL", "overspend_reject", overText.slice(0, 140));

const bridge = await mcp("tools/call", { name: "bridge", arguments: { amountUsdt0: 1 } });
const bridgeText = bridge.body?.result?.content?.[0]?.text || "";
const bridgeOk =
  bridgeText.includes("SCOPE_DENIED") || bridge.body?.result?.isError === true;
console.log(bridgeOk ? "PASS" : "FAIL", "disallowed_bridge", bridgeText.slice(0, 120));

const test = await (
  await fetch(`${API}/v1/mcp/test`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  })
).json();
console.log(
  test.ok ? "PASS" : "FAIL",
  "test_connection",
  test.message,
  "actions",
  (test.availableActions || []).length,
);

const swap = await mcp("tools/call", { name: "swap", arguments: { amountUsdt0: 0.5 } });
const swapText = swap.body?.result?.content?.[0]?.text || "";
let swapParsed = {};
try {
  swapParsed = JSON.parse(swapText);
} catch {
  /* ignore */
}
console.log(
  "INFO swap_0.5",
  swapParsed.ok === true
    ? `ok tx=${swapParsed.txHash || swapParsed.result?.spendHash || "?"}`
    : `rejected/failed: ${(swapParsed.message || swapParsed.error || swapText).slice(0, 180)}`,
);

const rev = await (
  await fetch(`${API}/v1/mcp/grants/${grant.grant.id}/revoke`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sess.token}`,
    },
    body: JSON.stringify({ wallet: wallet.address }),
  })
).json();
console.log(rev.ok ? "PASS" : "FAIL", "revoke");

const after = await mcp("tools/list");
const revokedOk = after.status === 401;
console.log(
  revokedOk ? "PASS" : "FAIL",
  "post_revoke_401",
  after.status,
  JSON.stringify(after.body).slice(0, 160),
);
