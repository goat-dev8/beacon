import { mkdir, writeFile, access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { chatForRole, isAiConfigured, loadEnv } from "@beacon/shared";

export type PipelineStage = "plan" | "generate" | "compose" | "normalize";

/** Bumped when deliverable composers change — exposed via /health for deploy proof. */
export const PIPELINE_CAPS = {
  version: "2026-08-04-image-svg",
  imageSvg: true,
  videoStoryboard: true,
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
  const composed = await composeDeliverable(job, generated);
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
  if (job.serviceId === "image") {
    return composeImageDeliverable(job, inputs);
  }

  if (job.serviceId === "video") {
    const manifestPath = path.join(job.outputDir, "composition.manifest.json");
    const manifest: RemotionComposition = {
      id: "BeaconPack",
      props: {
        title: job.briefText.slice(0, 80),
        body: inputs.find((a) => a.kind === "draft")?.uri ?? "",
      },
      durationInFrames: 450,
      fps: 30,
      width: 1080,
      height: 1920,
    };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    const videoOut = path.join(job.outputDir, "output.mp4");
    const render = await renderRemotion({
      composition: manifest,
      outputPath: videoOut,
      remotionRoot: loadEnv().OPENMONTAGE_ROOT || undefined,
    });

    const artifacts: StageArtifact[] = [
      {
        kind: "composition_manifest",
        uri: manifestPath,
        mimeType: "application/json",
        meta: { render },
      },
    ];

    if (render.rendered) {
      artifacts.push({
        kind: "video",
        uri: render.outputPath,
        mimeType: "video/mp4",
        meta: { durationSeconds: 15 },
      });
    } else {
      // Remotion unavailable: still ship a reviewable storyboard pack (not a fake MP4).
      const storyboardPath = path.join(job.outputDir, "storyboard.json");
      const draftUri = inputs.find((a) => a.kind === "draft")?.uri ?? "";
      const storyboard = {
        kind: "video_storyboard",
        title: job.briefText.slice(0, 80),
        durationSeconds: 15,
        fps: 30,
        shots: [
          { at: 0, beat: "Hook", onScreen: job.briefText.slice(0, 120) },
          { at: 5, beat: "Promise", onScreen: "Finish AI work. Pay only when it passes." },
          { at: 10, beat: "CTA", onScreen: "Open Beacon → Start a job" },
        ],
        scriptUri: draftUri,
        renderStatus: "manifest_only",
        message: render.message,
      };
      await writeFile(storyboardPath, JSON.stringify(storyboard, null, 2), "utf8");
      artifacts.push({
        kind: "storyboard",
        uri: storyboardPath,
        mimeType: "application/json",
        meta: { durationSeconds: 15, render },
      });
      const captionsPath = path.join(job.outputDir, "captions.md");
      await writeFile(
        captionsPath,
        `# Captions\n\n${job.briefText}\n\n## Beats\n\n- 0s Hook\n- 5s Promise\n- 10s CTA\n`,
        "utf8",
      );
      artifacts.push({
        kind: "captions",
        uri: captionsPath,
        mimeType: "text/markdown",
        meta: { companion: true },
      });
    }

    return artifacts;
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
  const title = job.briefText.slice(0, 72).replace(/[<>&]/g, "") || "Beacon creative";
  const draftUri = inputs.find((a) => a.kind === "draft")?.uri;
  let notes = "";
  if (draftUri) {
    try {
      notes = (await readFile(draftUri, "utf8")).slice(0, 400);
    } catch {
      notes = "";
    }
  }

  // AgentRouter blocks /v1/images/generations (403). Ship a real SVG creative
  // so Image jobs return a visible asset — not a markdown path list.
  const svgPath = path.join(job.outputDir, "creative.svg");
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" role="img" aria-label="${title}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f4f3f1"/>
      <stop offset="100%" stop-color="#e8f8ef"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <g fill="none" stroke="#2a2735" stroke-width="2" opacity="0.12">
    ${Array.from({ length: 8 }, (_, i) => {
      const x = 80 + i * 120;
      return `<path d="M${x} 40 V984"/><path d="M40 ${x} H984"/>`;
    }).join("")}
  </g>
  <circle cx="512" cy="420" r="120" fill="#39e08a" opacity="0.9"/>
  <path d="M512 320 L560 460 L512 520 L464 460 Z" fill="#2a2735"/>
  <text x="512" y="620" text-anchor="middle" font-family="Georgia, serif" font-size="42" fill="#2a2735">${title.slice(0, 40)}</text>
  <text x="512" y="680" text-anchor="middle" font-family="ui-monospace, monospace" font-size="18" fill="#6b6575">Beacon · Image · Flare Coston2</text>
  <text x="80" y="900" font-family="ui-monospace, monospace" font-size="14" fill="#6b6575">${notes.replace(/[<>&"']/g, " ").slice(0, 90)}</text>
</svg>`;
  await writeFile(svgPath, svg, "utf8");

  const briefPath = path.join(job.outputDir, "image-brief.md");
  await writeFile(
    briefPath,
    `# Image creative\n\n${job.briefText}\n\n## Notes\n\n${notes || "_Generated visual pack (SVG). External PNG APIs were unavailable._"}\n`,
    "utf8",
  );

  return [
    { kind: "image", uri: svgPath, mimeType: "image/svg+xml", meta: { generator: "beacon-svg", size: "1024x1024" } },
    { kind: "document", uri: briefPath, mimeType: "text/markdown", meta: { companion: true } },
  ];
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
