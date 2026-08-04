import { mkdir, writeFile, access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  chatForRole,
  generateProImage,
  engineerVideoShots,
  isAiConfigured,
  loadEnv,
  buildProfessionalLogoSvg,
  looksLikeLogoBrief,
} from "@beacon/shared";
import { assembleProVideoFromStills } from "./proVideo.js";

export type PipelineStage = "plan" | "generate" | "compose" | "normalize";

/** Bumped when deliverable composers change — exposed via /health for deploy proof. */
export const PIPELINE_CAPS = {
  version: "2026-08-04-pro-media-v2-cf-flux",
  imageSvg: true,
  imagePollinations: true,
  imageComfy: true,
  imageHuggingFace: true,
  imageCloudflare: true,
  promptEngineer: true,
  videoStoryboard: true,
  videoPollinationsStills: true,
  videoProFfmpeg: true,
  flareRequired: true,
} as const;

export interface PipelineJob {
  jobId: string;
  serviceId: string;
  briefText: string;
  outputDir: string;
}

export interface StageArtifact {
  kind: string;
  uri: string;
  mimeType: string;
  meta?: Record<string, unknown>;
}

export interface PipelineResult {
  stages: PipelineStage[];
  artifacts: StageArtifact[];
  logs: string[];
}

export interface RemotionComposition {
  id: string;
  props: Record<string, unknown>;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
}

export interface RemotionRenderRequest {
  composition: RemotionComposition;
  outputPath: string;
  remotionRoot?: string;
}

export interface RemotionRenderResult {
  rendered: boolean;
  outputPath: string;
  usedCli: boolean;
  manifestPath?: string;
  message: string;
}

export async function runPipeline(job: PipelineJob): Promise<PipelineResult> {
  const logs: string[] = [];
  const artifacts: StageArtifact[] = [];
  await mkdir(job.outputDir, { recursive: true });

  logs.push("plan: derived stage graph");
  const planPath = path.join(job.outputDir, "plan.json");
  const plan = {
    jobId: job.jobId,
    serviceId: job.serviceId,
    stages: ["generate", "compose", "normalize"],
    briefPreview: job.briefText.slice(0, 240),
  };
  await writeFile(planPath, JSON.stringify(plan, null, 2), "utf8");
  artifacts.push({ kind: "plan", uri: planPath, mimeType: "application/json", meta: plan });

  logs.push("generate: producing draft content");
  const generated = await generateContent(job);
  artifacts.push(...generated);

  logs.push("compose: assembling deliverable");
  let composed = await composeDeliverable(job, generated);
  // Hard guarantee: image jobs must ship an SVG creative even if compose routing drifts.
  const sid = String(job.serviceId ?? "")
    .toLowerCase()
    .trim();
  if (sid === "image" && !composed.some((a) => a.kind === "image")) {
    logs.push("compose: image SVG guarantee");
    composed = await composeImageDeliverable(job, generated);
  }
  artifacts.push(...composed);

  logs.push("normalize: packaging outputs");
  const normalized = await normalizePack(job, [...artifacts, ...composed]);
  artifacts.push(...normalized);

  return {
    stages: ["plan", "generate", "compose", "normalize"],
    artifacts,
    logs,
  };
}

