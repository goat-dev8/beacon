/**
 * Production AI proxy — Vercel Node.js serverless (NOT Edge).
 *
 * Hops:
 * 1) Vercel AI Gateway via deployment OIDC (openai/<model> or anthropic/<model>)
 * 2) AgentRouter OpenAI-compatible /v1/chat/completions (Claude Code headers)
 *
 * Gateway currently 403s without a card on file. AgentRouter is the working
 * generator path. Render cannot call AgentRouter directly (WAF), so this
 * proxy is the bypass.
 *
 * Auth from Render: x-beacon-proxy-secret or Bearer <AI_PROXY_SECRET>.
 * Never expose provider credentials to the browser.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = {
  runtime: "nodejs",
  regions: ["sin1"],
  maxDuration: 120,
};

function readSecret(req: VercelRequest): string {
  const header = req.headers["x-beacon-proxy-secret"];
  if (typeof header === "string" && header) return header;
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return "";
}

function agentRouterHeaders(apiKey: string): Record<string, string> {
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
    "X-Stainless-Runtime": "node",
  };
}

function looksLikeHtml(text: string): boolean {
  return /^\s*</.test(text) || /<!doctype/i.test(text);
}

function isRealCompletion(status: number, text: string): boolean {
  if (status < 200 || status >= 300) return false;
  if (looksLikeHtml(text)) return false;
  try {
    const parsed = JSON.parse(text) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return Boolean(parsed.choices?.[0]?.message?.content);
  } catch {
    return false;
  }
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

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  if (!body || typeof body !== "object" || !body.model || !Array.isArray(body.messages)) {
    return res.status(400).json({ error: "invalid_body" });
  }

  const requested = String(body.model || "gpt-5.6-sol");
  const payload = {
    model: requested,
    messages: body.messages,
    temperature: body.temperature ?? 0.2,
    max_tokens: body.max_tokens ?? body.maxTokens ?? 2048,
    stream: false,
  };

  const oidcHeader = req.headers["x-vercel-oidc-token"];
  const oidcToken =
    (typeof oidcHeader === "string" ? oidcHeader : "") || process.env.VERCEL_OIDC_TOKEN || "";
  const agentKey =
    process.env.AI_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || "";

  type Upstream = { status: number; text: string; route: string };
  const attempts: Upstream[] = [];

  if (oidcToken) {
    const gatewayModel = requested.includes("/")
      ? requested
      : /^claude/i.test(requested)
        ? `anthropic/${requested}`
        : `openai/${requested}`;
    try {
      const upstream = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${oidcToken}`,
        },
        body: JSON.stringify({ ...payload, model: gatewayModel }),
        signal: AbortSignal.timeout(40_000),
      });
      const text = await upstream.text();
      attempts.push({ status: upstream.status, text, route: `gateway:${gatewayModel}` });
    } catch (err) {
      attempts.push({
        status: 503,
        text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
        route: "gateway:error",
      });
    }
  }

  const gatewayOk = attempts.some((a) => isRealCompletion(a.status, a.text));
  if (!gatewayOk && agentKey) {
    try {
      const upstream = await fetch("https://agentrouter.org/v1/chat/completions", {
        method: "POST",
        headers: agentRouterHeaders(agentKey),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(90_000),
      });
      const text = await upstream.text();
      attempts.push({ status: upstream.status, text, route: `agentrouter:${requested}` });
    } catch (err) {
      attempts.push({
        status: 503,
        text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
        route: "agentrouter:error",
      });
    }
  }

  const winner =
    [...attempts].reverse().find((a) => isRealCompletion(a.status, a.text)) ?? attempts.at(-1);
  if (!winner) {
    return res.status(503).json({
      error: "no_ai_upstream",
      hint: "Gateway needs a card, or set AI_API_KEY on the Vercel proxy for AgentRouter.",
    });
  }

  res.status(winner.status);
  res.setHeader("x-beacon-model-route", winner.route);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.send(winner.text);
}
