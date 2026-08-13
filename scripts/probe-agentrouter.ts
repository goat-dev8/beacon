import "dotenv/config";
import { probeModels, resetEnvCache, loadEnv } from "@beacon/shared";

async function main(): Promise<void> {
  resetEnvCache();
  const env = loadEnv();
  const models = ["gpt-5.6-sol", "gpt-5.6-luna", "claude-opus-4-8"];
  const results = await probeModels(models, env);

  console.log("Model | Base URL | Status | Latency | Error | Works?");
  console.log("---|---|---|---|---|---");
  for (const r of results) {
    console.log(
      [
        r.model,
        r.baseUrl,
        String(r.status),
        `${r.latencyMs}ms`,
        r.error ? JSON.stringify(r.error).slice(0, 80) : "",
        r.works ? "YES" : "NO",
      ].join(" | "),
    );
  }

  const anyOk = results.some((r) => r.works);
  if (!anyOk) {
    console.error("\nNo models succeeded.");
    process.exit(1);
  }
  console.log(`\n${results.filter((r) => r.works).length}/${results.length} models generating.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
