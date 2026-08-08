import "dotenv/config";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runPipeline } from "@beacon/pipeline";

const brief =
  "Create a simple calculator program in Python that takes two numbers and a math operator (+, -, *, /) as input from the user, performs the calculation using conditional statements, and prints the result clearly";
const outputDir = await mkdtemp(path.join(os.tmpdir(), "beacon-coding-probe-"));

try {
  const result = await runPipeline({
    jobId: "probe-coding",
    serviceId: "coding",
    briefText: brief,
    outputDir,
  });
  const code = result.artifacts.find((artifact) => artifact.kind === "code");
  if (!code) throw new Error("No code artifact produced.");
  const source = await readFile(code.uri, "utf8");
  if (!/input\s*\(/.test(source) || !/print\s*\(/.test(source) || !/\bif\b/.test(source)) {
    throw new Error("Generated calculator is missing input/conditional/print behavior.");
  }
  if (/Generated fallback|Replace this scaffold/i.test(source)) {
    throw new Error("Scaffold fallback leaked into the deliverable.");
  }
  console.log(
    JSON.stringify({
      ok: true,
      model: code.meta?.model,
      filename: code.meta?.filename,
      chars: source.length,
    }),
  );
} finally {
  await rm(outputDir, { recursive: true, force: true });
}
