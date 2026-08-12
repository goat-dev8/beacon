/**
 * Deploy live Coston2 rails against official faucet USDT0.
 * Reads secrets from local .env — never prints key values.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OFFICIAL_USDT0 = "0xC1A5B41512496B80903D1f32d6dEa3a73212E71F";

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i), l.slice(i + 1)];
      }),
  );
}

function upsertEnv(filePath, updates) {
  if (!fs.existsSync(filePath)) return;
  let text = fs.readFileSync(filePath, "utf8");
  for (const [key, value] of Object.entries(updates)) {
    const re = new RegExp(`^${key}=.*$`, "m");
    if (re.test(text)) text = text.replace(re, `${key}=${value}`);
    else text += `\n${key}=${value}\n`;
  }
  fs.writeFileSync(filePath, text);
}

const env = loadDotEnv(path.join(ROOT, ".env"));
if (env.DEPLOYMENT_PRIVATE_KEY && !env.DEPLOYMENT_PRIVATE_KEY.startsWith("0x")) {
  env.DEPLOYMENT_PRIVATE_KEY = `0x${env.DEPLOYMENT_PRIVATE_KEY}`;
}
const childEnv = {
  ...process.env,
  ...env,
  X402_TOKEN_ADDRESS: OFFICIAL_USDT0,
};

const forge = spawnSync(
  "forge",
  [
    "script",
    "script/DeployUsdt0Rails.s.sol:DeployUsdt0Rails",
    "--rpc-url",
    env.COSTON2_RPC_URL || "https://coston2-api.flare.network/ext/C/rpc",
    "--broadcast",
    "--slow",
  ],
  {
    cwd: path.join(ROOT, "packages/contracts"),
    env: childEnv,
    encoding: "utf8",
    shell: true,
  },
);

if (forge.stdout) process.stdout.write(forge.stdout);
if (forge.stderr) process.stderr.write(forge.stderr);
if (forge.status !== 0) process.exit(forge.status ?? 1);

const out = `${forge.stdout || ""}\n${forge.stderr || ""}`;
function grab(label) {
  const m = out.match(new RegExp(`${label}\\s+(0x[a-fA-F0-9]{40})`));
  return m?.[1] ?? null;
}

const addresses = {
  token: OFFICIAL_USDT0,
  facilitator: grab("X402Facilitator"),
  escrow: grab("BeaconEscrow"),
  factory: grab("BeaconSafeFactory"),
  swapDesk: grab("BeaconCoston2SwapDesk"),
  tokenOut: grab("tokenOut"),
  payee: grab("payee"),
  owner: grab("owner"),
  executor: grab("executor"),
};

if (!addresses.facilitator || !addresses.escrow || !addresses.factory || !addresses.swapDesk) {
  console.error("Failed to parse deployed addresses from forge output.");
  process.exit(1);
}

const evidenceDir = path.join(ROOT, "docs", "evidence");
fs.mkdirSync(evidenceDir, { recursive: true });
fs.writeFileSync(
  path.join(evidenceDir, "usdt0-rails-deploy.json"),
  JSON.stringify({ at: new Date().toISOString(), network: "coston2", chainId: 114, ...addresses }, null, 2),
);

const apiUpdates = {
  X402_TOKEN_ADDRESS: OFFICIAL_USDT0,
  X402_FACILITATOR_ADDRESS: addresses.facilitator,
  BEACON_ESCROW: addresses.escrow,
  BEACON_SAFE_FACTORY_ADDRESS: addresses.factory,
  BEACON_SWAP_DESK_ADDRESS: addresses.swapDesk,
};
upsertEnv(path.join(ROOT, ".env"), apiUpdates);

const webUpdates = {
  VITE_X402_TOKEN_ADDRESS: OFFICIAL_USDT0,
  VITE_X402_FACILITATOR_ADDRESS: addresses.facilitator,
  VITE_BEACON_ESCROW: addresses.escrow,
  VITE_BEACON_SAFE_FACTORY_ADDRESS: addresses.factory,
};
upsertEnv(path.join(ROOT, "apps", "web", ".env"), webUpdates);
upsertEnv(path.join(ROOT, "apps", "web", ".env.example"), webUpdates);
upsertEnv(path.join(ROOT, ".env.example"), apiUpdates);

console.log("USDT0 rails deployed (addresses only):");
console.log(JSON.stringify(addresses, null, 2));
