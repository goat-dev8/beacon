/**
 * Deep job loop against local API with embedded workers:
 * create → quote → escrow lock → approve → wait CLOSED/PASS
 */
import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { JsonRpcProvider, Wallet, Contract } from "ethers";

const API = process.env.API_URL ?? "http://127.0.0.1:3001";
const RPC = process.env.COSTON2_RPC_URL!;
const TOKEN = process.env.X402_TOKEN_ADDRESS!;
const ESCROW = process.env.BEACON_ESCROW!;
const PK = process.env.DEPLOYER_PRIVATE_KEY!;

function jobIdToBytes32(jobId: string): string {
  return "0x" + createHash("sha256").update(jobId).digest("hex");
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${res.status} ${path}: ${text}`);
  return data as T;
}

async function waitStatus(jobId: string, want: string[], ms = 180_000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const { job, acceptance } = await api<{
      job: { status: string };
      acceptance: { result?: string; summary?: string; notes?: string[] } | null;
    }>(`/v1/jobs/${jobId}`);
    console.log("status", job.status, acceptance?.result ?? "", acceptance?.summary ?? "");
    if (want.includes(job.status)) return job.status;
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw new Error(`timeout waiting for ${want.join("|")}`);
}

async function main() {
  console.log("=== deep API job ===", API);
  const health = await api<{ ok: boolean }>("/health");
  console.log("health", health);

  const created = await api<{ jobId: string }>("/v1/jobs", {
    method: "POST",
    body: JSON.stringify({
      serviceId: "documents",
      briefText: "Write a one-page Beacon onboarding SOP for designers. Clear steps, no jargon.",
    }),
  });
  console.log("created", created.jobId);

  const quoted = await api<{ offerId: string; quote: { priceDisplay: string } }>(
    `/v1/jobs/${created.jobId}/quote`,
    { method: "POST", body: "{}" },
  );
  console.log("quoted", quoted.quote.priceDisplay, quoted.offerId);

  const provider = new JsonRpcProvider(RPC);
  const wallet = new Wallet(PK, provider);
  const token = new Contract(
    TOKEN,
    [
      "function mint(address to,uint256 amount)",
      "function balanceOf(address) view returns (uint256)",
      "function name() view returns (string)",
      "function version() view returns (string)",
    ],
    wallet,
  );
  const escrow = new Contract(
    ESCROW,
    [
      "function lockWithAuthorization(bytes32,address,uint256,uint256,uint256,bytes32,bytes)",
      "function locks(bytes32) view returns (address,uint256,bool,bool)",
    ],
    wallet,
  );

  // parse $x.xx → 6 decimals from quote display is fragile; use auth amount from offer via price
  const priceMatch = quoted.quote.priceDisplay.replace(/[^0-9.]/g, "");
  const [w, f = ""] = priceMatch.split(".");
  const amount = BigInt(w) * 1_000_000n + BigInt((f + "000000").slice(0, 6));

  const bal = await token.balanceOf(wallet.address);
  if (bal < amount) {
    await (await token.mint(wallet.address, 1_000_000_000n)).wait();
  }

  const validAfter = BigInt(Math.floor(Date.now() / 1000) - 60);
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const nonce = ("0x" + randomBytes(32).toString("hex")) as `0x${string}`;
  const jobHash = jobIdToBytes32(created.jobId);
  const domain = {
    name: await token.name(),
    version: await token.version(),
    chainId: 114,
    verifyingContract: TOKEN,
  };
  const types = {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  };
  const message = {
    from: wallet.address,
    to: ESCROW,
    value: amount,
    validAfter,
    validBefore,
    nonce,
  };
  const signature = await wallet.signTypedData(domain, types, message);
  const lockTx = await escrow.lockWithAuthorization(
    jobHash,
    wallet.address,
    amount,
    validAfter,
    validBefore,
    nonce,
    signature,
  );
  console.log("lock", (await lockTx.wait())?.hash);

  await api(`/v1/jobs/${created.jobId}/approve`, {
    method: "POST",
    body: JSON.stringify({
      offerId: quoted.offerId,
      authorization: {
        payer: wallet.address,
        payee: ESCROW,
        amount: amount.toString(),
        validAfter: validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce,
        signature,
      },
    }),
  });
  console.log("approved");

  let final = await waitStatus(created.jobId, ["CLOSED", "PASSED", "NEEDS_LOOK", "FAILED"]);
  if (final === "NEEDS_LOOK") {
    console.log("auto-accept look");
    await api(`/v1/jobs/${created.jobId}/look`, {
      method: "POST",
      body: JSON.stringify({ decision: "accept" }),
    });
    final = await waitStatus(created.jobId, ["CLOSED", "PASSED", "FAILED"]);
  }
  if (final === "PASSED") {
    console.log("waiting settler for CLOSED…");
    final = await waitStatus(created.jobId, ["CLOSED", "FAILED"]);
  }
  const lock = await escrow.locks(jobHash);
  console.log("final", final, {
    released: lock[2],
    refunded: lock[3],
    amount: lock[1].toString(),
  });

  if (final === "FAILED") {
    throw new Error("job FAILED — expected PASS/CLOSED for documents");
  }
  if (final === "CLOSED" || final === "PASSED") {
    if (!lock[2] && !lock[3]) throw new Error("escrow neither released nor refunded");
  }
  if (final !== "CLOSED" && final !== "PASSED") {
    throw new Error(`unexpected final ${final}`);
  }
  console.log("=== PASS ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
