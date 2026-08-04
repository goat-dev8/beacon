import { loadEnv, type BeaconEnv } from "./env.js";

export interface HfImageRequest {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
}

export interface HfImageResult {
  bytes: Buffer;
  mimeType: string;
  provider: "huggingface";
  model: string;
  latencyMs: number;
}

export function isHuggingFaceConfigured(env: BeaconEnv = loadEnv()): boolean {
  return Boolean((env.HF_TOKEN || env.HUGGINGFACE_API_KEY || "").trim());
}

/**
 * Hugging Face Inference Providers — FLUX.1-schnell (Apache-2.0) for strong open quality.
 * Needs free HF_TOKEN with Inference Providers credits.
 */
export async function generateHuggingFaceImage(
  req: HfImageRequest,
  env: BeaconEnv = loadEnv(),
): Promise<HfImageResult> {
  const token = (env.HF_TOKEN || env.HUGGINGFACE_API_KEY || "").trim();
  if (!token) throw new Error("HF_TOKEN is not configured");

  const model =
    env.HF_IMAGE_MODEL || "black-forest-labs/FLUX.1-schnell";
  const started = Date.now();

  // Prefer OpenAI-compatible router images endpoint when available
  const routerUrl = "https://router.huggingface.co/v1/images/generations";
  try {
    const res = await fetch(routerUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt: req.prompt,
        size: `${req.width ?? 1024}x${req.height ?? 1024}`,
        response_format: "b64_json",
      }),
    });
    const text = await res.text();
    if (res.ok) {
      const data = JSON.parse(text) as {
        data?: Array<{ b64_json?: string; url?: string }>;
      };
      const b64 = data.data?.[0]?.b64_json;
      if (b64) {
        return {
          bytes: Buffer.from(b64, "base64"),
          mimeType: "image/png",
          provider: "huggingface",
          model,
          latencyMs: Date.now() - started,
        };
      }
      if (data.data?.[0]?.url) {
        const img = await fetch(data.data[0].url);
        const bytes = Buffer.from(await img.arrayBuffer());
        return {
          bytes,
          mimeType: img.headers.get("content-type")?.split(";")[0] || "image/png",
          provider: "huggingface",
          model,
          latencyMs: Date.now() - started,
        };
      }
    }
  } catch {
    /* fall through to legacy inference */
  }

  const legacy = `https://api-inference.huggingface.co/models/${model}`;
  const res = await fetch(legacy, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "image/png",
    },
    body: JSON.stringify({
      inputs: req.prompt,
      parameters: {
        width: req.width ?? 1024,
        height: req.height ?? 1024,
        negative_prompt: req.negativePrompt || undefined,
      },
    }),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const ctype = res.headers.get("content-type") ?? "";
  if (!res.ok || !ctype.startsWith("image/")) {
    throw new Error(`HuggingFace image ${res.status}: ${buf.subarray(0, 200).toString("utf8")}`);
  }
  return {
    bytes: buf,
    mimeType: ctype.split(";")[0] || "image/png",
    provider: "huggingface",
    model,
    latencyMs: Date.now() - started,
  };
}
