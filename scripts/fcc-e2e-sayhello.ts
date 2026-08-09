/**
 * Clean FCC SAY_HELLO with correct {"name"} payload + receipt topics[2] instruction id.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Contract, JsonRpcProvider, Wallet, toUtf8Bytes } from "ethers";
import { resetEnvCache, loadEnv } from "@beacon/shared";

const FEE = 1_000_000n;

async function poll(ext: string, instructionId: string, attempts = 72, delayMs = 5000) {
  let last = 0;
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(`${ext.replace(/\/$/, "")}/action/result/${instructionId}`);
    last = res.status;
    if (res.ok) return { http: res.status, body: await res.json() };
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return { http: last, body: null };
}

async function main() {
  resetEnvCache();
  const env = loadEnv();
  const pk = env.DEPLOYMENT_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY;
  if (!pk || !env.INSTRUCTION_SENDER || !env.EXT_PROXY_URL) {
    console.log(JSON.stringify({ ok: false, reason: "missing config" }));
    process.exit(1);
  }
  const provider = new JsonRpcProvider(env.COSTON2_RPC_URL || env.CHAIN_URL);
  const wallet = new Wallet(pk.startsWith("0x") ? pk : `0x${pk}`, provider);
  const sender = new Contract(
    env.INSTRUCTION_SENDER,
    ["function sendSayHello(bytes _message) payable"],
    wallet,
  );

  const payload = toUtf8Bytes(JSON.stringify({ name: "BeaconPolicy" }));
  const tx = await sender.sendSayHello(payload, { value: FEE, gasLimit: 1_500_000n });
  const receipt = await tx.wait();
  const log = receipt?.logs?.[0];
  const instructionId = log?.topics?.[2];
  if (!instructionId) {
    console.log(JSON.stringify({ ok: false, reason: "no instruction id", tx: receipt?.hash }));
    process.exit(1);
  }

  console.log(
    JSON.stringify({
      phase: "submitted",
      txHash: receipt?.hash,
      instructionId,
      explorer: `https://coston2-explorer.flare.network/tx/${receipt?.hash}`,
    }),
  );

  const polled = await poll(env.EXT_PROXY_URL, instructionId);
  const evidence = {
    ok: Boolean(polled.body),
    teeId: "0x6516cE58ae346fB4c438463f05B17B50EeB1c8ed",
    teeStatus: 2,
    teeStatusLabel: "PRODUCTION",
    flareTeeManager: "0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE",
    extensionId: 65925,
    instructionSender: env.INSTRUCTION_SENDER,
    txHash: receipt?.hash,
    instructionId,
    explorer: `https://coston2-explorer.flare.network/tx/${receipt?.hash}`,
    httpStatus: polled.http,
    result: polled.body,
    simulatedTee: env.SIMULATED_TEE,
    extProxyUrl: env.EXT_PROXY_URL,
    payload: { name: "BeaconPolicy" },
    honesty: env.SIMULATED_TEE
      ? "SIMULATED_TEE PRODUCTION path — result signatures from registered TEE identity, not GCP Confidential Space"
      : "Hardware TEE path",
    timestamp: new Date().toISOString(),
  };

  const dir = join(process.cwd(), "docs", "evidence");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "fcc-instruction-result.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
  if (!evidence.ok) process.exit(1);
}

main();
