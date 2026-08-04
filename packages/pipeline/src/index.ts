import { mkdir, writeFile, access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  chatForRole,
  generatePollinationsImage,
  isAiConfigured,
  isPollinationsConfigured,
  loadEnv,
} from "@beacon/shared";

export type PipelineStage = "plan" | "generate" | "compose" | "normalize";

/** Bumped when deliverable composers change — exposed via /health for deploy proof. */
export const PIPELINE_CAPS = {
  version: "2026-08-04-pollinations-media",
  imageSvg: true,
  imagePollinations: true,
  videoStoryboard: true,
  videoPollinationsStills: true,
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
      if (env.AI_REQUIRE_REAL) throw err;
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
  inputs: StageArtifact[],
): Promise<StageArtifact[]> {
  const env = loadEnv();
  const briefPath = path.join(job.outputDir, "image-brief.md");
  const prompt =
    job.briefText.trim() ||
    "Minimal mint Beacon mark on warm paper, flat vector creative, green accent";

  // 1) Free Pollinations JPEG (works without AgentRouter image entitlements)
  if (isPollinationsConfigured(env)) {
    try {
      const img = await generatePollinationsImage(
        { prompt, width: 1024, height: 1024, model: env.POLLINATIONS_MODEL || "flux" },
        env,
      );
      const ext = img.mimeType.includes("png") ? "png" : "jpg";
      const imagePath = path.join(job.outputDir, `creative.${ext}`);
      await writeFile(imagePath, img.bytes);
      await writeFile(
        briefPath,
        `# Image creative\n\n${job.briefText}\n\n_Generated via Pollinations (${img.model}) · ${img.latencyMs}ms._\n`,
        "utf8",
      );
      return [
        {
          kind: "image",
          uri: imagePath,
          mimeType: img.mimeType,
          meta: {
            generator: "pollinations",
            model: img.model,
            size: "1024x1024",
            latencyMs: img.latencyMs,
          },
        },
        { kind: "document", uri: briefPath, mimeType: "text/markdown", meta: { companion: true } },
      ];
    } catch (err) {
      console.warn(
        "[pipeline] Pollinations image failed, falling back to SVG:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  // 2) Honest SVG fallback when free image APIs are unavailable
  const title = (job.briefText.slice(0, 48) || "Beacon creative")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const svgPath = path.join(job.outputDir, "creative.svg");
  const svg = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">',
    '<rect width="1024" height="1024" fill="#f4f3f1"/>',
    '<circle cx="512" cy="420" r="140" fill="#39e08a"/>',
    '<path d="M512 300 L580 480 L512 560 L444 480 Z" fill="#2a2735"/>',
    `<text x="512" y="680" text-anchor="middle" font-family="Georgia, serif" font-size="36" fill="#2a2735">${title}</text>`,
    '<text x="512" y="740" text-anchor="middle" font-family="monospace" font-size="18" fill="#6b6575">Beacon · Image · fallback SVG</text>',
    "</svg>",
  ].join("");
  await writeFile(svgPath, svg, "utf8");
  await writeFile(
    briefPath,
    `# Image creative\n\n${job.briefText}\n\n_SVG fallback (Pollinations / AgentRouter image unavailable)._\n`,
    "utf8",
  );

  return [
    {
      kind: "image",
      uri: svgPath,
      mimeType: "image/svg+xml",
      meta: { generator: "beacon-svg", size: "1024x1024" },
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

  const manifestPath = path.join(job.outputDir, "composition.manifest.json");
  const manifest: RemotionComposition = {
    id: "BeaconPack",
    props: {
      title: job.briefText.slice(0, 80),
      body: draftUri,
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
      meta: { provider },
    },
  ];

  // 1) Remotion / OpenMontage when available (local toolkit or REMOTION_ENABLED)
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

  // 2) Free Pollinations stills → optional ffmpeg slideshow MP4
  const shots = [
    { at: 0, beat: "Hook", prompt: `${job.briefText.slice(0, 160)}, cinematic opening frame` },
    {
      at: 8,
      beat: "CTA",
      prompt: `Beacon desk call to action, Start a job, pay only when it passes, ${job.briefText.slice(0, 80)}`,
    },
  ];

  const framePaths: string[] = [];
  if (provider === "pollinations-stills" || provider === "auto" || provider === "storyboard") {
    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i]!;
      try {
        // Respect anonymous Pollinations rate limit (~15s)
        if (i > 0) await new Promise((r) => setTimeout(r, 16_000));
        const img = await generatePollinationsImage(
          {
            prompt: shot.prompt,
            width: 1080,
            height: 1920,
            model: env.POLLINATIONS_MODEL || "flux",
          },
          env,
        );
        const framePath = path.join(job.outputDir, `frame-${i + 1}.jpg`);
        await writeFile(framePath, img.bytes);
        framePaths.push(framePath);
        artifacts.push({
          kind: "image",
          uri: framePath,
          mimeType: img.mimeType,
          meta: {
            generator: "pollinations",
            beat: shot.beat,
            at: shot.at,
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
  }

  const videoOut = path.join(job.outputDir, "output.mp4");
  if (framePaths.length >= 2) {
    const slideshow = await renderSlideshowMp4(framePaths, videoOut);
    if (slideshow.ok) {
      artifacts.push({
        kind: "video",
        uri: videoOut,
        mimeType: "video/mp4",
        meta: {
          durationSeconds: framePaths.length * 5,
          generator: "pollinations-stills+ffmpeg",
          frames: framePaths.length,
        },
      });
    }
  }

  const storyboardPath = path.join(job.outputDir, "storyboard.json");
  const storyboard = {
    kind: "video_storyboard",
    title: job.briefText.slice(0, 80),
    durationSeconds: 15,
    fps: 30,
    shots: shots.map((s, i) => ({
      at: s.at,
      beat: s.beat,
      onScreen: s.prompt.slice(0, 120),
      frame: framePaths[i] ? path.basename(framePaths[i]!) : null,
    })),
    scriptUri: draftUri,
    renderStatus: artifacts.some((a) => a.kind === "video") ? "mp4_ready" : "stills_or_manifest",
    openmontage: "Use /openmontage or VIDEO_TOOLKIT_ROOT for full Remotion packs locally.",
  };
  await writeFile(storyboardPath, JSON.stringify(storyboard, null, 2), "utf8");
  artifacts.push({
    kind: "storyboard",
    uri: storyboardPath,
    mimeType: "application/json",
    meta: { durationSeconds: 15, companion: true },
  });

  const captionsPath = path.join(job.outputDir, "captions.md");
  await writeFile(
    captionsPath,
    `# Captions\n\n${job.briefText}\n\n## Beats\n\n- 0s Hook\n- 5s Promise\n- 10s CTA\n\n_Frames via Pollinations · Remotion via OpenMontage when configured._\n`,
    "utf8",
  );
  artifacts.push({
    kind: "captions",
    uri: captionsPath,
    mimeType: "text/markdown",
    meta: { companion: true },
  });

  return artifacts;
}

async function renderSlideshowMp4(
  framePaths: string[],
  outputPath: string,
): Promise<{ ok: boolean; message: string }> {
  const listPath = path.join(path.dirname(outputPath), "frames.txt");
  const listBody = framePaths
    .map((f) => `file '${f.replace(/\\/g, "/")}'\nduration 5`)
    .join("\n");
  // last frame needs a trailing file line for concat demuxer
  const last = framePaths[framePaths.length - 1]!.replace(/\\/g, "/");
  await writeFile(listPath, `${listBody}\nfile '${last}'\n`, "utf8");

  const code = await runCommand("ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-vsync",
    "vfr",
    "-pix_fmt",
    "yuv420p",
    outputPath,
  ]);
  if (code === 0) return { ok: true, message: "ffmpeg slideshow ok" };
  return { ok: false, message: `ffmpeg exit ${code}` };
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
