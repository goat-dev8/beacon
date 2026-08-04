/**
 * Sync selected local .env keys onto Render Beacon API service.
 * Never prints secret values.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVICE_ID = process.env.RENDER_SERVICE_ID || "srv-d9ojf9tbedkc73d1k6jg";

const SKIP = new Set([
  "OPENMONTAGE_ROOT",
  "VIDEO_TOOLKIT_ROOT",
  "GITHUB_TOKEN",
  "RENDER_API_KEY",
  "vercal_token",
  "GITHUB_REPO_URL",
]);

const UPSERT_KEYS = [
  "HF_TOKEN",
  "HF_IMAGE_MODEL",
  "HUGGINGFACE_API_KEY",
  "POLLINATIONS_API_KEY",
  "POLLINATIONS_IMAGE_BASE",
  "POLLINATIONS_MODEL",
  "IMAGE_PROVIDER",
  "VIDEO_PROVIDER",
  "AI_BASE_URL",
  "AI_API_KEY",
  "AI_MODEL_GENERATOR",
  "AI_MODEL_JUDGE",
  "AI_MODEL_QUOTE",
  "AI_MODEL_ACCEPTANCE",
  "AI_MODEL_PROMPT_ENGINEER",
  "AI_REQUIRE_REAL",
  "OPENAI_BASE_URL",
  "OPENAI_API_KEY",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_API_KEY",
  "COMFYUI_URL",
  "COMFYUI_WORKFLOW_PATH",
];

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

const existing = [];
let cursor = "";
for (;;) {
  const q = cursor ? `?limit=100&cursor=${encodeURIComponent(cursor)}` : "?limit=100";
  const page = await render(`/services/${SERVICE_ID}/env-vars${q}`);
  const rows = Array.isArray(page) ? page : page?.items || [];
  for (const row of rows) {
    const ev = row.envVar || row;
    if (ev?.key) existing.push({ key: ev.key, value: ev.value });
  }
  cursor = page?.cursor || page?.nextCursor || "";
  if (!cursor || rows.length === 0) break;
}

const map = new Map(existing.map((e) => [e.key, e.value]));
const changed = [];
for (const key of UPSERT_KEYS) {
  if (SKIP.has(key)) continue;
  const val = env[key];
  if (val === undefined || val === "") continue;
  if (map.get(key) !== val) {
    map.set(key, val);
    changed.push(key);
  }
}

const payload = [...map.entries()]
  .filter(([k]) => !SKIP.has(k))
  .map(([key, value]) => ({ key, value }));

console.log("existing", existing.length, "payload", payload.length, "changed", changed);

const put = await render(`/services/${SERVICE_ID}/env-vars`, {
  method: "PUT",
  body: payload,
});
console.log("put ok", Array.isArray(put) ? put.length : typeof put);

const deploy = await render(`/services/${SERVICE_ID}/deploys`, {
  method: "POST",
  body: { clearCache: "clear" },
});
console.log("deploy", deploy?.id || deploy?.deploy?.id || deploy?.status || "queued");
