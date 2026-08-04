import { generateComfyImage, isComfyConfigured } from "./comfyui.js";
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
 * 2) Hugging Face FLUX.1-schnell when HF_TOKEN is set
 * 3) Pollinations (when healthy / entitled)
 *
 * Always runs AgentRouter prompt engineering first (Opus / GPT-5.6 Sol).
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
      errors.push(`huggingface: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (isPollinationsConfigured(env)) {
    const preferred = env.POLLINATIONS_MODEL || "flux";
    // Try preferred + one cheap fallback only — stop on payment/auth errors.
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
    `No image provider succeeded. Configure COMFYUI_URL (Flux.2/Wan) or HF_TOKEN (FLUX.1-schnell). Details: ${errors.join(" | ").slice(0, 800)}`,
  );
}

export async function engineerVideoShots(briefText: string, env: BeaconEnv = loadEnv()) {
  return engineerMediaPrompt("video", briefText, env);
}