async function generateContent(job: PipelineJob): Promise<StageArtifact[]> {
  const env = loadEnv();
  const draftPath = path.join(job.outputDir, "draft.md");
  let body = `# ${job.serviceId} draft\n\n${job.briefText}\n`;
  let providerMeta: Record<string, unknown> = { provider: "local-fallback" };

  if (!isAiConfigured(env)) {
    if (env.AI_REQUIRE_REAL) {
      throw new Error("AI_REQUIRE_REAL=true but AI_API_KEY / AI_BASE_URL are missing");
    }
  } else {
    try {
      const result = await chatForRole(
        "generator",
        [
          {
            role: "system",
            content:
              "You are Beacon's first-party generator. Produce concise, on-brief draft content for the requested deliverable. Use markdown.",
          },
          {
            role: "user",
            content: `Service: ${job.serviceId}\n\nBrief:\n${job.briefText}`,
          },
        ],
        { temperature: 0.4, maxTokens: 2048, env },
      );
      body = result.content;
      providerMeta = {
        provider: "agentrouter",
        model: result.model,
        latencyMs: result.latencyMs,
        role: "generator",
      };
    } catch (err) {
      // Image/video drafts are companions — never block Flux/ffmpeg on AgentRouter outages.
      const mediaSoft =
        ["image", "video"].includes(String(job.serviceId).toLowerCase()) ||
        (env.MEDIA_FAST || "").toLowerCase() === "true";
      if (env.AI_REQUIRE_REAL && !mediaSoft) throw err;
      providerMeta = {
        provider: "local-fallback",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  await writeFile(draftPath, body, "utf8");
  return [{ kind: "draft", uri: draftPath, mimeType: "text/markdown", meta: providerMeta }];
}

async function composeDeliverable(
  job: PipelineJob,
  inputs: StageArtifact[],
): Promise<StageArtifact[]> {
  const sid = String(job.serviceId ?? "")
    .toLowerCase()
    .trim();
  console.log("[pipeline] compose", job.jobId, JSON.stringify(job.serviceId), "→", sid);

  if (sid === "image") {
    return composeImageDeliverable(job, inputs);
  }

  if (sid === "video") {
    return composeVideoDeliverable(job, inputs);
  }

  const packPath = path.join(job.outputDir, "deliverable.md");
  const draftUri = inputs.find((a) => a.kind === "draft")?.uri;
  let body = "";
  if (draftUri) {
    try {
      body = await readFile(draftUri, "utf8");
    } catch {
      body = "";
    }
  }
  if (!body.trim()) {
    body = `# ${job.serviceId}\n\n${job.briefText}\n`;
  }
  await writeFile(
    packPath,
    `${body.trim()}\n\n---\n\n_Delivered by Beacon · service \`${job.serviceId}\`_\n`,
    "utf8",
  );
  return [{ kind: "document", uri: packPath, mimeType: "text/markdown" }];
}

async function composeImageDeliverable(
  job: PipelineJob,
  _inputs: StageArtifact[],
): Promise<StageArtifact[]> {
  const briefPath = path.join(job.outputDir, "image-brief.md");

  // Pro cascade: prompt-engineer (Opus/GPT-5.6) → ComfyUI → HF FLUX → Pollinations
  try {
    const img = await generateProImage(job.briefText, { width: 1280, height: 1280 });
    const ext = img.mimeType.includes("png") ? "png" : "jpg";
    const imagePath = path.join(job.outputDir, `creative.${ext}`);
    await writeFile(imagePath, img.bytes);
    const promptPath = path.join(job.outputDir, "engineered-prompt.json");
    await writeFile(promptPath, JSON.stringify(img.engineered, null, 2), "utf8");
    await writeFile(
      briefPath,
      [
        `# Image creative`,
        ``,
        job.briefText,
        ``,
        `_Provider: **${img.provider}**${img.model ? ` · ${img.model}` : ""} · ${img.latencyMs}ms_`,
        `_Prompt engineer: ${img.engineered.source} (${img.engineered.model})_`,
        ``,
        `## Engineered prompt`,
        ``,
        img.engineered.prompt,
        ``,
      ].join("\n"),
      "utf8",
    );
    return [
      {
        kind: "image",
        uri: imagePath,
        mimeType: img.mimeType,
        meta: {
          generator: img.provider,
          model: img.model,
          size: "1280x1280",
          latencyMs: img.latencyMs,
          promptSource: img.engineered.source,
        },
      },
      {
        kind: "document",
        uri: briefPath,
        mimeType: "text/markdown",
        meta: { companion: true },
      },
      {
        kind: "prompt",
        uri: promptPath,
        mimeType: "application/json",
        meta: { companion: true, kind: "engineered_prompt" },
      },
    ];
  } catch (err) {
    console.warn(
      "[pipeline] pro image cascade failed, professional logo/SVG fallback:",
      err instanceof Error ? err.message : err,
    );
  }

  if (looksLikeLogoBrief(job.briefText)) {
    const logo = buildProfessionalLogoSvg(job.briefText, { width: 1280, height: 1280 });
    const svgPath = path.join(job.outputDir, "creative.svg");
    await writeFile(svgPath, logo.svg, "utf8");
    await writeFile(
      briefPath,
      `# Image creative\n\n${job.briefText}\n\n_Brand mark: **${logo.brand}** · vector SVG (raster providers unavailable — Cloudflare/HF/Pollinations)._\n`,
      "utf8",
    );
    return [
      {
        kind: "image",
        uri: svgPath,
        mimeType: "image/svg+xml",
        meta: { generator: "beacon-logo-svg", brand: logo.brand, size: "1280x1280" },
      },
      { kind: "document", uri: briefPath, mimeType: "text/markdown", meta: { companion: true } },
    ];
  }

  const title = (job.briefText.slice(0, 48) || "Beacon creative")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const svgPath = path.join(job.outputDir, "creative.svg");
  const svg = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="1280" viewBox="0 0 1280 1280">',
    "<defs>",
    '<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">',
    '<stop offset="0%" stop-color="#f7f4ef"/>',
    '<stop offset="100%" stop-color="#ebe6de"/>',
    "</linearGradient>",
    "</defs>",
    '<rect width="1280" height="1280" fill="url(#g)"/>',
    '<circle cx="640" cy="520" r="168" fill="#39e08a"/>',
    '<path d="M640 360 L730 590 L640 690 L550 590 Z" fill="#1f1c28"/>',
    `<text x="640" y="860" text-anchor="middle" font-family="Georgia, serif" font-size="42" fill="#1f1c28">${title}</text>`,
    '<text x="640" y="920" text-anchor="middle" font-family="monospace" font-size="18" fill="#6b6575">Set CF_ACCOUNT_ID + CF_API_TOKEN for Flux output</text>',
    "</svg>",
  ].join("");
  await writeFile(svgPath, svg, "utf8");
  await writeFile(
    briefPath,
    `# Image creative\n\n${job.briefText}\n\n_No raster provider available. Configure **CF_ACCOUNT_ID** + **CF_API_TOKEN** (Workers AI Flux) or **HF_TOKEN**. See MEDIA.md._\n`,
    "utf8",
  );
  return [
    {
      kind: "image",
      uri: svgPath,
      mimeType: "image/svg+xml",
      meta: { generator: "beacon-svg", size: "1280x1280" },
    },
    { kind: "document", uri: briefPath, mimeType: "text/markdown", meta: { companion: true } },
  ];
}

async function composeVideoDeliverable(
  job: PipelineJob,
  inputs: StageArtifact[],
): Promise<StageArtifact[]> {
  const env = loadEnv();
  const provider = (env.VIDEO_PROVIDER || "auto").toLowerCase();
  const draftUri = inputs.find((a) => a.kind === "draft")?.uri ?? "";

  const engineered = await engineerVideoShots(job.briefText, env);
  const promptPath = path.join(job.outputDir, "engineered-video-prompt.json");
  await writeFile(promptPath, JSON.stringify(engineered, null, 2), "utf8");

  const manifestPath = path.join(job.outputDir, "composition.manifest.json");
  const manifest: RemotionComposition = {
    id: "BeaconPack",
    props: {
      title: job.briefText.slice(0, 80),
      body: draftUri,
      engineered,
      openmontage: env.OPENMONTAGE_ROOT || null,
      toolkit: env.VIDEO_TOOLKIT_ROOT || null,
    },
    durationInFrames: 450,
    fps: 30,
    width: 1080,
    height: 1920,
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  const artifacts: StageArtifact[] = [
    {
      kind: "composition_manifest",
      uri: manifestPath,
      mimeType: "application/json",
      meta: { provider, promptSource: engineered.source },
    },
    {
      kind: "prompt",
      uri: promptPath,
      mimeType: "application/json",
      meta: { companion: true, kind: "engineered_prompt" },
    },
  ];

  // 1) Remotion / OpenMontage / video-toolkit when roots are present
  if (provider === "remotion" || provider === "auto") {
    const videoOut = path.join(job.outputDir, "output.mp4");
    const render = await renderRemotion({
      composition: manifest,
      outputPath: videoOut,
      remotionRoot: env.OPENMONTAGE_ROOT || env.VIDEO_TOOLKIT_ROOT || undefined,
    });
    if (render.rendered) {
      artifacts.push({
        kind: "video",
        uri: render.outputPath,
        mimeType: "video/mp4",
        meta: { durationSeconds: 15, generator: "remotion", render },
      });
      return artifacts;
    }
    artifacts[0]!.meta = { ...(artifacts[0]!.meta ?? {}), remotion: render };
  }

  // 2) Pro stills (same cascade as images) → ffmpeg-static zoom/xfade MP4
  // Keep 2 beats for latency — Opus engineering can still return 3; we take first 2.
  const shotsRaw =
    engineered.shotList?.length ?
      engineered.shotList
    : [
        { beat: "Hook", seconds: 4, prompt: engineered.prompt },
        { beat: "Promise", seconds: 5, prompt: engineered.prompt },
        { beat: "CTA", seconds: 4, prompt: engineered.prompt },
      ];
  const shots = shotsRaw.slice(0, 2);

  const framePaths: Array<{ filePath: string; seconds: number; beat: string }> = [];
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i]!;
    try {
      const img = await generateProImage(shot.prompt, { width: 1080, height: 1920 });
      const framePath = path.join(job.outputDir, `frame-${i + 1}.jpg`);
      await writeFile(framePath, img.bytes);
      framePaths.push({ filePath: framePath, seconds: shot.seconds, beat: shot.beat });
      artifacts.push({
        kind: "image",
        uri: framePath,
        mimeType: img.mimeType,
        meta: {
          generator: img.provider,
          model: img.model,
          beat: shot.beat,
          at: shot.seconds,
          // First frame is always a primary deliverable; extras are companions.
          companion: i > 0,
        },
      });
    } catch (err) {
      console.warn(
        "[pipeline] video still failed",
        shot.beat,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const videoOut = path.join(job.outputDir, "output.mp4");
  if (framePaths.length >= 1) {
    const assembled = await assembleProVideoFromStills(framePaths, videoOut);
    if (assembled.ok) {
      artifacts.push({
        kind: "video",
        uri: videoOut,
        mimeType: "video/mp4",
        meta: {
          durationSeconds: framePaths.reduce((s, f) => s + f.seconds, 0),
          generator: "pro-stills+ffmpeg",
          frames: framePaths.length,
          message: assembled.message,
        },
      });
    } else {
      artifacts[0]!.meta = {
        ...(artifacts[0]!.meta ?? {}),
        ffmpeg: assembled.message,
      };
    }
  }

  const storyboardPath = path.join(job.outputDir, "storyboard.json");
  await writeFile(
    storyboardPath,
    JSON.stringify(
      {
        kind: "video_storyboard",
        title: job.briefText.slice(0, 80),
        durationSeconds: framePaths.reduce((s, f) => s + f.seconds, 0) || 15,
        fps: 30,
        shots: shots.map((s, i) => ({
          beat: s.beat,
          seconds: s.seconds,
          onScreen: s.prompt.slice(0, 140),
          frame: framePaths[i] ? path.basename(framePaths[i]!.filePath) : null,
        })),
        scriptUri: draftUri,
        renderStatus: artifacts.some((a) => a.kind === "video") ? "mp4_ready" : "stills_or_manifest",
        openmontage: "Use /openmontage cinematic or animation pipeline for GPU Wan/LTX packs.",
        agentDemoVideo: "Use /agent-demo-video for Beacon product film with Remotion toolkit.",
      },
      null,
      2,
    ),
    "utf8",
  );
  artifacts.push({
    kind: "storyboard",
    uri: storyboardPath,
    mimeType: "application/json",
    meta: { durationSeconds: 15, companion: true },
  });

  const captionsPath = path.join(job.outputDir, "captions.md");
  await writeFile(
    captionsPath,
    `# Captions\n\n${job.briefText}\n\n## Beats\n\n${shots
      .map((s) => `- ${s.beat} (${s.seconds}s)`)
      .join("\n")}\n\n_Prompt engineer: ${engineered.source}. Full Remotion/OpenMontage when roots configured._\n`,
    "utf8",
  );

  const hasPrimaryMedia = artifacts.some(
    (a) =>
      (a.kind === "video" || a.kind === "image") &&
      !(a.meta && typeof a.meta === "object" && (a.meta as { companion?: boolean }).companion),
  );

  // Never ship video jobs with only companion JSON — L1 would fail "No deliverables".
  artifacts.push({
    kind: "captions",
    uri: captionsPath,
    mimeType: "text/markdown",
    meta: hasPrimaryMedia ? { companion: true } : { role: "fallback_pack" },
  });

  return artifacts;
}

async function normalizePack(job: PipelineJob, artifacts: StageArtifact[]): Promise<StageArtifact[]> {
  const indexPath = path.join(job.outputDir, "artifact-index.json");
  const index = {
    jobId: job.jobId,
    generatedAt: new Date().toISOString(),
    artifacts,
  };
  await writeFile(indexPath, JSON.stringify(index, null, 2), "utf8");
  return [{ kind: "index", uri: indexPath, mimeType: "application/json" }];
}

export async function renderRemotion(req: RemotionRenderRequest): Promise<RemotionRenderResult> {
  const manifestPath = path.join(path.dirname(req.outputPath), "composition.manifest.json");
  await writeFile(manifestPath, JSON.stringify(req.composition, null, 2), "utf8");

  const cli = await whichRemotionCli();
  if (!cli) {
    return {
      rendered: false,
      outputPath: req.outputPath,
      usedCli: false,
      manifestPath,
      message:
        "Remotion CLI not found. Wrote composition manifest; install Remotion or set OPENMONTAGE_ROOT.",
    };
  }

  const args = [
    cli,
    "render",
    req.composition.id,
    req.outputPath,
    "--props",
    JSON.stringify(req.composition.props),
  ];

  const code = await runCommand("node", args, req.remotionRoot);
  return {
    rendered: code === 0,
    outputPath: req.outputPath,
    usedCli: true,
    manifestPath,
    message: code === 0 ? "Rendered with Remotion CLI." : "Remotion CLI exited with errors.",
  };
}

async function whichRemotionCli(): Promise<string | null> {
  const candidates = ["remotion", "npx"];
  for (const bin of candidates) {
    try {
      await access(bin, constants.X_OK);
      return bin;
    } catch {
      // continue
    }
  }
  return null;
}

function runCommand(cmd: string, args: string[], cwd?: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, shell: true, stdio: "ignore" });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

export async function runOpenMontageStageGraph(
  _job: PipelineJob,
  stageScript?: string,
): Promise<{ ok: boolean; message: string }> {
  const env = loadEnv();
  const root = env.OPENMONTAGE_ROOT;
  if (!root) {
    return { ok: true, message: "OpenMontage root not configured; using internal stage runner." };
  }
  const script = stageScript ?? path.join(root, "package.json");
  try {
    await access(script, constants.F_OK);
    return { ok: true, message: `OpenMontage available at ${root}` };
  } catch {
    return { ok: true, message: "OpenMontage path set but entry not found; continuing with internal runner." };
  }
}
