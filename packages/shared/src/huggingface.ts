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

function resolveSizeLabel(width: number, height: number): string {
  const ratio = width / Math.max(height, 1);
  if (Math.abs(ratio - 1) < 0.08) return "square_hd";
  if (ratio > 1.3) return "landscape_16_9";
  if (ratio < 0.75) return "portrait_16_9";
  return "square_hd";
}

/**
 * Hugging Face Inference Providers — Flux via fal-ai router (working path 2026).
 * Legacy api-inference + /v1/images/generations are often 404/410 for Flux.
 */
export async function generateHuggingFaceImage(
  req: HfImageRequest,
  env: BeaconEnv = loadEnv(),
): Promise<HfImageResult> {
  const token = (env.HF_TOKEN || env.HUGGINGFACE_API_KEY || "").trim();
  if (!token) throw new Error("HF_TOKEN is not configured");

  const model = env.HF_IMAGE_MODEL || "fal-ai/flux/schnell";
  const width = req.width ?? 1024;
  const height = req.height ?? 1024;
  const started = Date.now();
  const errors: string[] = [];

  // 1) fal-ai Flux.schnell via HF router (primary — proven working)
  const falPaths = [
    model.startsWith("fal-ai/") ? `https://router.huggingface.co/fal-ai/${model}` : null,
    "https://router.huggingface.co/fal-ai/fal-ai/flux/schnell",
    "https://router.huggingface.co/fal-ai/fal-ai/flux/dev",
  ].filter(Boolean) as string[];

  for (const falUrl of falPaths) {
    try {
      const res = await fetch(falUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: req.prompt,
          negative_prompt: req.negativePrompt || undefined,
          image_size: resolveSizeLabel(width, height),
          num_images: 1,
          enable_safety_checker: true,
        }),
        signal: AbortSignal.timeout(90_000),
      });
      const text = await res.text();
      if (!res.ok) {
        errors.push(`fal ${res.status}: ${text.slice(0, 160)}`);
        continue;
      }
      const data = JSON.parse(text) as {
        images?: Array<{ url?: string }>;
        image?: { url?: string };
      };
      const imageUrl = data.images?.[0]?.url || data.image?.url;
      if (!imageUrl) {
        errors.push(`fal ok but no image url: ${text.slice(0, 120)}`);
        continue;
      }
      const img = await fetch(imageUrl, { signal: AbortSignal.timeout(60_000) });
      const bytes = Buffer.from(await img.arrayBuffer());
      if (!img.ok || bytes.length < 1024) {
        errors.push(`fal image fetch failed ${img.status} bytes=${bytes.length}`);
        continue;
      }
      return {
        bytes,
        mimeType: img.headers.get("content-type")?.split(";")[0] || "image/jpeg",
        provider: "huggingface",
        model: falUrl.includes("flux/dev") ? "fal-ai/flux/dev" : "fal-ai/flux/schnell",
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      errors.push(`fal: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 2) OpenAI-compatible router (some accounts / models)
  try {
    const res = await fetch("https://router.huggingface.co/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model.includes("/") ? model : "black-forest-labs/FLUX.1-schnell",
        prompt: req.prompt,
        size: `${width}x${height}`,
        response_format: "b64_json",
      }),
      signal: AbortSignal.timeout(90_000),
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
    } else {
      errors.push(`openai-router ${res.status}: ${text.slice(0, 120)}`);
    }
  } catch (err) {
    errors.push(`openai-router: ${err instanceof Error ? err.message : String(err)}`);
  }

  throw new Error(
    `HuggingFace image failed. ${errors.join(" | ").slice(0, 600)}`,
  );
}
