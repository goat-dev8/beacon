import "dotenv/config";
import { buildAgentRouterHeaders, resolveAiApiKey, resolveAiBaseUrl, loadEnv } from "@beacon/shared";

const env = loadEnv();
const key = resolveAiApiKey(env);
const base = resolveAiBaseUrl(env);
const headers = buildAgentRouterHeaders(key);

async function tryReq(name: string, path: string, body: unknown) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const text = await res.text();
    console.log(`\n=== ${name} → ${res.status} (${Date.now() - t0}ms) ===`);
    console.log(text.slice(0, 500).replace(/\s+/g, " "));
  } catch (e) {
    console.log(`\n=== ${name} ERR ===`, e instanceof Error ? e.message : e);
  }
}

async function main() {
  console.log("base", base, "key", key.slice(0, 8) + "…");

  // list models if available
  try {
    const res = await fetch(`${base}/models`, { headers });
    const text = await res.text();
    console.log("\n=== GET /models →", res.status, "===");
    const data = JSON.parse(text) as { data?: Array<{ id: string }> };
    const ids = (data.data ?? []).map((m) => m.id);
    const imageish = ids.filter((id) => /image|dall|flux|midjourney|sdxl|gemini.*image|gpt-image/i.test(id));
    console.log("total models", ids.length);
    console.log("image-ish", imageish.slice(0, 40));
    console.log(
      "sample",
      ids.filter((id) => /gpt|dall|flux|image/i.test(id)).slice(0, 30),
    );
  } catch (e) {
    console.log("models err", e);
  }

  const prompt = "Minimal mint Beacon mark on warm paper, flat vector thumbnail, green accent, no text";
  for (const model of [
    "gpt-image-2",
    "gpt-image-1",
    "dall-e-3",
    "dall-e-2",
    "gpt-5.6-sol",
    "flux-pro",
    "flux-schnell",
    "stable-diffusion-xl",
  ]) {
    await tryReq(`images/${model}`, "/images/generations", {
      model,
      prompt,
      size: "1024x1024",
      n: 1,
    });
  }

  // bare OpenAI-style without model (some gateways default)
  await tryReq("images/no-model", "/images/generations", {
    prompt,
    size: "1024x1024",
    n: 1,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
