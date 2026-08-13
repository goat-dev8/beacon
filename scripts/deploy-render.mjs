/**
 * Deploy Beacon API to Render (free web service) and print the public URL.
 * Reads secrets from local .env — never prints token values.
 *
 * SAFETY: Updating an existing service MERGES env vars (GET → patch → PUT).
 * Never wipe production with a partial pick list. Rejects localhost/tunnel URLs.
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

const TUNNEL_RE = /localhost|127\.0\.0\.1|trycloudflare\.com|ngrok|loca\.lt|cloudflare\.com\/tunnel/i;
const RESERVED_EXT_PROXY_HOST = "policy-handful-outlast.ngrok-free.dev";

function isReservedExtProxy(value) {
  try {
    return new URL(value).hostname === RESERVED_EXT_PROXY_HOST;
  } catch {
    return false;
  }
}

function isForbiddenUrl(value) {
  if (typeof value !== "string") return false;
  if (isReservedExtProxy(value)) return false;
  return TUNNEL_RE.test(value);
}

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
    .filter((k) => {
      if (isForbiddenUrl(env[k])) {
        console.warn(`skip ${k}: localhost/tunnel URL forbidden for Render`);
        return false;
      }
      return true;
    })
    .map((k) => ({ key: k, value: env[k] }));
}

const MERGE_KEYS = [
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
  "AI_PROXY_URL",
  "AI_PROXY_SECRET",
  "POLLINATIONS_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_API_KEY",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_API_KEY",
  "DEPLOYER_PRIVATE_KEY",
  "DEPLOYER_ADDRESS",
  "DEPLOYMENT_PRIVATE_KEY",
  "SETTLER_PRIVATE_KEY",
  "SETTLER_ADDRESS",
  "SESSION_SECRET",
  "X402_TOKEN_ADDRESS",
  "X402_FACILITATOR_ADDRESS",
  "X402_PAYEE_ADDRESS",
  "BEACON_JOB_REGISTRY",
  "BEACON_ESCROW",
  "BEACON_AGENT_VAULT_ADDRESS",
  "BEACON_SWAP_DESK_ADDRESS",
  "INSTRUCTION_SENDER",
  "EXTENSION_ID",
  "TEE_ID",
  "EXT_PROXY_URL",
  "NORMAL_PROXY_URL",
  "TEE_PROXY_URL",
  "FCC_MODE",
  "FLARE_CONTRACT_REGISTRY",
  "EXPECTED_ASSET_MANAGER_FXRP",
  "EXPECTED_MASTER_ACCOUNT_CONTROLLER",
  "EXPECTED_FXRP_TOKEN",
  "EXPECTED_FDC_HUB",
  "EXPECTED_FDC_VERIFICATION",
  "FDC_VERIFIER_XRP_URL",
  "FDC_VERIFIER_EVM_URL",
  "FDC_API_KEY",
  "DA_LAYER_URL",
  "DA_LAYER_API_URL",
  "BEACON_SAFE_FACTORY_ADDRESS",
  "FLARE_REQUIRED",
];

function baseEnvVars() {
  return [
    { key: "NODE_ENV", value: "production" },
    { key: "CHAIN_ID", value: "114" },
    { key: "NETWORK_NAME", value: "coston2" },
    // Never force simulated TEE on an existing hardware FCC service.
    { key: "SIMULATED_TEE", value: env.SIMULATED_TEE || "false" },
    { key: "LOCAL_MODE", value: "false" },
    { key: "FCC_MODE", value: env.FCC_MODE || "verified" },
    { key: "ENABLE_API", value: "true" },
    { key: "ENABLE_FCC", value: "true" },
    { key: "ENABLE_PIPELINE", value: "true" },
    { key: "DATABASE_SSL", value: "true" },
    { key: "AI_REQUIRE_REAL", value: "true" },
    { key: "LOG_LEVEL", value: "info" },
    { key: "APP_NAME", value: "Beacon" },
    ...pick(MERGE_KEYS),
  ];
}

/** Fetch all env vars (Render list is paginated). */
async function listAllEnvVars(serviceId) {
  const rows = [];
  let cursor = "";
  for (let i = 0; i < 30; i++) {
    const q = cursor
      ? `?limit=100&cursor=${encodeURIComponent(cursor)}`
      : "?limit=100";
    const page = await render(`/services/${serviceId}/env-vars${q}`);
    const batch = Array.isArray(page) ? page : page.items || [];
    if (!batch.length) break;
    rows.push(...batch);
    const next = page.cursor || batch[batch.length - 1]?.cursor;
    if (!next || batch.length < 100) break;
    cursor = next;
  }
  return rows;
}

