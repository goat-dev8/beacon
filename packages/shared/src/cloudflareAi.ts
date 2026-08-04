import { loadEnv, type BeaconEnv } from "./env.js";

export interface CfImageRequest {
  prompt: string;
  width?: number;
  height?: number;
  steps?: number;
}

export interface CfImageResult {
  bytes: Buffer;
  mimeType: string;
  provider: "cloudflare";
  model: string;
  latencyMs: number;
}

export function isCloudflareAiConfigured(env: BeaconEnv = loadEnv()): boolean {
  return Boolean(
    (env.CF_ACCOUNT_ID || "").trim() && (env.CF_API_TOKEN || env.CLOUDFLARE_API_TOKEN || "").trim(),
  );
}

/**
 * Cloudflare Workers AI — free daily Neurons, FLUX.1-schnell at the edge.
 * Docs: POST /accounts/{id}/ai/run/@cf/black-forest-labs/flux-1-schnell
 */
export async function generateCloudflareImage(
  req: CfImageRequest,
  env: BeaconEnv = loadEnv(),
): Promise<CfImageResult> {
  const account = (env.CF_ACCOUNT_ID || "").trim();
  const token = (env.CF_API_TOKEN || env.CLOUDFLARE_API_TOKEN || "").trim();
  if (!account || !token) throw new Error("CF_ACCOUNT_ID / CF_API_TOKEN not configured");

  const model = env.CF_IMAGE_MODEL || "@cf/black-forest-labs/flux-1-schnell";
  const started = Date.now();
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model.replace(/^\//, "")}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: req.prompt.slice(0, 2048),
      num_steps: req.steps ?? 8,
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const text = await res.text();
  let json: {
    success?: boolean;
    result?: { image?: string };
    errors?: Array<{ message?: string }>;
  };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Cloudflare AI ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok || !json.success || !json.result?.image) {
    const err = json.errors?.map((e) => e.message).join("; ") || text.slice(0, 200);
    throw new Error(`Cloudflare AI ${res.status}: ${err}`);
  }
  return {
    bytes: Buffer.from(json.result.image, "base64"),
    mimeType: "image/png",
    provider: "cloudflare",
    model,
    latencyMs: Date.now() - started,
  };
}
