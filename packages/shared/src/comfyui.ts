import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { loadEnv, type BeaconEnv } from "./env.js";

export interface ComfyImageRequest {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  seed?: number;
}

export interface ComfyImageResult {
  bytes: Buffer;
  mimeType: string;
  provider: "comfyui";
  promptId: string;
  latencyMs: number;
}

export function isComfyConfigured(env: BeaconEnv = loadEnv()): boolean {
  return Boolean((env.COMFYUI_URL || "").trim());
}

/**
 * ComfyUI HTTP API — POST /prompt, poll /history, fetch /view.
 * Requires COMFYUI_URL (e.g. http://127.0.0.1:8188 or a tunneled GPU box).
 * Optional COMFYUI_WORKFLOW_JSON / COMFYUI_WORKFLOW_PATH with __PROMPT__ / __NEGATIVE__ / __SEED__ / __WIDTH__ / __HEIGHT__.
 */
export async function generateComfyImage(
  req: ComfyImageRequest,
  env: BeaconEnv = loadEnv(),
): Promise<ComfyImageResult> {
  const base = (env.COMFYUI_URL || "").replace(/\/$/, "");
  if (!base) throw new Error("COMFYUI_URL is not configured");

  const workflow = await loadWorkflow(env);
  const seed = req.seed ?? Math.floor(Math.random() * 1_000_000_000);
  const width = req.width ?? 1024;
  const height = req.height ?? 1024;
  const filled = injectWorkflow(workflow, {
    prompt: req.prompt,
    negative: req.negativePrompt ?? "",
    seed,
    width,
    height,
  });

  const started = Date.now();
  const clientId = randomUUID();
  const queued = await fetchJson<{ prompt_id: string; error?: unknown }>(`${base}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(authHeaders(env) ?? {}) },
    body: JSON.stringify({ prompt: filled, client_id: clientId }),
  });
  if (!queued.prompt_id) {
    throw new Error(`ComfyUI queue failed: ${JSON.stringify(queued).slice(0, 300)}`);
  }

  const outputs = await waitForHistory(base, queued.prompt_id, env, 300_000);
  const imageRef = findFirstImage(outputs);
  if (!imageRef) throw new Error("ComfyUI finished without image output");

  const qs = new URLSearchParams({
    filename: imageRef.filename,
    subfolder: imageRef.subfolder || "",
    type: imageRef.type || "output",
  });
  const imgRes = await fetch(`${base}/view?${qs}`, {
    headers: { ...(authHeaders(env) ?? {}) },
  });
  if (!imgRes.ok) throw new Error(`ComfyUI /view ${imgRes.status}`);
  const bytes = Buffer.from(await imgRes.arrayBuffer());
  const mimeType = imgRes.headers.get("content-type")?.split(";")[0] || "image/png";
  return {
    bytes,
    mimeType,
    provider: "comfyui",
    promptId: queued.prompt_id,
    latencyMs: Date.now() - started,
  };
}

function authHeaders(env: BeaconEnv): Record<string, string> | undefined {
  if (!env.COMFYUI_API_KEY) return undefined;
  return { Authorization: `Bearer ${env.COMFYUI_API_KEY}` };
}

async function loadWorkflow(env: BeaconEnv): Promise<Record<string, unknown>> {
  if (env.COMFYUI_WORKFLOW_JSON?.trim()) {
    return JSON.parse(env.COMFYUI_WORKFLOW_JSON) as Record<string, unknown>;
  }
  if (env.COMFYUI_WORKFLOW_PATH?.trim()) {
    const raw = await readFile(env.COMFYUI_WORKFLOW_PATH, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  }
  // Minimal SD1.5-style API graph — replace with Flux.2/Wan export for pro quality.
  return defaultSdWorkflow();
}

function injectWorkflow(
  workflow: Record<string, unknown>,
  vars: { prompt: string; negative: string; seed: number; width: number; height: number },
): Record<string, unknown> {
  const raw = JSON.stringify(workflow)
    .replaceAll("__PROMPT__", JSON.stringify(vars.prompt).slice(1, -1))
    .replaceAll("__NEGATIVE__", JSON.stringify(vars.negative).slice(1, -1))
    .replaceAll('"__SEED__"', String(vars.seed))
    .replaceAll("__SEED__", String(vars.seed))
    .replaceAll('"__WIDTH__"', String(vars.width))
    .replaceAll("__WIDTH__", String(vars.width))
    .replaceAll('"__HEIGHT__"', String(vars.height))
    .replaceAll("__HEIGHT__", String(vars.height));
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  // Also patch common CLIPTextEncode / EmptyLatentImage / KSampler fields by class_type.
  for (const node of Object.values(parsed)) {
    if (!node || typeof node !== "object") continue;
    const n = node as { class_type?: string; inputs?: Record<string, unknown> };
    if (!n.inputs) continue;
    if (n.class_type === "CLIPTextEncode" && typeof n.inputs.text === "string") {
      if (n.inputs.text.includes("NEGATIVE") || n.inputs.text === "") {
        // leave negatives for dedicated negative node — if empty-ish, set negative
      }
    }
  }

  // Direct field overrides for placeholder-less workflows: first positive CLIP, first negative CLIP, first EmptyLatent, first KSampler seed
  let posSet = false;
  let negSet = false;
  for (const node of Object.values(parsed)) {
    if (!node || typeof node !== "object") continue;
    const n = node as { class_type?: string; inputs?: Record<string, unknown>; _meta?: { title?: string } };
    if (!n.inputs) continue;
    const title = (n._meta?.title || "").toLowerCase();
    if (n.class_type === "CLIPTextEncode") {
      if (!posSet && !title.includes("neg")) {
        n.inputs.text = vars.prompt;
        posSet = true;
      } else if (!negSet && (title.includes("neg") || posSet)) {
        n.inputs.text = vars.negative;
        negSet = true;
      }
    }
    if (n.class_type === "EmptyLatentImage") {
      n.inputs.width = vars.width;
      n.inputs.height = vars.height;
    }
    if (n.class_type === "KSampler" || n.class_type === "KSamplerAdvanced") {
      if ("seed" in n.inputs) n.inputs.seed = vars.seed;
      if ("noise_seed" in n.inputs) n.inputs.noise_seed = vars.seed;
    }
  }
  return parsed;
}

function defaultSdWorkflow(): Record<string, unknown> {
  return {
    "3": {
      class_type: "KSampler",
      inputs: {
        seed: "__SEED__",
        steps: 28,
        cfg: 7,
        sampler_name: "euler",
        scheduler: "normal",
        denoise: 1,
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["5", 0],
      },
    },
    "4": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: "v1-5-pruned-emaonly.safetensors" },
    },
    "5": {
      class_type: "EmptyLatentImage",
      inputs: { width: "__WIDTH__", height: "__HEIGHT__", batch_size: 1 },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: { text: "__PROMPT__", clip: ["4", 1] },
      _meta: { title: "Positive" },
    },
    "7": {
      class_type: "CLIPTextEncode",
      inputs: { text: "__NEGATIVE__", clip: ["4", 1] },
      _meta: { title: "Negative" },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: { samples: ["3", 0], vae: ["4", 2] },
    },
    "9": {
      class_type: "SaveImage",
      inputs: { filename_prefix: "beacon", images: ["8", 0] },
    },
  };
}

async function waitForHistory(
  base: string,
  promptId: string,
  env: BeaconEnv,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const hist = await fetchJson<Record<string, { outputs?: Record<string, unknown> }>>(
      `${base}/history/${promptId}`,
      { headers: { ...(authHeaders(env) ?? {}) } },
    );
    const entry = hist[promptId];
    if (entry?.outputs) return entry.outputs as Record<string, unknown>;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`ComfyUI timeout waiting for ${promptId}`);
}

function findFirstImage(
  outputs: Record<string, unknown>,
): { filename: string; subfolder?: string; type?: string } | null {
  for (const nodeOut of Object.values(outputs)) {
    if (!nodeOut || typeof nodeOut !== "object") continue;
    const images = (nodeOut as { images?: Array<{ filename: string; subfolder?: string; type?: string }> })
      .images;
    if (images?.[0]?.filename) return images[0];
  }
  return null;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* keep */
  }
  if (!res.ok) throw new Error(`ComfyUI ${res.status}: ${text.slice(0, 300)}`);
  return data as T;
}
