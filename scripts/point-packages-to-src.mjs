import fs from "node:fs";
import path from "node:path";

for (const p of [
  "shared",
  "x402",
  "quote",
  "acceptance",
  "pipeline",
  "receipts",
  "fdc",
  "smart-accounts",
]) {
  const f = path.join("packages", p, "package.json");
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  j.main = "./src/index.ts";
  j.types = "./src/index.ts";
  j.exports = {
    ".": {
      types: "./src/index.ts",
      import: "./src/index.ts",
      default: "./src/index.ts",
    },
  };
  j.scripts = j.scripts || {};
  j.scripts.build = "node -e \"process.stdout.write('skip\\n')\"";
  fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n");
  console.log("ok", p, j.scripts.build);
}
