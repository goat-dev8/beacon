import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export interface ProVideoFrame {
  filePath: string;
  seconds: number;
  beat: string;
}

export interface ProVideoResult {
  ok: boolean;
  outputPath: string;
  message: string;
  ffmpegPath?: string;
}

function resolveFfmpeg(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("ffmpeg-static") as string | null;
    if (mod) return mod;
  } catch {
    /* optional dep */
  }
  return process.env.FFMPEG_PATH || null;
}

function mediaFast(): boolean {
  return (process.env.MEDIA_FAST || "").toLowerCase() === "true";
}

/**
 * Build a vertical MP4 from stills.
 * MEDIA_FAST / Render free tier: lightweight scale+hold (no zoompan) so health checks stay alive.
 * Full quality: gentle zoom + crossfades.
 */
export async function assembleProVideoFromStills(
  frames: ProVideoFrame[],
  outputPath: string,
): Promise<ProVideoResult> {
  if (frames.length === 0) {
    return { ok: false, outputPath, message: "no frames" };
  }
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) {
    return { ok: false, outputPath, message: "ffmpeg-static not installed" };
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  const work = path.dirname(outputPath);
  const fast = mediaFast();
  const w = fast ? 720 : 1080;
  const h = fast ? 1280 : 1920;
  const fps = fast ? 24 : 30;
  const preset = fast ? "ultrafast" : "veryfast";
  const crf = fast ? "26" : "18";

  if (fast || frames.length === 1) {
    const frame = frames[0]!;
    const dur = Math.min(6, Math.max(3, frame.seconds || 4));
    const code = await run(ffmpeg, [
      "-y",
      "-loop",
      "1",
      "-i",
      frame.filePath,
      "-t",
      String(dur),
      "-vf",
      `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=${fps}`,
      "-c:v",
      "libx264",
      "-preset",
      preset,
      "-crf",
      crf,
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-an",
      outputPath,
    ]);
    return {
      ok: code === 0,
      outputPath,
      message: code === 0 ? (fast ? "fast-hold ok" : "single-hold ok") : "encode failed",
      ffmpegPath: ffmpeg,
    };
  }

  // Full path: zoom clips + xfade (local / paid CPU only)
  const clipPaths: string[] = [];
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!;
    const clip = path.join(work, `clip-${i}.mp4`);
    const dur = Math.max(2, frame.seconds);
    const framesCount = Math.round(dur * fps);
    const code = await run(ffmpeg, [
      "-y",
      "-loop",
      "1",
      "-i",
      frame.filePath,
      "-vf",
      `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},zoompan=z='min(zoom+0.0008,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${framesCount}:s=${w}x${h}:fps=${fps}`,
      "-t",
      String(dur),
      "-pix_fmt",
      "yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      preset,
      "-crf",
      crf,
      clip,
    ]);
    if (code !== 0) {
      return { ok: false, outputPath, message: `clip encode failed ${i}`, ffmpegPath: ffmpeg };
    }
    clipPaths.push(clip);
  }

  const inputs: string[] = [];
  for (const c of clipPaths) inputs.push("-i", c);
  const fade = 0.6;
  let filter = "";
  let last = "[0:v]";
  let offset = 0;
  for (let i = 1; i < clipPaths.length; i++) {
    offset += Math.max(1, frames[i - 1]!.seconds) - fade;
    const out = i === clipPaths.length - 1 ? "[vout]" : `[v${i}]`;
    filter += `${last}[${i}:v]xfade=transition=fade:duration=${fade}:offset=${offset.toFixed(2)}${out};`;
    last = out;
  }
  filter = filter.replace(/;$/, "");

  const code = await run(ffmpeg, [
    "-y",
    ...inputs,
    "-filter_complex",
    filter,
    "-map",
    "[vout]",
    "-pix_fmt",
    "yuv420p",
    "-c:v",
    "libx264",
    "-preset",
    preset,
    "-crf",
    crf,
    "-movflags",
    "+faststart",
    outputPath,
  ]);

  if (code !== 0) {
    const listPath = path.join(work, "concat.txt");
    await writeFile(
      listPath,
      clipPaths.map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n") + "\n",
      "utf8",
    );
    const code2 = await run(ffmpeg, [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      outputPath,
    ]);
    return {
      ok: code2 === 0,
      outputPath,
      message: code2 === 0 ? "concat fallback ok" : "assemble failed",
      ffmpegPath: ffmpeg,
    };
  }

  return { ok: true, outputPath, message: "xfade ok", ffmpegPath: ffmpeg };
}

function run(bin: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: "ignore" });
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
  });
}
