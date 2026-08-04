/**
 * Deploy Beacon API to Render (free web service) and print the public URL.
 * Reads secrets from local .env — never prints token values.
 */
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(ROOT, ".env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);

const API_KEY = env.RENDER_API_KEY;
if (!API_KEY) throw new Error("RENDER_API_KEY missing");

const headers = {
  Authorization: `Bearer ${API_KEY}`,
  Accept: "application/json",
  "Content-Type": "application/json",
};

async function render(pathname, { method = "GET", body } = {}) {
  const response = await fetch(`https://api.render.com/v1${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`${method} ${pathname} → ${response.status}: ${text.slice(0, 500)}`);
  }
  return json;
}

function pick(keys) {
  return keys
    .filter((k) => env[k] !== undefined && env[k] !== "")
    .map((k) => ({ key: k, value: env[k] }));
}

async function main() {
  const owners = await render("/owners");
  const ownerId = owners?.[0]?.owner?.id || owners?.[0]?.id;
  if (!ownerId) throw new Error("No Render owner/workspace found for this API key");
  console.log("owner", ownerId);

  const services = await render("/services?limit=50");
  const list = Array.isArray(services) ? services : [];
  let existing = list.find((s) => (s.service?.name || s.name) === "beacon-api");

  const envVars = [
    { key: "NODE_ENV", value: "production" },
    { key: "CHAIN_ID", value: "114" },
    { key: "NETWORK_NAME", value: "coston2" },
    { key: "SIMULATED_TEE", value: "true" },
    { key: "ENABLE_API", value: "true" },
    { key: "ENABLE_FCC", value: "true" },
    { key: "ENABLE_PIPELINE", value: "true" },
    { key: "DATABASE_SSL", value: "true" },
    { key: "AI_REQUIRE_REAL", value: "true" },
    { key: "LOG_LEVEL", value: "info" },
    { key: "APP_NAME", value: "Beacon" },
    ...pick([
      "COSTON2_RPC_URL",
      "DATABASE_URL",
      "DATABASE_URL_DIRECT",
      "UPSTASH_REDIS_REST_URL",
      "UPSTASH_REDIS_REST_TOKEN",
      "AI_BASE_URL",
      "AI_API_KEY",
      "AI_MODEL_GENERATOR",
      "AI_MODEL_JUDGE",
      "AI_MODEL_QUOTE",
      "AI_MODEL_ACCEPTANCE",
      "OPENAI_BASE_URL",
      "OPENAI_API_KEY",
      "ANTHROPIC_BASE_URL",
      "ANTHROPIC_API_KEY",
      "DEPLOYER_PRIVATE_KEY",
      "DEPLOYER_ADDRESS",
      "DEPLOYMENT_PRIVATE_KEY",
      "SESSION_SECRET",
      "X402_TOKEN_ADDRESS",
      "X402_FACILITATOR_ADDRESS",
      "X402_PAYEE_ADDRESS",
      "BEACON_JOB_REGISTRY",
      "BEACON_ESCROW",
      "INSTRUCTION_SENDER",
      "EXTENSION_ID",
      "EXT_PROXY_URL",
      "NORMAL_PROXY_URL",
      "FLARE_CONTRACT_REGISTRY",
      "EXPECTED_ASSET_MANAGER_FXRP",
      "EXPECTED_MASTER_ACCOUNT_CONTROLLER",
      "EXPECTED_FXRP_TOKEN",
      "EXPECTED_FDC_HUB",
      "EXPECTED_FDC_VERIFICATION",
    ]),
  ];

  let serviceId;
  let serviceUrl;

  if (existing) {
    serviceId = existing.service?.id || existing.id;
    serviceUrl = existing.service?.serviceDetails?.url || existing.serviceDetails?.url;
    console.log("updating existing service", serviceId);
    await render(`/services/${serviceId}/env-vars`, { method: "PUT", body: envVars });
    await render(`/services/${serviceId}/deploys`, { method: "POST", body: { clearCache: "clear" } });
  } else {
    const created = await render("/services", {
      method: "POST",
      body: {
        type: "web_service",
        name: "beacon-api",
        ownerId,
        repo: "https://github.com/goat-dev8/beacon",
        branch: "main",
        autoDeploy: "yes",
        plan: "free",
        region: "oregon",
        envVars,
        serviceDetails: {
          runtime: "node",
          plan: "free",
          region: "oregon",
          healthCheckPath: "/health",
          numInstances: 1,
          envSpecificDetails: {
            buildCommand:
              "NPM_CONFIG_PRODUCTION=false npm ci --include=dev",
            startCommand: "npx tsx apps/api/src/index.ts",
          },
        },
      },
    });
    serviceId = created.service?.id || created.id;
    serviceUrl = created.service?.serviceDetails?.url || created.serviceDetails?.url;
    console.log("created service", serviceId);
  }

  // Ensure clean public URL fields on local env for tests
  if (serviceUrl) {
    const clean = serviceUrl.replace(/\/$/, "");
    envVars.push({ key: "API_URL", value: clean });
    envVars.push({ key: "APP_URL", value: clean });
    await render(`/services/${serviceId}/env-vars`, { method: "PUT", body: envVars });
  }

  console.log("polling deploys...");
  let liveUrl = serviceUrl;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 15000));
    const svc = await render(`/services/${serviceId}`);
    const detail = svc.service || svc;
    liveUrl = detail.serviceDetails?.url || liveUrl;
    const deploys = await render(`/services/${serviceId}/deploys?limit=1`);
    const latest = Array.isArray(deploys) ? deploys[0]?.deploy || deploys[0] : null;
    const status = latest?.status || detail?.suspended || "unknown";
    console.log(`tick ${i + 1}: deploy=${status} url=${liveUrl || "?"}`);
    if (["live", "succeeded", "available"].includes(String(status).toLowerCase())) break;
    if (["build_failed", "update_failed", "canceled", "deactivated"].includes(String(status).toLowerCase())) {
      throw new Error(`Deploy failed with status ${status}`);
    }
    // also probe health early
    if (liveUrl) {
      try {
        const h = await fetch(`${liveUrl.replace(/\/$/, "")}/health`);
        if (h.ok) {
          console.log("health OK early");
          break;
        }
      } catch {
        // still booting
      }
    }
  }

  console.log("SERVICE_ID=" + serviceId);
  console.log("SERVICE_URL=" + (liveUrl || ""));
  fs.writeFileSync(
    path.join(ROOT, "tmp-render-deploy.json"),
    JSON.stringify({ serviceId, serviceUrl: liveUrl }, null, 2),
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