/** Merge updates into existing Render env; drop forbidden tunnel URLs. */
async function mergeEnvVars(serviceId, updates) {
  const rows = await listAllEnvVars(serviceId);
  console.log(`merge: loaded ${rows.length} existing env keys`);
  const map = new Map();
  for (const row of rows) {
    const key = row.envVar?.key || row.key;
    const value = row.envVar?.value || row.value;
    if (!key) continue;
    if (key === "EXT_PROXY_URL" && isForbiddenUrl(value)) {
      console.warn("dropping existing EXT_PROXY_URL tunnel from Render");
      continue;
    }
    if (isForbiddenUrl(value) && /PROXY|URL|HOST|APP_URL|API_URL/i.test(key)) {
      console.warn(`dropping forbidden ${key}`);
      continue;
    }
    map.set(key, value);
  }
  for (const { key, value } of updates) {
    if (key === "EXT_PROXY_URL" && !isReservedExtProxy(value)) {
      console.warn("skip EXT_PROXY_URL: only the reserved ngrok host may be synced");
      continue;
    }
    if (isForbiddenUrl(value)) {
      console.warn(`skip update ${key}: forbidden URL`);
      continue;
    }
    map.set(key, value);
  }
  return [...map.entries()].map(([key, value]) => ({ key, value }));
}

async function main() {
  const owners = await render("/owners");
  const ownerId = owners?.[0]?.owner?.id || owners?.[0]?.id;
  if (!ownerId) throw new Error("No Render owner/workspace found for this API key");
  console.log("owner", ownerId);

  const services = await render("/services?limit=50");
  const list = Array.isArray(services) ? services : [];
  let existing = list.find((s) => (s.service?.name || s.name) === "beacon-api");

  const seedVars = baseEnvVars();

  let serviceId;
  let serviceUrl;

  if (existing) {
    serviceId = existing.service?.id || existing.id;
    serviceUrl = existing.service?.serviceDetails?.url || existing.serviceDetails?.url;
    console.log("merging env on existing service", serviceId);
    const merged = await mergeEnvVars(serviceId, seedVars);
    await render(`/services/${serviceId}/env-vars`, { method: "PUT", body: merged });
    await render(`/services/${serviceId}/deploys`, { method: "POST", body: { clearCache: "do_not_clear" } });
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
        envVars: seedVars,
        serviceDetails: {
          runtime: "node",
          plan: "free",
          region: "oregon",
          healthCheckPath: "/health",
          numInstances: 1,
          envSpecificDetails: {
            buildCommand:
              "NPM_CONFIG_PRODUCTION=false npm ci --include=dev && npm run build -w @beacon/shared -w @beacon/x402 -w @beacon/quote -w @beacon/acceptance -w @beacon/pipeline -w @beacon/receipts -w @beacon/fdc -w @beacon/smart-accounts",
            startCommand: "npx tsx apps/api/src/index.ts",
          },
        },
      },
    });
    serviceId = created.service?.id || created.id;
    serviceUrl = created.service?.serviceDetails?.url || created.serviceDetails?.url;
    console.log("created service", serviceId);
  }

  if (serviceUrl) {
    const clean = serviceUrl.replace(/\/$/, "");
    const merged = await mergeEnvVars(serviceId, [
      ...seedVars,
      { key: "API_URL", value: clean },
    ]);
    await render(`/services/${serviceId}/env-vars`, { method: "PUT", body: merged });
  }

  console.log("polling deploys...");
  let liveUrl = serviceUrl;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 10000));
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
