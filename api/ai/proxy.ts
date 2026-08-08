/**
 * Production AI proxy — Vercel Node.js serverless (NOT Edge).
 *
 * Primary: Vercel AI Gateway via deployment OIDC (no static model key).
 * Model: openai/gpt-5.6-sol.
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

  const oidcHeader = req.headers["x-vercel-oidc-token"];
  const oidcToken =
    (typeof oidcHeader === "string" ? oidcHeader : "") ||
    process.env.VERCEL_OIDC_TOKEN ||
    "";
  if (!oidcToken) {
    return res.status(503).json({
      error: "vercel_oidc_missing",
      hint: "Redeploy the Vercel project so the function receives deployment OIDC.",
    });
  }

  const requested = String(body.model || "gpt-5.6-sol");
  const gatewayModel = requested.includes("/") ? requested : `openai/${requested}`;
  const upstream = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${oidcToken}`,
    },
    body: JSON.stringify({
      model: gatewayModel,
      messages: body.messages,
      temperature: body.temperature ?? 0.2,
      max_tokens: body.max_tokens ?? body.maxTokens ?? 2048,
      stream: false,
    }),
    signal: AbortSignal.timeout(110_000),
  });

  const text = await upstream.text();
  const looksHtml = /^\s*</.test(text) || /<!doctype/i.test(text);
  if (looksHtml) {
    return res.status(502).json({
      error: "gateway_html_error",
      status: upstream.status,
      region: "sin1",
      hint: "Vercel AI Gateway returned a non-JSON response.",
    });
  }

  res.status(upstream.status);
  res.setHeader("x-beacon-model-route", gatewayModel);
  res.setHeader(
    "Content-Type",
    upstream.headers.get("content-type") || "application/json; charset=utf-8",
  );
  return res.send(text);
}
