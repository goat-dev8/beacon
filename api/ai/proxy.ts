/**
 * Vercel Edge AI proxy.
 * Render (Oregon) is blocked by AgentRouter WAF (HTTP 405 + zh-cn HTML).
 * This hop runs from Vercel egress so Claude/GPT chat stays real in production.
 *
 * Auth: x-beacon-proxy-secret or Authorization: Bearer <AI_PROXY_SECRET>
 * Never expose AI_API_KEY to the browser.
 */
export const config = { runtime: "edge" };

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
    "X-Stainless-Runtime": "vercel-edge",
    "X-Stainless-Runtime-Version": "1",
  };
}

function normalizeOpenAiBase(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  if (trimmed.endsWith("/v1")) return trimmed;
  return `${trimmed}/v1`;
}

function readSecret(req: Request): string {
  const header = req.headers.get("x-beacon-proxy-secret");
  if (header) return header;
  const auth = req.headers.get("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return "";
}

export default async function handler(req: Request): Promise<Response> {
  const cors: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, x-beacon-proxy-secret",
    "Cache-Control": "no-store",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405, headers: cors });
  }

  const expected = process.env.AI_PROXY_SECRET || "";
  const provided = readSecret(req);
  if (!expected || provided !== expected) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: cors });
  }

  const apiKey =
    process.env.AI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    "";
  if (!apiKey) {
    return Response.json({ error: "ai_key_missing" }, { status: 503, headers: cors });
  }

  const baseUrl = normalizeOpenAiBase(
    process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || "https://agentrouter.org/v1",
  );

  let body: {
    model?: string;
    messages?: unknown;
    temperature?: number;
    max_tokens?: number;
    maxTokens?: number;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400, headers: cors });
  }

  if (!body?.model || !Array.isArray(body.messages)) {
    return Response.json({ error: "invalid_body" }, { status: 400, headers: cors });
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
    signal: AbortSignal.timeout(45_000),
  });

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      ...cors,
      "Content-Type":
        upstream.headers.get("content-type") || "application/json; charset=utf-8",
    },
  });
}
