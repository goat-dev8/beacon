import type { BeaconEnv } from "./env.js";

/** Product-facing Jobs label. Upstream model ids stay internal. */
export const PRODUCT_MODEL_LABEL = "gpt-5.6-sol";

export type CloudHopId =
  | "nvidia"
  | "groq"
  | "kimi"
  | "cerebras"
  | "sambanova"
  | "together"
  | "openrouter"
  | "gemini";

export type CloudLlmHop = {
  id: CloudHopId;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  headers?: Record<string, string>;
};

function trimSlash(url: string): string {
  return url.replace(/\/$/, "");
}

function openaiBase(url: string): string {
  const trimmed = trimSlash(url);
  return trimmed.endsWith("/v1") || trimmed.endsWith("/openai") ? trimmed : `${trimmed}/v1`;
}

/**
 * Cloud OpenAI-compatible hops that work from Render (no laptop).
 * Live probe 2026-08-14: nvidia llama-3.1-70b, groq llama-3.3-70b, kimi moonshot-v1-auto.
 * Dead/quota hops stay last with a short timeout so a later credit top-up still works.
 */
export function listCloudLlmHops(env: BeaconEnv): CloudLlmHop[] {
  const hops: CloudLlmHop[] = [];
  const nvidiaKey = env.NVIDIA_API_KEY || "";
  const nvidiaBase = openaiBase(env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1");
  const nvidiaTimeout = Number(env.NVIDIA_TIMEOUT_MS || 120_000) || 120_000;
  if (nvidiaKey) {
    hops.push({
      id: "nvidia",
      baseUrl: nvidiaBase,
      apiKey: nvidiaKey,
      // deepseek-v4-flash currently 410 on this key; llama-3.1-70b-instruct is live.
      model:
        env.NVIDIA_MODEL_SECONDARY ||
        (env.NVIDIA_MODEL_PRIMARY && !/deepseek-v4-flash/i.test(env.NVIDIA_MODEL_PRIMARY)
          ? env.NVIDIA_MODEL_PRIMARY
          : "meta/llama-3.1-70b-instruct"),
      timeoutMs: Math.min(Math.max(nvidiaTimeout, 20_000), 120_000),
    });
  }

  const groqKey = env.GROQ_API_KEY || "";
  if (groqKey) {
    hops.push({
      id: "groq",
      baseUrl: openaiBase(env.GROQ_BASE_URL || "https://api.groq.com/openai/v1"),
      apiKey: groqKey,
      model: env.GROQ_MODEL || "llama-3.3-70b-versatile",
      timeoutMs: 40_000,
    });
  }

  const kimiKey = env.KIMI_API_KEY || "";
  if (kimiKey) {
    hops.push({
      id: "kimi",
      baseUrl: openaiBase(env.KIMI_BASE_URL || "https://api.moonshot.ai/v1"),
      apiKey: kimiKey,
      model: env.KIMI_MODEL || "moonshot-v1-auto",
      timeoutMs: 60_000,
    });
  }

  const cerebrasKey = env.CEREBRAS_API_KEY || "";
  if (cerebrasKey) {
    hops.push({
      id: "cerebras",
      baseUrl: openaiBase(env.CEREBRAS_BASE_URL || "https://api.cerebras.ai/v1"),
      apiKey: cerebrasKey,
      model: env.CEREBRAS_MODEL || "llama-3.3-70b",
      timeoutMs: 8_000,
    });
  }

  const sambaKey = env.SAMBANOVA_API_KEY || "";
  if (sambaKey) {
    hops.push({
      id: "sambanova",
      baseUrl: openaiBase(env.SAMBANOVA_BASE_URL || "https://api.sambanova.ai/v1"),
      apiKey: sambaKey,
      model: env.SAMBANOVA_MODEL || "Meta-Llama-3.3-70B-Instruct",
      timeoutMs: 8_000,
    });
  }

  const togetherKey = env.TOGETHER_API_KEY || "";
  if (togetherKey) {
    hops.push({
      id: "together",
      baseUrl: "https://api.together.xyz/v1",
      apiKey: togetherKey,
      model: env.TOGETHER_MODEL || "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free",
      timeoutMs: 8_000,
    });
  }

  const openrouterKey = env.OPENROUTER_API_KEY || "";
  if (openrouterKey) {
    hops.push({
      id: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: openrouterKey,
      model: env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free",
      timeoutMs: 8_000,
      headers: {
        "HTTP-Referer": "https://beacon-desk.vercel.app",
        "X-Title": "Beacon",
      },
    });
  }

  const geminiKey = env.GEMINI_API_KEY || "";
  if (geminiKey) {
    hops.push({
      id: "gemini",
      baseUrl: trimSlash(env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai"),
      apiKey: geminiKey,
      model: env.GEMINI_MODEL || "gemini-2.0-flash",
      timeoutMs: 8_000,
    });
  }

  const primary = (env.AI_PRIMARY_PROVIDER || "nvidia").toLowerCase();
  hops.sort((a, b) => {
    if (a.id === primary && b.id !== primary) return -1;
    if (b.id === primary && a.id !== primary) return 1;
    return 0;
  });
  return hops;
}

export function hasCloudLlm(env: BeaconEnv): boolean {
  return listCloudLlmHops(env).length > 0;
}

export function extractChatContent(parsed: unknown): string {
  if (!parsed || typeof parsed !== "object") return "";
  const obj = parsed as {
    choices?: Array<{ message?: { content?: unknown } }>;
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const raw = obj.choices?.[0]?.message?.content;
  if (typeof raw === "string" && raw.trim()) return raw;
  if (Array.isArray(raw)) {
    const joined = raw
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const rec = part as { text?: string; content?: string };
          return rec.text || rec.content || "";
        }
        return "";
      })
      .join("");
    if (joined.trim()) return joined;
  }
  const gem = obj.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  return gem.trim();
}
