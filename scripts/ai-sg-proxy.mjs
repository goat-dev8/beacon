/**
 * Singapore AgentRouter egress for Beacon Jobs.
 * Zero-dependency Node HTTP server so Render can start it without a monorepo build.
 *
 * AgentRouter lives in Singapore and WAF-blocks US datacenter ASNs (Vercel iad1,
 * Render Oregon) even with Claude Code headers. This process must run in
 * Render region `singapore`.
 *
 * Docs: https://agentrouter.org/docs/codex.html
 *   OPENAI_BASE_URL=https://agentrouter.org/v1
 *        https://agentrouter.org/docs/claude-code.html
 *   ANTHROPIC_BASE_URL=https://agentrouter.org  (no /v1)
 */
import http from "node:http";

const PORT = Number(process.env.PORT || 8787);
const expectedSecret = process.env.AI_PROXY_SECRET || "";

function stainlessOsArch() {
  const os =
    process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "MacOS" : "Linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return { os, arch };
}

function agentRouterHeaders(apiKey) {
  const { os, arch } = stainlessOsArch();
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "User-Agent": "claude-cli/2.1.158 (external, sdk-cli)",
    "anthropic-beta":
      "claude-code-20250219,interleaved-thinking-2025-05-14,effort-2025-11-24,redact-thinking-2026-02-12",
    "anthropic-dangerous-direct-browser-access": "true",
    "x-app": "cli",
    "X-Stainless-Lang": "js",
    "X-Stainless-OS": os,
    "X-Stainless-Arch": arch,
    "X-Stainless-Package-Version": "0.39.0",
    "X-Stainless-Runtime": "node",
    "X-Stainless-Runtime-Version": process.version,
  };
}

function looksLikeHtml(text) {
  return /^\s*</.test(text) || /<!doctype/i.test(text) || /aliyun_waf/i.test(text);
}

function isRealCompletion(status, text) {
  if (status < 200 || status >= 300) return false;
  if (looksLikeHtml(text)) return false;
  try {
    const parsed = JSON.parse(text);
    return Boolean(parsed?.choices?.[0]?.message?.content);
  } catch {
    return false;
  }
}

function hopKind(status, text) {
  if (looksLikeHtml(text)) return `html:${status}`;
  try {
    const parsed = JSON.parse(text);
    if (parsed?.choices?.[0]?.message?.content) return `json_ok:${status}`;
    if (parsed?.error) return `json_err:${status}`;
    return `json:${status}`;
  } catch {
    return `text:${status}`;
  }
}

function readSecret(req) {
  const header = req.headers["x-beacon-proxy-secret"];
  if (typeof header === "string" && header) return header;
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return "";
}

function send(res, status, body, extraHeaders = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-beacon-proxy-secret",
    ...extraHeaders,
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function handleChat(req, res) {
  if (!expectedSecret || readSecret(req) !== expectedSecret) {
    return send(res, 401, { error: "unauthorized" });
  }
  let body;
  try {
    body = JSON.parse((await readBody(req)) || "{}");
  } catch {
    return send(res, 400, { error: "invalid_json" });
  }
  if (!body || typeof body !== "object" || !body.model || !Array.isArray(body.messages)) {
    return send(res, 400, { error: "invalid_body" });
  }

  const requested = String(body.model || "gpt-5.6-sol");
  const payload = {
    model: requested,
    messages: body.messages,
    temperature: body.temperature ?? 0.2,
    max_tokens: body.max_tokens ?? body.maxTokens ?? 2048,
    stream: false,
  };

  const agentKey =
    process.env.AI_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || "";
  const pollenKey = process.env.POLLINATIONS_API_KEY || "";
  const attempts = [];

  async function tryUpstream(route, fn) {
    try {
      const upstream = await fn();
      const text = await upstream.text();
      attempts.push({
        status: upstream.status,
        text,
        route,
        kind: hopKind(upstream.status, text),
      });
      return isRealCompletion(upstream.status, text);
    } catch (err) {
      attempts.push({
        status: 503,
        text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
        route: `${route}:error`,
        kind: "error",
      });
      return false;
    }
  }

  if (agentKey) {
    await tryUpstream(`agentrouter:${requested}`, () =>
      fetch("https://agentrouter.org/v1/chat/completions", {
        method: "POST",
        headers: agentRouterHeaders(agentKey),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(90_000),
      }),
    );
  }

  if (!attempts.some((a) => isRealCompletion(a.status, a.text)) && pollenKey) {
    await tryUpstream(`pollinations:${requested}`, () =>
      fetch("https://gen.pollinations.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${pollenKey}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60_000),
      }),
    );
  }

  const winner = attempts.find((a) => isRealCompletion(a.status, a.text));
  const hopHeader = attempts.map((a) => `${a.route}:${a.kind}`).join(",");
  if (!winner) {
    return send(
      res,
      502,
      {
        error: "no_real_completion",
        hops: hopHeader,
        region: "singapore",
        hint: "AgentRouter WAF HTML or upstream quota.",
      },
      { "x-beacon-ai-hops": hopHeader },
    );
  }
  res.writeHead(winner.status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "x-beacon-model-route": winner.route,
    "x-beacon-ai-hops": hopHeader,
    "x-beacon-ai-region": "singapore",
  });
  res.end(winner.text);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (req.method === "OPTIONS") {
    return send(res, 204, "");
  }
  if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
    return send(res, 200, {
      ok: true,
      role: "agentrouter-sg-proxy",
      region: "singapore",
      version: "2026-08-14-ar-sg-proxy",
    });
  }
  if (req.method === "POST") {
    try {
      return await handleChat(req, res);
    } catch (err) {
      return send(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  }
  return send(res, 405, { error: "method_not_allowed" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`beacon-ai-sg listening on ${PORT}`);
});
