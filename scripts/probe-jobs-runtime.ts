import "dotenv/config";
import {
  chatForRole,
  gatherResearchGrounding,
  loadEnv,
  resetEnvCache,
  routingLayerForVia,
} from "@beacon/shared";

async function main(): Promise<void> {
  resetEnvCache();
  const env = loadEnv();

  console.log("=== generator hop ===");
  const gen = await chatForRole(
    "generator",
    [{ role: "user", content: "Reply with exactly: WORKS" }],
    { maxTokens: 32, temperature: 0, env },
  );
  console.log({
    model: gen.model,
    requestedModel: gen.requestedModel,
    via: gen.via,
    routingLayer: routingLayerForVia(gen.via),
    latencyMs: gen.latencyMs,
    preview: gen.content.slice(0, 80),
  });

  console.log("=== research grounding SparkDEX ===");
  const g = await gatherResearchGrounding("Research SparkDEX", env);
  console.log({
    retrievedAt: g.retrievedAt,
    ok: g.sources.filter((s) => s.ok).length,
    fail: g.sources.filter((s) => !s.ok).length,
    urls: g.sources.filter((s) => s.ok).map((s) => s.url),
    failures: g.sources.filter((s) => !s.ok).map((s) => `${s.title}: ${s.error}`),
    liveNotes: g.liveNotes,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
