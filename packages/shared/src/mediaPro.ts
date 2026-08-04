import { generateComfyImage, isComfyConfigured } from "./comfyui.js";
import { generateCloudflareImage, isCloudflareAiConfigured } from "./cloudflareAi.js";
import { generateHuggingFaceImage, isHuggingFaceConfigured } from "./huggingface.js";
import { generatePollinationsImage, isPollinationsConfigured } from "./pollinations.js";
import { engineerMediaPrompt, type EngineeredPrompt } from "./promptEngineer.js";
import { loadEnv, type BeaconEnv } from "./env.js";

export interface ProImageResult {
  bytes: Buffer;
  mimeType: string;
  provider: string;
  model?: string;
  latencyMs: number;
  engineered: EngineeredPrompt;
}

/**
 * Professional image cascade for Beacon jobs:
 * 1) ComfyUI (Flux.2 / local GPU) when COMFYUI_URL is set
 * 2) Cloudflare Workers AI FLUX.1-schnell (free daily Neurons)
 * 3) Hugging Face fal Flux when HF_TOKEN has credits
 * 4) Pollinations (when entitled / Pollen > 0)
 *
 * AgentRouter (gpt-5.6-sol / Opus) engineers the prompt first unless MEDIA_FAST.
 */
export async function generateProImage(
  briefText: string,
  opts: { width?: number; height?: number; env?: BeaconEnv } = {},
): Promise<ProImageResult> {
  const env = opts.env ?? loadEnv();
  const engineered = await engineerMediaPrompt("image", briefText, env);
  const width = opts.width ?? 1280;
  const height = opts.height ?? 1280;
  const errors: string[] = [];

  if (isComfyConfigured(env)) {
    try {
      const img = await generateComfyImage(
        {
          prompt: engineered.prompt,
          negativePrompt: engineered.negativePrompt,
          width,
          height,
        },
        env,
      );
      return {
        bytes: img.bytes,
        mimeType: img.mimeType,
        provider: img.provider,
        latencyMs: img.latencyMs,
        engineered,
      };
    } catch (err) {
      errors.push(`comfyui: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (isCloudflareAiConfigured(env)) {
    try {
      const img = await generateCloudflareImage(
        { prompt: engineered.prompt, width, height, steps: 8 },
        env,
      );
      return {
        bytes: img.bytes,
        mimeType: img.mimeType,
        provider: img.provider,
        model: img.model,
        latencyMs: img.latencyMs,
        engineered,
      };
    } catch (err) {
      errors.push(`cloudflare: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (isHuggingFaceConfigured(env)) {
    try {
      const img = await generateHuggingFaceImage(
        {
          prompt: engineered.prompt,
          negativePrompt: engineered.negativePrompt,
          width,
          height,
        },
        env,
      );
      return {
        bytes: img.bytes,
        mimeType: img.mimeType,
        provider: img.provider,
        model: img.model,
        latencyMs: img.latencyMs,
        engineered,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`huggingface: ${msg}`);
      if (/depleted|402|credits/i.test(msg)) {
        /* fall through */
      }
    }
  }

  if (isPollinationsConfigured(env)) {
    const preferred = env.POLLINATIONS_MODEL || "flux";
    const models = preferred === "turbo" ? [preferred] : [preferred, "turbo"];
    const tried = new Set<string>();
    for (const model of models) {
      if (tried.has(model)) continue;
      tried.add(model);
      try {
        const img = await generatePollinationsImage(
          { prompt: engineered.prompt, width, height, model },
          env,
        );
        return {
          bytes: img.bytes,
          mimeType: img.mimeType,
          provider: img.provider,
          model: img.model,
          latencyMs: img.latencyMs,
          engineered,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`pollinations/${model}: ${msg}`);
        if (/ (401|402|403) |insufficient|pollen|balance/i.test(msg)) break;
      }
    }
  }

  throw new Error(
    `No image provider succeeded. Set CF_ACCOUNT_ID+CF_API_TOKEN (Workers AI Flux), COMFYUI_URL, or HF_TOKEN. Details: ${errors.join(" | ").slice(0, 800)}`,
  );
}

export async function engineerVideoShots(briefText: string, env: BeaconEnv = loadEnv()) {
  return engineerMediaPrompt("video", briefText, env);
}
