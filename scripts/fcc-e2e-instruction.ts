/**
 * Full FCC E2E: sendSayHello → poll EXT_PROXY /action/result → evidence JSON.
 * Does not print secrets. Requires live EXT_PROXY_URL + PRODUCTION TEE.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resetEnvCache, loadEnv } from "@beacon/shared";
import { FccExtensionClient, fccConfigFromEnv } from "@beacon/fdc";

async function main() {
  resetEnvCache();
  const env = loadEnv();
  if (!env.EXT_PROXY_URL) {
    console.log(JSON.stringify({ ok: false, reason: "EXT_PROXY_URL missing" }));
    process.exit(1);
  }

  const client = new FccExtensionClient(fccConfigFromEnv(env));
  // Longer poll: data-provider relay can take several minutes on Coston2.
  const originalPoll = client.pollActionResult.bind(client);
  client.pollActionResult = (id: string) => originalPoll(id, 90, 5000);

  const started = Date.now();
  console.log(
    JSON.stringify({
      phase: "start",
      extProxy: env.EXT_PROXY_URL,
      sender: env.INSTRUCTION_SENDER,
      simulatedTee: env.SIMULATED_TEE,
    }),
  );

  try {
    const result = await client.sendSayHello("Beacon");
    const evidence = {
      ok: true,
      teeStatusExpected: "PRODUCTION",
      teeId: "0x6516cE58ae346fB4c438463f05B17B50EeB1c8ed",
      flareTeeManager: "0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE",
      extensionId: 65925,
      instructionId: result.instructionId,
      txHash: result.txHash,
      explorer: `https://coston2-explorer.flare.network/tx/${result.txHash}`,
      actionStatus: result.status,
      data: result.data,
      log: result.log,
      honesty: result.honesty,
      simulatedTee: env.SIMULATED_TEE,
      extProxyUrl: env.EXT_PROXY_URL,
      elapsedMs: Date.now() - started,
      timestamp: new Date().toISOString(),
    };
    const dir = join(process.cwd(), "docs", "evidence");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "fcc-instruction-result.json");
    writeFileSync(path, JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify({ phase: "done", path, ...evidence }, null, 2));
  } catch (e) {
    const evidence = {
      ok: false,
      error: e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500),
      elapsedMs: Date.now() - started,
      timestamp: new Date().toISOString(),
      honesty: "INSTRUCTION_SUBMIT_OR_RESULT_POLL_FAILED",
    };
    const dir = join(process.cwd(), "docs", "evidence");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "fcc-instruction-result.json"), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify({ phase: "failed", ...evidence }, null, 2));
    process.exit(1);
  }
}

main();
