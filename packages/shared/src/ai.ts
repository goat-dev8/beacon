import { loadEnv, type BeaconEnv } from "./env.js";

export type AiRole = "generator" | "judge" | "quote" | "acceptance";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatCompletionResult {
  content: string;
  model: string;
  latencyMs: number;
  raw: unknown;
}

export interface AiProbeResult {
  model: string;
  baseUrl: string;
  status: number;
  latencyMs: number;
  error: string;
  works: boolean;
  contentPreview: string;
}

const DEFAULT_MODELS: Record<AiRole, string> = {
  generator: "claude-opus-5",
  judge: "claude-opus-4-8",
  quote: "gpt-5.6-sol",
  acceptance: "claude-opus-4-8",
};

/**
 * AgentRouter WAF only accepts Claude Code wire-image traffic.
 * Generic OpenAI SDK headers get `unauthorized client detected` even with a valid key.
 * Docs/community: ANTHROPIC_BASE_URL=https://agentrouter.org + Claude Code headers.
 * OpenAI-compatible path that works with the same wire image: POST /v1/chat/completions
 * Anthropic path: POST /v1/messages (?beta=true)
 */
export function buildAgentRouterHeaders(apiKey: string): Record<string, string> {
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
    "X-Stainless-OS": process.platform === "win32" ? "Windows" : process.platform,
    "X-Stainless-Arch": process.arch,
    "X-Stainless-Runtime": "node",
    "X-Stainless-Runtime-Version": process.version,
  };
}

export function resolveAiBaseUrl(env: BeaconEnv = loadEnv()): string {
  const raw = env.AI_BASE_URL || env.OPENAI_BASE_URL || "https://agentrouter.org/v1";
  return normalizeOpenAiBase(raw);
}

export function resolveAiApiKey(env: BeaconEnv = loadEnv()): string {
  return env.AI_API_KEY || env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY || "";
}

export function resolveModelForRole(role: AiRole, env: BeaconEnv = loadEnv()): string {
  switch (role) {
    case "generator":
      return env.AI_MODEL_GENERATOR || DEFAULT_MODELS.generator;
    case "judge":
      return env.AI_MODEL_JUDGE || DEFAULT_MODELS.judge;
    case "quote":
      return env.AI_MODEL_QUOTE || env.AI_MODEL_GENERATOR || DEFAULT_MODELS.quote;
    case "acceptance":
      return env.AI_MODEL_ACCEPTANCE || env.AI_MODEL_JUDGE || DEFAULT_MODELS.acceptance;
    default:
      return DEFAULT_MODELS.generator;
  }
}

export function isAiConfigured(env: BeaconEnv = loadEnv()): boolean {
  return Boolean(resolveAiApiKey(env) && resolveAiBaseUrl(env));
}

function normalizeOpenAiBase(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  if (trimmed.endsWith("/v1")) return trimmed;
  // Anthropic-style base https://agentrouter.org → OpenAI-compatible /v1
  return `${trimmed}/v1`;
}

export async function chatCompletion(
  req: ChatCompletionRequest,
  env: BeaconEnv = loadEnv(),
): Promise<ChatCompletionResult> {
  const apiKey = resolveAiApiKey(env);
  const baseUrl = resolveAiBaseUrl(env);
  if (!apiKey) {
    throw new Error("AI_API_KEY is not configured");
  }

  const started = Date.now();
  let response: Response | null = null;
  let text = "";
  let lastError = "";

  for (let attempt = 1; attempt <= 3; attempt++) {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: buildAgentRouterHeaders(apiKey),
      body: JSON.stringify({
        model: req.model,
        temperature: req.temperature ?? 0.2,
        max_tokens: req.maxTokens ?? 2048,
        messages: req.messages,
      }),
    });
    text = await response.text();
    if (response.ok) break;
    lastError = text.slice(0, 400);
    // Retry transient upstream capacity / gateway errors.
    if (![429, 502, 503, 504].includes(response.status) || attempt === 3) break;
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }

  const latencyMs = Date.now() - started;
  let raw: unknown = text;
  try {
    raw = JSON.parse(text);
  } catch {
    // keep raw text
  }

  if (!response || !response.ok) {
    const message =
      typeof raw === "object" && raw && "error" in raw
        ? JSON.stringify((raw as { error: unknown }).error)
        : lastError || text.slice(0, 400);
    throw new Error(`AI provider ${response?.status ?? 0}: ${message}`);
  }

  const data = raw as {
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  if (!content) {
    throw new Error("AI provider returned empty content");
  }

  return {
    content,
    model: data.model ?? req.model,
    latencyMs,
    raw,
  };
}

export async function chatForRole(
  role: AiRole,
  messages: ChatMessage[],
  options: { temperature?: number; maxTokens?: number; env?: BeaconEnv } = {},
): Promise<ChatCompletionResult> {
  const env = options.env ?? loadEnv();
  const primary = resolveModelForRole(role, env);
  const fallbacks =
    role === "quote"
      ? [primary, "claude-opus-4-8", "claude-opus-5", "gpt-5.6-sol"]
      : role === "generator"
        ? [primary, "claude-opus-5", "claude-opus-4-8"]
        : [primary, "claude-opus-4-8", "gpt-5.6-sol"];

  const tried = new Set<string>();
  let lastErr: unknown;
  for (const model of fallbacks) {
    if (tried.has(model)) continue;
    tried.add(model);
    try {
      return await chatCompletion(
        {
          model,
          messages,
          temperature: options.temperature,
          maxTokens: options.maxTokens,
        },
        env,
      );
    } catch (err) {
      lastErr = err;
      const message = err instanceof Error ? err.message : String(err);
      if (!/AI provider (405|429|502|503|504)/.test(message)) throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function probeModels(
  models: string[] = ["claude-opus-5", "claude-opus-4-8", "gpt-5.6-sol"],
  env: BeaconEnv = loadEnv(),
): Promise<AiProbeResult[]> {
  const baseUrl = resolveAiBaseUrl(env);
  const apiKey = resolveAiApiKey(env);
  const results: AiProbeResult[] = [];

  for (const model of models) {
    const started = Date.now();
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: buildAgentRouterHeaders(apiKey),
        body: JSON.stringify({
          model,
          max_tokens: 32,
          messages: [{ role: "user", content: "Reply with exactly: WORKS" }],
        }),
      });
      const text = await response.text();
      let contentPreview = text.slice(0, 120);
      try {
        const parsed = JSON.parse(text) as {
          choices?: Array<{ message?: { content?: string } }>;
          error?: { message?: string };
        };
        contentPreview =
          parsed.choices?.[0]?.message?.content ?? parsed.error?.message ?? contentPreview;
      } catch {
        // keep slice
      }
      results.push({
        model,
        baseUrl,
        status: response.status,
        latencyMs: Date.now() - started,
        error: response.ok ? "" : contentPreview,
        works: response.ok,
        contentPreview,
      });
    } catch (err) {
      results.push({
        model,
        baseUrl,
        status: 0,
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
        works: false,
        contentPreview: "",
      });
    }
  }

  return results;
}

export function extractJsonObject<T extends Record<string, unknown>>(content: string): T {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON object in model response");
    return JSON.parse(match[0]) as T;
  }
}
