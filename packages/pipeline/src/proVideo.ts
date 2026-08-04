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
 * Build a vertical MP4 with visible motion from stills.
 * - Each still gets a light pan (crop-on-t) — cheaper than zoompan, enough to feel like video.
 * - 2+ stills get a crossfade so scenes change (cat → dog, hook → action).
 * MEDIA_FAST uses 720×1280 + ultrafast so Render free-tier health stays alive.
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
  const crf = fast ? "24" : "18";

  const clipPaths: string[] = [];
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!;
    const clip = path.join(work, `clip-${i}.mp4`);
    const dur = Math.min(fast ? 3.2 : 5, Math.max(2.4, frame.seconds || 3));
    // Oversample then pan crop over time — real motion without zoompan CPU blowup.
    const scaleW = Math.round(w * 1.18);
    const scaleH = Math.round(h * 1.18);
    const panX = i % 2 === 0 ? `'min(${scaleW - w},t*${fast ? 14 : 18})'` : `'max(0,${scaleW - w}-t*${fast ? 14 : 18})'`;
    const panY = i % 2 === 0 ? `'min(${scaleH - h},t*${fast ? 8 : 10})'` : `'max(0,${scaleH - h}-t*${fast ? 8 : 10})'`;
    const code = await run(ffmpeg, [
      "-y",
      "-loop",
      "1",
      "-i",
      frame.filePath,
      "-t",
      String(dur),
      "-vf",
      `scale=${scaleW}:${scaleH}:force_original_aspect_ratio=increase,crop=${w}:${h}:${panX}:${panY},fps=${fps}`,
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
      clip,
    ]);
    if (code !== 0) {
      return { ok: false, outputPath, message: `motion clip failed ${i}`, ffmpegPath: ffmpeg };
    }
    clipPaths.push(clip);
    // Yield event loop between encodes (Render health).
    await new Promise((r) => setImmediate(r));
  }

  if (clipPaths.length === 1) {
    const code = await run(ffmpeg, [
      "-y",
      "-i",
      clipPaths[0]!,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      outputPath,
    ]);
    return {
      ok: code === 0,
      outputPath,
      message: code === 0 ? "single-pan ok" : "single-pan copy failed",
      ffmpegPath: ffmpeg,
    };
  }

  const fade = fast ? 0.45 : 0.6;
  const inputs: string[] = [];
  for (const c of clipPaths) inputs.push("-i", c);

  let filter: string;
  if (clipPaths.length === 2) {
    // Clip duration ≈ 3.2s on fast path → crossfade near end of first clip.
    const offset = fast ? 2.7 : Math.max(1.5, (frames[0]!.seconds || 4) - fade);
    filter = `[0:v][1:v]xfade=transition=fade:duration=${fade}:offset=${offset.toFixed(2)}[vout]`;
  } else {
    let chain = "";
    let last = "[0:v]";
    let offset = 0;
    for (let i = 1; i < clipPaths.length; i++) {
      offset += Math.max(2, frames[i - 1]!.seconds || 3) - fade;
      const out = i === clipPaths.length - 1 ? "[vout]" : `[v${i}]`;
      chain += `${last}[${i}:v]xfade=transition=fade:duration=${fade}:offset=${offset.toFixed(2)}${out};`;
      last = out;
    }
    filter = chain.replace(/;$/, "");
  }

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
    "-an",
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
      "-preset",
      preset,
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-an",
      outputPath,
    ]);
    return {
      ok: code2 === 0,
      outputPath,
      message: code2 === 0 ? "concat motion ok" : "assemble failed",
      ffmpegPath: ffmpeg,
    };
  }

  return { ok: true, outputPath, message: "pan+xfade ok", ffmpegPath: ffmpeg };
}

function run(bin: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: "ignore" });
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
  });
}
