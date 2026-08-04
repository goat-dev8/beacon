/**
 * Render free tier caps ~100 env vars. Drop duplicates / unused FCC-local
 * vars and ensure media keys are present, then clear-cache deploy.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVICE_ID = process.env.RENDER_SERVICE_ID || "srv-d9ojf9tbedkc73d1k6jg";

const DROP = new Set([
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "DEPLOYMENT_PRIVATE_KEY",
  "PROXY_PRIVATE_KEY",
  "BEACON_CREDIT",
  "WEB_PORT",
  "ENABLE_WEB",
  "COSTON2_INDEXER_DB_HOST",
  "COSTON2_INDEXER_DB_PORT",
  "COSTON2_INDEXER_DB_NAME",
  "COSTON2_INDEXER_DB_USERNAME",
  "COSTON2_INDEXER_DB_PASSWORD",
  "OPENMONTAGE_ROOT",
  "VIDEO_TOOLKIT_ROOT",
  "GITHUB_TOKEN",
  "RENDER_API_KEY",
  "vercal_token",
  "GITHUB_REPO_URL",
  "APP_URL",
  "API_URL",
  "VITE_API_URL",
]);

const FORCE = {
  HF_TOKEN: true,
  HF_IMAGE_MODEL: true,
  POLLINATIONS_API_KEY: true,
  POLLINATIONS_IMAGE_BASE: true,
  POLLINATIONS_MODEL: true,
  IMAGE_PROVIDER: true,
  VIDEO_PROVIDER: true,
  AI_MODEL_PROMPT_ENGINEER: true,
};

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(ROOT, ".env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1)];
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
  const res = await fetch(`https://api.render.com/v1${pathname}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (!res.ok) throw new Error(`${method} ${pathname} ${res.status}: ${text.slice(0, 400)}`);
  return json;
}

const page = await render(`/services/${SERVICE_ID}/env-vars?limit=100`);
const rows = Array.isArray(page) ? page : page?.items || [];
const map = new Map();
for (const row of rows) {
  const ev = row.envVar || row;
  if (ev?.key && !DROP.has(ev.key)) map.set(ev.key, ev.value);
}

// Prefer fast Sol for prompt engineering on free Render.
if (!env.AI_MODEL_PROMPT_ENGINEER) env.AI_MODEL_PROMPT_ENGINEER = "gpt-5.6-sol";
env.AI_MODEL_PROMPT_ENGINEER = env.AI_MODEL_PROMPT_ENGINEER || "gpt-5.6-sol";

for (const key of Object.keys(FORCE)) {
  if (env[key]) map.set(key, env[key]);
}
map.set("AI_MODEL_PROMPT_ENGINEER", "gpt-5.6-sol");

let payload = [...map.entries()].map(([key, value]) => ({ key, value }));
if (payload.length > 100) {
  // Drop lowest-priority XRPL/XUMM extras until <=100
  const softDrop = [
    "XRPL_WSS_FALLBACK",
    "XRPL_FAUCET_URL",
    "XRPL_EXPLORER_URL",
    "XUMM_ORIGINS",
    "XUMM_WEBHOOK_URL",
    "XUMM_API_ORIGIN",
    "EXPECTED_FIRST_VOTING_ROUND_START_TS",
    "EXPECTED_VOTING_EPOCH_DURATION_SECONDS",
    "EXT_PROXY_PORT",
    "EXTENSION_PORT",
  ];
  const dropSet = new Set(softDrop);
  payload = payload.filter((p) => !dropSet.has(p.key));
  while (payload.length > 100) payload.pop();
}

console.log(
  "payload",
  payload.length,
  "has",
  Object.fromEntries(
    ["HF_TOKEN", "HF_IMAGE_MODEL", "POLLINATIONS_API_KEY", "AI_MODEL_PROMPT_ENGINEER"].map((k) => [
      k,
      payload.some((p) => p.key === k),
    ]),
  ),
);

await render(`/services/${SERVICE_ID}/env-vars`, { method: "PUT", body: payload });
const deploy = await render(`/services/${SERVICE_ID}/deploys`, {
  method: "POST",
  body: { clearCache: "clear" },
});
console.log("deploy", deploy?.id || deploy?.deploy?.id || deploy);
