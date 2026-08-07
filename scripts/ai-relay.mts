/**
 * Local AgentRouter relay — residential egress + Claude Code wire headers.
 * Cloud hosts (Render/Vercel) hit Aliyun WAF 405/challenge; this box works.
 *
 * Usage:
 *   npx tsx scripts/ai-relay.mts
 *   cloudflared tunnel --url http://127.0.0.1:8787
 * Then set Render AI_PROXY_URL to https://<tunnel>/v1/chat/completions
 * and AI_PROXY_SECRET to the same secret the relay expects.
 */
import "dotenv/config";
import http from "node:http";
import { loadEnv } from "../packages/shared/src/env.ts";
import {
  buildAgentRouterHeaders,
  resolveAiApiKey,
  resolveAiBaseUrl,
} from "../packages/shared/src/ai.ts";

const PORT = Number(process.env.AI_RELAY_PORT || 8787);
const env = loadEnv();
const apiKey = resolveAiApiKey(env);
const baseUrl = resolveAiBaseUrl(env);
const secret = process.env.AI_PROXY_SECRET || process.env.AI_RELAY_SECRET || "";

if (!apiKey) {
  console.error("AI_API_KEY missing");
  process.exit(1);
}
if (!secret) {
  console.error("AI_PROXY_SECRET (or AI_RELAY_SECRET) missing");
  process.exit(1);
}

function readSecret(req: http.IncomingMessage): string {
  const h = req.headers["x-beacon-proxy-secret"];
  if (typeof h === "string" && h) return h;
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return "";
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-beacon-proxy-secret");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && (req.url === "/health" || req.url === "/")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, role: "beacon-ai-relay", baseUrl }));
    return;
  }

  const path = (req.url || "").split("?")[0];
  const isChat =
    req.method === "POST" &&
    (path === "/" ||
      path === "/v1/chat/completions" ||
      path === "/api/ai/proxy" ||
      path === "/proxy");

  if (!isChat) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  if (readSecret(req) !== secret) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }

  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw.toString("utf8") || "{}") as {
      model?: string;
      messages?: unknown;
      temperature?: number;
      max_tokens?: number;
      maxTokens?: number;
    };
    if (!body.model || !Array.isArray(body.messages)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_body" }));
      return;
    }

    const upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: buildAgentRouterHeaders(apiKey),
      body: JSON.stringify({
        model: body.model,
        messages: body.messages,
        temperature: body.temperature ?? 0.2,
        max_tokens: body.max_tokens ?? body.maxTokens ?? 2048,
        stream: false,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await upstream.text();
    const looksHtml = /^\s*</.test(text) || /<!doctype/i.test(text);
    if (looksHtml) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "upstream_waf_html", status: upstream.status }));
      return;
    }
    res.writeHead(upstream.status, {
      "Content-Type": upstream.headers.get("content-type") || "application/json",
    });
    res.end(text);
  } catch (err) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "relay_failed",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`beacon-ai-relay listening on http://127.0.0.1:${PORT}`);
  console.log(`forward → ${baseUrl}/chat/completions`);
});
