/**
 * Production AI proxy — Vercel Node.js serverless (NOT Edge).
 * AgentRouter/Aliyun WAF blocks many cloud Edge/Oregon ASNs (HTTP 405 + zh-cn HTML).
 * Node.js serverless in Singapore (`sin1`) matches AgentRouter's primary region.
 *
 * Auth: x-beacon-proxy-secret or Authorization Bearer <AI_PROXY_SECRET>
 * Never expose AI_API_KEY to the browser.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = {
  runtime: "nodejs",
  regions: ["sin1"],
  maxDuration: 60,
};

function buildAgentRouterHeaders(apiKey: string): Record<string, string> {
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
    "X-Stainless-Package-Version": "0.39.0",
    "X-Stainless-OS": "linux",
    "X-Stainless-Arch": "x64",
    "X-Stainless-Runtime": "node",
    "X-Stainless-Runtime-Version": process.version,
  };
}

function normalizeOpenAiBase(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  if (trimmed.endsWith("/v1")) return trimmed;
  return `${trimmed}/v1`;
}

function readSecret(req: VercelRequest): string {
  const header = req.headers["x-beacon-proxy-secret"];
  if (typeof header === "string" && header) return header;
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return "";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-beacon-proxy-secret",
  );

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const expected = process.env.AI_PROXY_SECRET || "";
  const provided = readSecret(req);
  if (!expected || provided !== expected) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const apiKey =
    process.env.AI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    "";
  if (!apiKey) {
    return res.status(503).json({ error: "ai_key_missing" });
  }

  const baseUrl = normalizeOpenAiBase(
    process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || "https://agentrouter.org/v1",
  );

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  if (!body || typeof body !== "object" || !body.model || !Array.isArray(body.messages)) {
    return res.status(400).json({ error: "invalid_body" });
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
    signal: AbortSignal.timeout(55_000),
  });

  const text = await upstream.text();
  const looksHtml = /^\s*</.test(text) || /<!doctype/i.test(text) || /aliyun_waf/i.test(text);
  if (looksHtml) {
    return res.status(502).json({
      error: "upstream_waf_blocked",
      status: upstream.status,
      region: "sin1",
      hint: "AgentRouter WAF rejected this egress ASN",
    });
  }

  res.status(upstream.status);
  res.setHeader(
    "Content-Type",
    upstream.headers.get("content-type") || "application/json; charset=utf-8",
  );
  return res.send(text);
}
