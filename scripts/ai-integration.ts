import "dotenv/config";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  chatForRole,
  extractJsonObject,
  isAiConfigured,
  loadEnv,
  resetEnvCache,
} from "@beacon/shared";
import { runPipeline } from "@beacon/pipeline";
import { runAcceptance } from "@beacon/acceptance";
import { evaluateSealedFit } from "@beacon/quote";

async function main(): Promise<void> {
  resetEnvCache();
  const env = loadEnv();
  if (!isAiConfigured(env)) {
    console.error("AI not configured");
    process.exit(1);
  }

  console.log("1) Quote assistant (Sealed Fit)");
  const fit = await evaluateSealedFit({
    serviceId: "documents",
    briefText: "Write a one-page SOP for onboarding a new contractor.",
  });
  console.log("  capability:", fit.capability, fit.reason ?? "");

  console.log("2) Generation");
  const outDir = await mkdtemp(path.join(os.tmpdir(), "beacon-ai-"));
  await mkdir(outDir, { recursive: true });
  const pipeline = await runPipeline({
    jobId: "ai-int-1",
    serviceId: "documents",
    briefText: "Write a short checklist for verifying invoice totals before payment.",
    outputDir: outDir,
  });
  const draft = pipeline.artifacts.find((a) => a.kind === "draft");
  if (!draft) throw new Error("missing draft");
  const draftBody = await readFile(draft.uri, "utf8");
  console.log("  provider:", draft.meta?.provider, draft.meta?.model);
  console.log("  draft chars:", draftBody.length);
  if (draft.meta?.provider !== "agentrouter") {
    throw new Error(`expected real AgentRouter generation, got ${JSON.stringify(draft.meta)}`);
  }

  console.log("3) Judge / Acceptance L2");
  const report = await runAcceptance({
    jobId: "ai-int-1",
    serviceId: "documents",
    rubricVersion: "v1",
    artifacts: [
      {
        kind: "document",
        uri: draft.uri,
        mimeType: "text/markdown",
        payload: draftBody,
      },
    ],
  });
  const l2 = report.layers.find((l) => l.layer === "L2");
  console.log("  result:", report.result);
  console.log("  L2:", l2?.passed, l2?.notes.join(" | "));
  if (!l2 || !l2.notes.some((n) => n.startsWith("judge:"))) {
    throw new Error("L2 judge did not run against real provider");
  }

  console.log("4) Direct chatForRole smoke");
  const judge = await chatForRole(
    "judge",
    [
      {
        role: "system",
        content:
          'You are a JSON API. Respond with ONLY this exact JSON object and nothing else: {"pass":true,"notes":["ok"],"uncertain":false}',
      },
      { role: "user", content: "ping" },
    ],
    { temperature: 0, maxTokens: 64 },
  );
  let parsed: { pass?: boolean };
  try {
    parsed = extractJsonObject<{ pass?: boolean }>(judge.content);
  } catch {
    // Some models wrap with prose; still prove live generation happened.
    parsed = { pass: /pass["']?\s*:\s*true/i.test(judge.content) };
  }
  if (!judge.content.trim()) throw new Error("empty judge response");
  console.log("  judge model:", judge.model, "pass:", parsed.pass, `${judge.latencyMs}ms`);

  console.log("\nReal AI paths OK.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
