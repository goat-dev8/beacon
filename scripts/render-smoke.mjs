/**
 * Full smoke against deployed Render Beacon API + local Coston2 contracts.
 */
import "dotenv/config";
import { JsonRpcProvider, Contract } from "ethers";

const BASE = (process.env.RENDER_API_URL || "https://beacon-api-97gl.onrender.com").replace(/\/$/, "");

async function check(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    console.log(`PASS ${name} (${Date.now() - t0}ms)`, detail ?? "");
    return true;
  } catch (err) {
    console.error(`FAIL ${name}:`, err instanceof Error ? err.message : err);
    return false;
  }
}

async function main() {
  const results = [];

  results.push(
    await check("health", async () => {
      const r = await fetch(`${BASE}/health`);
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      if (!j.ok) throw new Error(JSON.stringify(j));
      return `chainId=${j.chainId} simulatedTee=${j.simulatedTee}`;
    }),
  );

  results.push(
    await check("ready", async () => {
      const r = await fetch(`${BASE}/ready`);
      const j = await r.json();
      if (!r.ok) throw new Error(JSON.stringify(j));
      return JSON.stringify(j);
    }),
  );

  results.push(
    await check("services", async () => {
      const r = await fetch(`${BASE}/v1/services`);
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      const n = j.services?.length ?? 0;
      if (!n) throw new Error("empty catalog");
      return `services=${n}`;
    }),
  );

  let jobId = "";
  results.push(
    await check("create_job", async () => {
      const r = await fetch(`${BASE}/v1/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceId: "documents",
          briefText: "Write a short contractor onboarding SOP for Beacon Render live test.",
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(JSON.stringify(j));
      jobId = j.id || j.jobId || j.job?.id;
      if (!jobId) throw new Error(JSON.stringify(j));
      return `jobId=${jobId}`;
    }),
  );

  results.push(
    await check("quote_job", async () => {
      const r = await fetch(`${BASE}/v1/jobs/${jobId}/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(JSON.stringify(j));
      return `price=${j.quote?.priceDisplay || j.priceDisplay} capability=${j.quote?.capability || j.capability}`;
    }),
  );

  results.push(
    await check("get_job", async () => {
      const r = await fetch(`${BASE}/v1/jobs/${jobId}`);
      const j = await r.json();
      if (!r.ok) throw new Error(JSON.stringify(j));
      return `status=${j.status || j.job?.status}`;
    }),
  );

  const rpc = process.env.COSTON2_RPC_URL;
  const escrow = process.env.BEACON_ESCROW;
  const token = process.env.X402_TOKEN_ADDRESS;
  const sender = process.env.INSTRUCTION_SENDER;
  const provider = new JsonRpcProvider(rpc);

  results.push(
    await check("contracts_code", async () => {
      const codes = await Promise.all(
        [escrow, token, sender].map(async (a) => [(await provider.getCode(a)).length > 4, a]),
      );
      const bad = codes.filter(([ok]) => !ok);
      if (bad.length) throw new Error(`missing code at ${bad.map((x) => x[1]).join(",")}`);
      return "escrow+token+instructionSender live on Coston2";
    }),
  );

  results.push(
    await check("escrow_view", async () => {
      const c2 = new Contract(
        escrow,
        ["function locks(bytes32) view returns (address payer,uint256 amount,bool released,bool refunded)"],
        provider,
      );
      const zero = "0x" + "00".repeat(32);
      const lock = await c2.locks(zero);
      return `zeroLock payer=${lock.payer}`;
    }),
  );

  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed against ${BASE}`);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
