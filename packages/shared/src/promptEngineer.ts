import { chatCompletion, isAiConfigured } from "./ai.js";
import { loadEnv, type BeaconEnv } from "./env.js";

export type MediaKind = "image" | "video";

export interface EngineeredPrompt {
  prompt: string;
  negativePrompt: string;
  style: string;
  aspectHint: string;
  shotList?: Array<{ beat: string; prompt: string; seconds: number }>;
  model: string;
  latencyMs: number;
  source: "agentrouter" | "local-heuristic";
}

function heuristicImagePrompt(brief: string): EngineeredPrompt {
  const cleaned = brief.trim().replace(/\s+/g, " ").slice(0, 400);
  const isLogo = /\b(logo|brand\s*mark|wordmark|identity|icon\s*for)\b/i.test(cleaned);
  if (isLogo) {
    return {
      prompt: [
        cleaned,
        "premium brand identity system, flat vector logo mark,",
        "centered geometric monogram or wordmark, mint green accent #39e08a,",
        "warm cream paper background #f4f1ea, charcoal ink,",
        "Swiss graphic design, generous negative space, crisp edges,",
        "no photorealism, no 3d render, no lens flare, no fake metal,",
        "studio brand guideline sheet aesthetic, high-end agency quality",
      ].join(" "),
      negativePrompt:
        "photorealistic, lens flare, blurry, watermark, messy typography, extra letters, low contrast, cluttered, 3d chrome, neon glow, purple gradient",
      style: "vector-brand-logo",
      aspectHint: "1:1",
      model: "heuristic-logo",
      latencyMs: 0,
      source: "local-heuristic",
    };
  }
  return {
    prompt: [
      cleaned,
      "professional commercial creative,",
      "editorial photography lighting, soft directional key light,",
      "clean composition, generous negative space,",
      "premium brand aesthetic, sharp focus, high detail,",
      "color graded, 85mm lens look, shallow depth of field where appropriate,",
      "no watermark, no UI chrome, no low-res artifacts",
    ].join(" "),
    negativePrompt:
      "blurry, low quality, watermark, text overlay, logo spam, distorted hands, ugly, amateur, jpeg artifacts, cropped, cluttered",
    style: "editorial-commercial",
    aspectHint: "1:1",
    model: "heuristic",
    latencyMs: 0,
    source: "local-heuristic",
  };
}

function heuristicVideoShots(brief: string): EngineeredPrompt {
  const base = brief.trim().slice(0, 220);
  return {
    prompt: base,
    negativePrompt: "blurry, watermark, text spam, low quality, morphing animals",
    style: "cinematic-product",
    aspectHint: "9:16",
    shotList: [
      {
        beat: "Hook",
        seconds: 3.2,
        prompt: `${base}, wide establishing shot, subjects entering frame from left, cinematic golden hour, vertical 9:16, photoreal, motion blur hints`,
      },
      {
        beat: "Action",
        seconds: 3.2,
        prompt: `${base}, tight tracking shot from opposite angle, subjects mid-sprint toward camera, dust and energy, vertical 9:16, photoreal`,
      },
    ],
    model: "heuristic",
    latencyMs: 0,
    source: "local-heuristic",
  };
}

/**
 * Use Claude Opus / GPT-5.6 Sol (AgentRouter) to write production-grade prompts.
 * Prompt quality is the main free lever before local ComfyUI / Flux / Wan.
 */
export async function engineerMediaPrompt(
  kind: MediaKind,
  briefText: string,
  env: BeaconEnv = loadEnv(),
): Promise<EngineeredPrompt> {
  // Fast path for Render free tier / smoke: skip AgentRouter prompt eng.
  if ((env.MEDIA_FAST || process.env.MEDIA_FAST || "").toLowerCase() === "true") {
    return kind === "video" ? heuristicVideoShots(briefText) : heuristicImagePrompt(briefText);
  }
  if (!isAiConfigured(env)) {
    return kind === "video" ? heuristicVideoShots(briefText) : heuristicImagePrompt(briefText);
  }

  const model =
    env.AI_MODEL_PROMPT_ENGINEER ||
    env.AI_MODEL_GENERATOR ||
    "claude-opus-5";
  // Prefer configured model, then fast Sol, then Opus — avoid long multi-Opus hangs.
  const fallbacks = [...new Set([model, "gpt-5.6-sol", "claude-opus-5"])];

  const system =
    kind === "image"
      ? `You are a senior art director + Midjourney/Flux prompt engineer.
Return ONLY compact JSON with keys:
prompt (string, English, 60-120 words, camera/lighting/composition/materials/mood),
negativePrompt (string),
style (short string),
aspectHint ("1:1"|"4:5"|"16:9"|"9:16").
No markdown fences.`
      : `You are a senior commercial video director writing still frames for a 12-15s vertical ad.
Return ONLY compact JSON with keys:
prompt (overall logline),
negativePrompt (string),
style (short string),
aspectHint ("9:16"),
shotList (array of 3 objects: beat, seconds number, prompt string — each prompt is a full photographic still description).
No markdown fences.`;

  let lastErr: unknown;
  for (const m of fallbacks) {
    try {
      const started = Date.now();
      const result = await chatCompletion(
        {
          model: m,
          temperature: 0.55,
          maxTokens: 1200,
          messages: [
            { role: "system", content: system },
            {
              role: "user",
              content: `Client brief:\n${briefText.slice(0, 2000)}\n\nOptimize for professional commercial quality.`,
            },
          ],
        },
        env,
      );
      const parsed = extractJson(result.content);
      if (!parsed?.prompt) throw new Error("prompt engineer returned no prompt");
      const engineered: EngineeredPrompt = {
        prompt: String(parsed.prompt),
        negativePrompt: String(parsed.negativePrompt ?? ""),
        style: String(parsed.style ?? "commercial"),
        aspectHint: String(parsed.aspectHint ?? (kind === "video" ? "9:16" : "1:1")),
        model: result.model,
        latencyMs: Date.now() - started,
        source: "agentrouter",
      };
      if (kind === "video") {
        const shots = Array.isArray(parsed.shotList) ? parsed.shotList : [];
        engineered.shotList = shots
          .slice(0, 4)
          .map((s: { beat?: string; prompt?: string; seconds?: number }, i: number) => ({
            beat: String(s.beat ?? `Beat ${i + 1}`),
            prompt: String(s.prompt ?? engineered.prompt),
            seconds: Number(s.seconds) > 0 ? Number(s.seconds) : 4,
          }));
        if (!engineered.shotList.length) {
          return { ...heuristicVideoShots(briefText), ...engineered, shotList: heuristicVideoShots(briefText).shotList };
        }
      }
      return engineered;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!/AI provider (405|429|502|503|504)|prompt engineer/.test(msg) && !/JSON/.test(msg)) {
        // keep trying other models on parse/provider issues
      }
    }
  }

  console.warn(
    "[promptEngineer] falling back to heuristic:",
    lastErr instanceof Error ? lastErr.message : lastErr,
  );
  return kind === "video" ? heuristicVideoShots(briefText) : heuristicImagePrompt(briefText);
}

function extractJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence?.[1]?.trim() ?? trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}
