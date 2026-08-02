import "dotenv/config";
import pg from "pg";
import { Redis } from "@upstash/redis";
import { JsonRpcProvider } from "ethers";
import {
  loadEnv,
  requireEnv,
  honestyMessage,
  isAiConfigured,
  probeModels,
  resolveAiBaseUrl,
  resolveModelForRole,
} from "@beacon/shared";
import { registryFromEnv, assertRegistryConfigured } from "@beacon/smart-accounts";

type CheckResult = { name: string; ok: boolean; detail: string };

async function main(): Promise<void> {
  const env = loadEnv();
  const results: CheckResult[] = [];

  const requiredKeys = [
    "NODE_ENV",
    "API_PORT",
    "CHAIN_ID",
    "COSTON2_RPC_URL",
    "DATABASE_URL",
    "DATABASE_URL_DIRECT",
    "SESSION_SECRET",
  ] as const;

  for (const key of requiredKeys) {
    try {
      requireEnv(env, key);
      results.push({ name: key, ok: true, detail: "present" });
    } catch {
      results.push({ name: key, ok: false, detail: "missing" });
    }
  }

  results.push({
    name: "SIMULATED_TEE",
    ok: true,
    detail: `${env.SIMULATED_TEE} — ${honestyMessage(env.SIMULATED_TEE)}`,
  });

  if (env.DATABASE_URL_DIRECT) {
    results.push(await checkPostgres(env.DATABASE_URL_DIRECT, env.DATABASE_SSL));
  }

  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    results.push(await checkRedis(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN));
  } else {
    results.push({ name: "redis", ok: false, detail: "Upstash REST URL/token missing" });
  }

  if (env.COSTON2_RPC_URL) {
    results.push(await checkRpc(env.COSTON2_RPC_URL, env.CHAIN_ID));
  }

  const registry = registryFromEnv();
  const missingRegistry = assertRegistryConfigured(registry);
  results.push({
    name: "registry",
    ok: missingRegistry.length === 0,
    detail:
      missingRegistry.length === 0
        ? "expected registry addresses configured"
        : `missing: ${missingRegistry.join(", ")}`,
  });

  if (isAiConfigured(env)) {
    results.push({
      name: "ai_config",
      ok: true,
      detail: `base=${resolveAiBaseUrl(env)}; gen=${resolveModelForRole("generator", env)}; judge=${resolveModelForRole("judge", env)}`,
    });
    const probes = await probeModels(
      [resolveModelForRole("generator", env), resolveModelForRole("judge", env)],
      env,
    );
    const okProbe = probes.find((p) => p.works);
    results.push({
      name: "ai_live",
      ok: Boolean(okProbe),
      detail: okProbe
        ? `${okProbe.model} ${okProbe.status} in ${okProbe.latencyMs}ms`
        : probes.map((p) => `${p.model}:${p.status}`).join(", "),
    });
  } else {
    results.push({
      name: "ai_config",
      ok: !env.AI_REQUIRE_REAL,
      detail: env.AI_REQUIRE_REAL ? "AI_REQUIRE_REAL but key/base missing" : "AI not configured",
    });
  }

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? "✓" : "✗"} ${r.name}: ${r.detail}`);
  }

  if (failed.length > 0) {
    console.error(`\n${failed.length} check(s) failed.`);
    process.exit(1);
  }

  console.log("\nEnvironment verification passed.");
}

async function checkPostgres(url: string, ssl?: boolean): Promise<CheckResult> {
  const client = new pg.Client({
    connectionString: url,
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
  });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return { name: "postgres", ok: true, detail: "connected" };
  } catch (err) {
    return {
      name: "postgres",
      ok: false,
      detail: err instanceof Error ? err.message : "connection failed",
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function checkRedis(url: string, token: string): Promise<CheckResult> {
  try {
    const redis = new Redis({ url, token });
    const pong = await redis.ping();
    return { name: "redis", ok: pong === "PONG", detail: String(pong) };
  } catch (err) {
    return {
      name: "redis",
      ok: false,
      detail: err instanceof Error ? err.message : "ping failed",
    };
  }
}

async function checkRpc(rpcUrl: string, expectedChainId: number): Promise<CheckResult> {
  try {
    const provider = new JsonRpcProvider(rpcUrl);
    const network = await provider.getNetwork();
    const ok = Number(network.chainId) === expectedChainId;
    return {
      name: "coston2_rpc",
      ok,
      detail: `chainId=${network.chainId}`,
    };
  } catch (err) {
    return {
      name: "coston2_rpc",
      ok: false,
      detail: err instanceof Error ? err.message : "rpc failed",
    };
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
