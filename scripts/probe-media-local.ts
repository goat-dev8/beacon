import "dotenv/config";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runPipeline, PIPELINE_CAPS } from "@beacon/pipeline";

async function main() {
  console.log("caps", PIPELINE_CAPS);
  const outputDir = await mkdtemp(path.join(tmpdir(), "beacon-media-"));
  const serviceId = process.argv[2] || "image";
  const result = await runPipeline({
    jobId: `local-${serviceId}-${Date.now()}`,
    serviceId,
    briefText:
      process.argv[3] ||
      "Minimal mint Beacon mark on warm paper, flat vector thumbnail, green flare accent",
    outputDir,
  });
  console.log(
    "artifacts",
    result.artifacts.map((a) => ({ kind: a.kind, mime: a.mimeType, uri: a.uri })),
  );
  const img = result.artifacts.find((a) => a.kind === "image");
  const vid = result.artifacts.find((a) => a.kind === "video");
  if (serviceId === "image" && (!img || img.mimeType.includes("svg"))) {
    throw new Error("expected real raster image from Pollinations");
  }
  console.log("OK", serviceId, img?.mimeType ?? "", vid?.mimeType ?? "");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
