import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, ".env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);

const token = env.HF_TOKEN;
const model = env.HF_IMAGE_MODEL || "black-forest-labs/FLUX.1-schnell";
const prompt =
  "professional photo of a cat and a dog running fast on a sunny beach, cinematic lighting, sharp detail";
const t0 = Date.now();

const res = await fetch("https://router.huggingface.co/v1/images/generations", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model,
    prompt,
    size: "768x768",
    response_format: "b64_json",
  }),
});
const text = await res.text();
console.log(
  JSON.stringify(
    {
      status: res.status,
      ms: Date.now() - t0,
      preview: text.slice(0, 240),
      b64Len: (() => {
        try {
          return JSON.parse(text)?.data?.[0]?.b64_json?.length ?? 0;
        } catch {
          return 0;
        }
      })(),
    },
    null,
    2,
  ),
);
