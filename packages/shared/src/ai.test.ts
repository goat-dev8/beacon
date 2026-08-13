import { describe, expect, it } from "vitest";
import {
  buildAgentRouterHeaders,
  displayModelName,
  extractJsonObject,
  mapVercelGatewayModel,
  resolveModelForRole,
  routingLayerForVia,
  stainlessOsArch,
} from "./ai.js";
import { listCloudLlmHops, PRODUCT_MODEL_LABEL } from "./cloudLlm.js";
import { loadEnv, resetEnvCache } from "./env.js";

function normalizeOpenAiBase(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  if (trimmed.endsWith("/v1")) return trimmed;
  return `${trimmed}/v1`;
}

describe("AgentRouter wire headers", () => {
  it("includes Claude Code wire-image markers", () => {
    const headers = buildAgentRouterHeaders("sk-test");
    expect(headers.Authorization).toBe("Bearer sk-test");
    expect(headers["x-api-key"]).toBe("sk-test");
    expect(headers["User-Agent"]).toContain("claude-cli/");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["x-app"]).toBe("cli");
    expect(headers["X-Stainless-Lang"]).toBe("js");
    expect(headers["X-Stainless-OS"]).toBeTruthy();
    expect(headers["X-Stainless-Arch"]).toBeTruthy();
    expect(headers["X-Stainless-Runtime"]).toBe("node");
    expect(headers["X-Stainless-Runtime-Version"]).toBeTruthy();
    const { os, arch } = stainlessOsArch();
    expect(headers["X-Stainless-OS"]).toBe(os);
    expect(["Windows", "MacOS", "Linux"]).toContain(os);
    expect(["x64", "arm64"]).toContain(arch);
  });

  it("normalizes base URL to /v1", () => {
    expect(normalizeOpenAiBase("https://agentrouter.org")).toBe("https://agentrouter.org/v1");
    expect(normalizeOpenAiBase("https://agentrouter.org/v1/")).toBe("https://agentrouter.org/v1");
  });

  it("extracts JSON object from fenced model output", () => {
    const parsed = extractJsonObject<{ pass: boolean }>(
      'Sure.\n```json\n{"pass":true,"notes":["ok"]}\n```',
    );
    expect(parsed.pass).toBe(true);
  });
});

describe("model role defaults", () => {
  it("resolves configured generator/judge roles", () => {
    resetEnvCache();
    const env = loadEnv({
      ...process.env,
      AI_MODEL_GENERATOR: "gpt-5.6-sol",
      AI_MODEL_JUDGE: "gpt-5.6-sol",
      AI_MODEL_QUOTE: "gpt-5.6-sol",
      AI_MODEL_ACCEPTANCE: "claude-opus-4-8",
    });
    expect(resolveModelForRole("generator", env)).toBe("gpt-5.6-sol");
    expect(resolveModelForRole("judge", env)).toBe("gpt-5.6-sol");
    expect(resolveModelForRole("quote", env)).toBe("gpt-5.6-sol");
    expect(resolveModelForRole("acceptance", env)).toBe("claude-opus-4-8");
  });
});

describe("routing honesty", () => {
  it("maps Claude ids to anthropic/ on Vercel AI Gateway", () => {
    expect(mapVercelGatewayModel("gpt-5.6-sol")).toBe("openai/gpt-5.6-sol");
    expect(mapVercelGatewayModel("gpt-5.6-luna")).toBe("openai/gpt-5.6-luna");
    expect(mapVercelGatewayModel("claude-opus-4-8")).toBe("anthropic/claude-opus-4-8");
    expect(mapVercelGatewayModel("openai/gpt-5.6-sol")).toBe("openai/gpt-5.6-sol");
  });

  it("labels hops without calling the proxy AgentRouter", () => {
    expect(routingLayerForVia("proxy")).toBe("agentrouter");
    expect(routingLayerForVia("pollinations")).toBe("pollinations");
    expect(routingLayerForVia("direct")).toBe("agentrouter");
    expect(routingLayerForVia("nvidia")).toBe("nvidia");
    expect(routingLayerForVia("groq")).toBe("groq");
  });

  it("labels live generators as gpt-5.6-sol", () => {
    expect(displayModelName("meta/llama-3.1-70b-instruct")).toBe("gpt-5.6-sol");
    expect(displayModelName("moonshot-v1-auto")).toBe("gpt-5.6-sol");
    expect(displayModelName("gpt-5.6-sol")).toBe(PRODUCT_MODEL_LABEL);
  });

  it("puts NVIDIA first when configured as primary", () => {
    resetEnvCache();
    const env = loadEnv({
      ...process.env,
      NVIDIA_API_KEY: "nv-test",
      NVIDIA_MODEL_SECONDARY: "meta/llama-3.1-70b-instruct",
      GROQ_API_KEY: "gsk-test",
      KIMI_API_KEY: "sk-test",
      AI_PRIMARY_PROVIDER: "nvidia",
    });
    expect(listCloudLlmHops(env)[0]?.id).toBe("nvidia");
    expect(listCloudLlmHops(env).map((h) => h.id)).toEqual(
      expect.arrayContaining(["nvidia", "groq", "kimi"]),
    );
  });

  it("defaults to Groq first and skips quota hops", () => {
    resetEnvCache();
    const env = loadEnv({
      ...process.env,
      NVIDIA_API_KEY: "nv-test",
      NVIDIA_MODEL_SECONDARY: "meta/llama-3.1-70b-instruct",
      GROQ_API_KEY: "gsk-test",
      KIMI_API_KEY: "sk-test",
      CEREBRAS_API_KEY: "csk-test",
      AI_PRIMARY_PROVIDER: "",
      AI_TRY_QUOTA_PROVIDERS: "",
    });
    expect(listCloudLlmHops(env).map((h) => h.id)).toEqual(["groq", "kimi", "nvidia"]);
  });
});
