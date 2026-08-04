import { loadEnv, type BeaconEnv } from "./env.js";

export interface PollinationsImageRequest {
  prompt: string;
  width?: number;
  height?: number;
  model?: string;
  seed?: number;
  nologo?: boolean;
}

export interface PollinationsImageResult {
  bytes: Buffer;
  mimeType: string;
  url: string;
  model: string;
  provider: "pollinations";
  latencyMs: number;
}

function resolveImageBase(env: BeaconEnv): string {
  return (
    env.POLLINATIONS_IMAGE_BASE ||
    "https://image.pollinations.ai/prompt"
  ).replace(/\/$/, "");
}

function resolveModel(env: BeaconEnv): string {
  return env.POLLINATIONS_MODEL || "flux";
}

/**
 * Free text-to-image via Pollinations (no AgentRouter image entitlement required).
 * Anonymous: https://image.pollinations.ai/prompt/{prompt}
 * Authenticated gen API optional via POLLINATIONS_API_KEY + POLLINATIONS_IMAGE_BASE.
 */
export async function generatePollinationsImage(
  req: PollinationsImageRequest,
  env: BeaconEnv = loadEnv(),
): Promise<PollinationsImageResult> {
  const model = req.model || resolveModel(env);
  const width = req.width ?? 1024;
  const height = req.height ?? 1024;
  const seed = req.seed ?? Math.floor(Math.random() * 1_000_000_000);
  const nologo = req.nologo ?? true;
  const encoded = encodeURIComponent(req.prompt.slice(0, 800));
  const base = resolveImageBase(env);
  const qs = new URLSearchParams({
    model,
    width: String(width),
    height: String(height),
    seed: String(seed),
    nologo: nologo ? "true" : "false",
    enhance: "true",
    private: "true",
  });
  if (env.POLLINATIONS_API_KEY) qs.set("key", env.POLLINATIONS_API_KEY);

  const url = `${base}/${encoded}?${qs.toString()}`;
  const headers: Record<string, string> = {
    Accept: "image/*",
    "User-Agent": "beacon-pipeline/0.1",
  };
  if (env.POLLINATIONS_API_KEY) {
    headers.Authorization = `Bearer ${env.POLLINATIONS_API_KEY}`;
  }

  const started = Date.now();
  let lastErr = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(url, {
      method: "GET",
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(45_000),
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const ctype = res.headers.get("content-type") ?? "";
    if (res.ok && buf.length > 1024 && ctype.startsWith("image/")) {
      return {
        bytes: buf,
        mimeType: ctype.split(";")[0] || "image/jpeg",
        url,
        model,
        provider: "pollinations",
        latencyMs: Date.now() - started,
      };
    }
    const bodyPreview = buf.subarray(0, 160).toString("utf8");
    lastErr = `${res.status} ${ctype} bytes=${buf.length} ${bodyPreview}`;
    // Payment / auth — do not burn minutes retrying
    if ([401, 402, 403, 404].includes(res.status)) break;
    if (/insufficient|pollen|balance|payment/i.test(bodyPreview)) break;
    // Rate limit / cold start only
    if ([429, 502, 503, 504].includes(res.status) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 2500 * attempt));
      continue;
    }
    break;
  }
  throw new Error(`Pollinations image failed: ${lastErr}`);
}

export function isPollinationsConfigured(env: BeaconEnv = loadEnv()): boolean {
  const provider = (env.IMAGE_PROVIDER || "pollinations").toLowerCase();
  return provider === "pollinations" || provider === "auto" || provider === "";
}
