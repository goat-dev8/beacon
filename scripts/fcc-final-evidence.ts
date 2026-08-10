import "dotenv/config";
import { Contract, JsonRpcProvider } from "ethers";
import { writeFileSync } from "fs";

const mgr = process.env.FLARE_TEE_MANAGER || "0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE";
const tee = process.env.TEE_ID || "0x6516cE58ae346fB4c438463f05B17B50EeB1c8ed";
const provider = new JsonRpcProvider(process.env.COSTON2_RPC_URL!);
const ABIS = [
  ["function getTeeInfo(address) view returns (uint8 status, bytes32 codeHash, string extensionProxyUrl)"],
  ["function teeStatus(address) view returns (uint8)"],
  ["function getStatus(address) view returns (uint8)"],
  ["function machines(address) view returns (uint8 status, address owner, bytes32 codeHash, string url)"],
  ["function getMachineData(address) view returns (uint8)"],
];

async function main() {
  const proxy = process.env.EXT_PROXY_URL || "";
  let info: unknown = null;
  try {
    const r = await fetch(`${proxy.replace(/\/$/, "")}/info`);
    info = await r.json();
  } catch (e) {
    info = { error: String(e).slice(0, 200) };
  }

  // Use existing verified evidence + live /info
  let onchain: Record<string, unknown> = {};
  // FlareTeeManager typical: mapping + status enum
  try {
    const c = new Contract(
      mgr,
      [
        "function getTeeMachineStatus(address tee) view returns (uint8)",
        "function teeMachineStatus(address) view returns (uint8)",
        "function status(address) view returns (uint8)",
      ],
      provider,
    );
    for (const fn of ["getTeeMachineStatus", "teeMachineStatus", "status"] as const) {
      try {
        onchain[fn] = Number(await (c as any)[fn](tee));
      } catch (e: any) {
        onchain[fn] = `err:${String(e.shortMessage || e.message).slice(0, 80)}`;
      }
    }
  } catch (e: any) {
    onchain.error = String(e.message).slice(0, 120);
  }

  // Reuse prior evidence file if present
  let prior: unknown = null;
  try {
    prior = JSON.parse(require("fs").readFileSync("docs/evidence/fcc-tee-production.json", "utf8"));
  } catch {}

  const out = {
    capturedAt: new Date().toISOString(),
    SIMULATED_TEE: process.env.SIMULATED_TEE === "true",
    FCC_MODE: process.env.FCC_MODE || null,
    tee,
    manager: mgr,
    instructionSender: process.env.INSTRUCTION_SENDER || "0x11bFc67F6c5e7a1265b52292F5AE5a8f4B821c46",
    extensionId: process.env.EXTENSION_ID || "65925",
    extProxyHost: proxy.replace(/^https?:\/\//, "").split("/")[0],
    proxyInfoOk: Boolean(info && typeof info === "object" && !(info as any).error),
    proxyInfo: info,
    onchainProbe: onchain,
    priorProductionEvidence: prior
      ? { status: (prior as any).status, honesty: (prior as any).honesty, tee: (prior as any).tee }
      : null,
    stableProxy: {
      investigated: true,
      ngrokReservedDomain: false,
      cloudflareNamedTunnel: false,
      reason:
        "ngrok has no local config; cloudflared has no origin cert / named tunnel. trycloudflare remains ephemeral. Do not pin on Render.",
      currentProxyAlive: Boolean(info && typeof info === "object" && !(info as any).error),
      nextAction:
        "Provision Cloudflare named tunnel or ngrok reserved domain, point to local/VPS ext-proxy, re-register with rRap, verify status 2 on-chain, then set EXT_PROXY_URL.",
    },
    honesty:
      "SIMULATED_TEE=true. PRODUCTION status 2 from prior on-chain evidence ≠ hardware Confidential Space. EXT_PROXY currently alive via ephemeral trycloudflare — not a stable architecture.",
  };
  writeFileSync("docs/evidence/fcc-final.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ proxyOk: out.proxyInfoOk, host: out.extProxyHost, stable: out.stableProxy }, null, 2));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
