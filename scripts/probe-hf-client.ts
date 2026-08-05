import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const l of fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/)) {
  if (!l || l.startsWith("#") || !l.includes("=")) continue;
  const i = l.indexOf("=");
  const k = l.slice(0, i).trim();
  const v = l.slice(i + 1);
  if (!process.env[k]) process.env[k] = v;
}

const { generateHuggingFaceImage } = await import("../packages/shared/src/huggingface.ts");
const t0 = Date.now();
const img = await generateHuggingFaceImage({
  prompt:
    "professional Beacon AI agent logo, geometric lighthouse, mint green circle, cream background, clean brand mark",
  width: 1024,
  height: 1024,
});
fs.writeFileSync(path.join(root, "tmp-hf-client.jpg"), img.bytes);
console.log(
  JSON.stringify({
    ok: true,
    model: img.model,
    bytes: img.bytes.length,
    mime: img.mimeType,
    ms: Date.now() - t0,
  }),
);
