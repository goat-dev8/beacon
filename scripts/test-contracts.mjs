import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const contracts = join(root, "packages", "contracts");
const forgeStd = join(contracts, "lib", "forge-std", "src", "Test.sol");

function run(args, cwd) {
  const cmd = process.platform === "win32" ? "forge.exe" : "forge";
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (result.error) {
    console.error(
      "forge is not on PATH. Install Foundry: https://book.getfoundry.sh/getting-started/installation",
    );
    if (process.platform === "win32") {
      console.error('Windows: $env:Path += ";$env:USERPROFILE\\.foundry\\bin"');
    }
    process.exit(1);
  }
  if (result.status) process.exit(result.status);
}

if (!existsSync(forgeStd)) {
  console.log("forge-std missing — installing foundry-rs/forge-std (first contract-test run).");
  run(["install", "foundry-rs/forge-std", "--no-git", "--shallow"], contracts);
}

run(["test"], contracts);
