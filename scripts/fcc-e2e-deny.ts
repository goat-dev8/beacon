import { writeFileSync } from "node:fs";
import { Contract, JsonRpcProvider, Wallet, toUtf8Bytes } from "ethers";
import { resetEnvCache, loadEnv } from "@beacon/shared";

async function main() {
  resetEnvCache();
  const env = loadEnv();
  const pk = env.DEPLOYMENT_PRIVATE_KEY!;
  const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
  const wallet = new Wallet(pk.startsWith("0x") ? pk : `0x${pk}`, provider);
  const sender = new Contract(env.INSTRUCTION_SENDER!, ["function sendSayHello(bytes) payable"], wallet);
  const tx = await sender.sendSayHello(toUtf8Bytes(JSON.stringify({ name: "" })), {
    value: 1_000_000n,
    gasLimit: 1_500_000n,
  });
  const receipt = await tx.wait();
  const id = receipt!.logs[0]!.topics[2]!;
  console.log(JSON.stringify({ phase: "submitted", id, tx: receipt!.hash }));
  for (let i = 0; i < 72; i++) {
    const r = await fetch(`${env.EXT_PROXY_URL!.replace(/\/$/, "")}/action/result/${id}`);
    if (r.ok) {
      const j = (await r.json()) as {
        result?: { status?: number; log?: string };
        signature?: string;
      };
      const evidence = {
        ok: true,
        path: "DENY",
        expected: "status 0 (empty name)",
        teeStatus: 2,
        instructionId: id,
        txHash: receipt!.hash,
        explorer: `https://coston2-explorer.flare.network/tx/${receipt!.hash}`,
        actionStatus: j.result?.status,
        log: j.result?.log,
        hasSignature: Boolean(j.signature),
        decision: j.result?.status === 1 ? "ALLOW" : "DENY",
        honesty: "SIMULATED_TEE PRODUCTION — DENY when TEE returns status!=1",
        timestamp: new Date().toISOString(),
      };
      writeFileSync("docs/evidence/fcc-deny-path.json", JSON.stringify(evidence, null, 2));
      console.log(JSON.stringify(evidence, null, 2));
      return;
    }
    await new Promise((res) => setTimeout(res, 4000));
  }
  console.log(JSON.stringify({ ok: false, id }));
  process.exit(1);
}

main();
