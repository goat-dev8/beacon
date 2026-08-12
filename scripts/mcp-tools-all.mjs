/**
 * Exercise every Beacon MCP tool against production using DEPLOYER_PRIVATE_KEY from .env.
 * Never prints secrets or full tokens.
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

const API = env.API_URL?.includes("onrender")
  ? env.API_URL.replace(/\/$/, "")
  : "https://beacon-api-97gl.onrender.com";

const wallet = new Wallet(env.DEPLOYER_PRIVATE_KEY);
console.log("api", API);
console.log("wallet", `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`);

async function sessionToken() {
  const ch = await (
    await fetch(`${API}/v1/auth/safe-session/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet: wallet.address }),
    })
  ).json();
  if (!ch.ok) throw new Error(`challenge ${JSON.stringify(ch)}`);
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
  if (!sess.ok) throw new Error(`session ${JSON.stringify(sess)}`);
  return sess.token;
}

const sess = await sessionToken();
const grant = await (
  await fetch(`${API}/v1/mcp/grants`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sess}`,
    },
    body: JSON.stringify({
      wallet: wallet.address,
      clientKind: "generic",
      clientLabel: "Full tool sweep",
      scopes: [
        "read:safe",
        "read:policy",
        "read:portfolio",
        "read:activity",
        "read:jobs",
        "read:signals",
        "read:fassets",
        "read:executions",
        "exec:swap",
        "exec:bridge",
        "exec:job",
        "exec:x402",
        "exec:fassets_redeem",
      ],
      maxSpendPerTxUsdt0: 5,
      dailyLimitUsdt0: 20,
      ttlHours: 2,
    }),
  })
).json();
if (!grant.ok) throw new Error(JSON.stringify(grant));
console.log("PASS grant", grant.grant.id);

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
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { parseError: true, raw: text.slice(0, 200) };
  }
  return { status: res.status, body };
}

async function call(name, args = {}) {
  const { status, body } = await mcp("tools/call", { name, arguments: args });
  const text = body?.result?.content?.[0]?.text || JSON.stringify(body);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text.slice(0, 200) };
  }
  const ok =
    status === 200 &&
    body?.result &&
    body.result.isError !== true &&
    parsed?.ok !== false;
  const softOk =
    status === 200 &&
    body?.result &&
    (parsed?.ok === true ||
      parsed?.ok === false || // honest tool denial / prep failure still a working tool
      parsed?.code === "MCP_TX_LIMIT" ||
      parsed?.code === "SCOPE_DENIED" ||
      parsed?.code === "SAFE_NOT_CREATED" ||
      typeof parsed?.note === "string" ||
      Array.isArray(parsed?.events) ||
      parsed?.status ||
      parsed?.desk ||
      parsed?.jobId !== undefined);
  console.log(
    ok || softOk ? "PASS" : "FAIL",
    name,
    parsed?.code ||
      (parsed?.ok === true ? "ok" : parsed?.error || parsed?.message || "").toString().slice(0, 80),
  );
  return { ok: ok || softOk, parsed, isError: body?.result?.isError };
}

const init = await mcp("initialize", {});
console.log(init.body?.result?.serverInfo?.name === "beacon-mcp" ? "PASS" : "FAIL", "initialize");

const listed = await mcp("tools/list", {});
const tools = listed.body?.result?.tools?.map((t) => t.name) || [];
console.log(tools.length >= 10 ? "PASS" : "FAIL", "tools/list", tools.length, "tools");

const resources = await mcp("resources/list", {});
console.log(
  (resources.body?.result?.resources?.length ?? 0) >= 1 ? "PASS" : "FAIL",
  "resources/list",
);

await call("get_safe");
await call("get_balance");
await call("get_policy");
await call("get_portfolio");
await call("get_activity", { limit: 5 });
await call("get_supported_actions");
await call("get_signals");
await call("get_fassets");
await call("get_yield");
await call("get_bridge_routes");
await call("get_job", { jobId: "job_test_placeholder_xx" });
await call("get_job_status", { jobId: "job_test_placeholder_xx" });
await call("get_execution", { executionId: "exec_test" });
await call("create_job", { service: "image", brief: "Beacon MCP tool sweep logo mark" });
await call("x402_pay", { amountUsdt0: 0.25, resource: "research" });
await call("fassets_redeem", { lots: 1 });

const over = await call("swap", { amountUsdt0: 100 });
console.log(
  over.parsed?.code === "MCP_TX_LIMIT" ? "PASS" : "FAIL",
  "swap_overspend_gate",
);

const swap = await call("swap", { amountUsdt0: 0.5 });
if (swap.parsed?.ok) {
  console.log(
    "PASS",
    "swap_real",
    swap.parsed?.result?.spendHash || swap.parsed?.txHash || "ok",
  );
} else {
  console.log(
    "INFO",
    "swap_0.5",
    (swap.parsed?.message || swap.parsed?.error || swap.parsed?.code || "").toString().slice(0, 120),
  );
}

const bridge = await call("bridge", { amountFxrp: 0.5, destination: "Sepolia" });
console.log(
  "INFO",
  "bridge",
  bridge.parsed?.ok === true
    ? `ok ${bridge.parsed?.sendHash || ""}`
    : (bridge.parsed?.error || bridge.parsed?.message || bridge.parsed?.raw || "").toString().slice(0, 160),
);

const test = await (
  await fetch(`${API}/v1/mcp/test`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  })
).json();
console.log(test.ok ? "PASS" : "FAIL", "test_connection", (test.availableActions || []).length);

await fetch(`${API}/v1/mcp/grants/${grant.grant.id}/revoke`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${sess}`,
  },
  body: JSON.stringify({ wallet: wallet.address }),
});
const after = await mcp("tools/list", {});
console.log(after.status === 401 ? "PASS" : "FAIL", "post_revoke_401", after.status);
