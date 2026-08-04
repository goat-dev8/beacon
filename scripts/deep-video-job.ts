/**
 * Video job against live Render API — prove MP4 / stills ship via Cloudflare Flux.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { JsonRpcProvider, Wallet, Contract } from "ethers";

const API = process.env.API_URL ?? "https://beacon-api-97gl.onrender.com";
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
  if (text.trimStart().startsWith("<!") || text.trimStart().startsWith("<html")) {
    throw new Error(`${res.status} ${path}: HTML gateway response (API restarting)`);
  }
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${res.status} ${path}: non-JSON ${text.slice(0, 120)}`);
  }
  if (!res.ok) throw new Error(`${res.status} ${path}: ${text}`);
  return data as T;
}

async function waitStatus(jobId: string, want: string[], ms = 420_000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const { job, acceptance } = await api<{
        job: { status: string };
        acceptance: { result?: string; summary?: string } | null;
      }>(`/v1/jobs/${jobId}`);
      console.log("status", job.status, acceptance?.result ?? "", acceptance?.summary ?? "");
      if (want.includes(job.status)) return job.status;
    } catch (err) {
      console.warn("poll soft-fail", err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`timeout waiting for ${want.join("|")}`);
}

async function main() {
  console.log("=== video job on", API, "===");
  const health = await api<{ ok: boolean }>("/health");
  console.log("health", health);

  const created = await api<{ jobId: string }>("/v1/jobs", {
    method: "POST",
    body: JSON.stringify({
      serviceId: "video",
      briefText: "Cat and dog running fast together, cinematic vertical ad, photoreal, energetic",
    }),
  });
  console.log("created", created.jobId);

  let quoted: { offerId: string; quote: { priceDisplay: string } } | null = null;
  for (let i = 0; i < 4; i++) {
    try {
      quoted = await api(`/v1/jobs/${created.jobId}/quote`, { method: "POST", body: "{}" });
      break;
    } catch (err) {
      console.warn("quote retry", i + 1, err instanceof Error ? err.message : err);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  if (!quoted) throw new Error("quote failed");
  console.log("quoted", quoted.quote.priceDisplay);

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

  const bal = await token.balanceOf(wallet.address);
  if (bal < 50_000000n) {
    const mintTx = await token.mint(wallet.address, 100_000000n);
    await mintTx.wait();
  }

  const amount = BigInt(Math.round(parseFloat(quoted.quote.priceDisplay.replace("$", "")) * 1e6));
  const validAfter = 0n;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const nonce = ("0x" +
    createHash("sha256")
      .update(created.jobId + Date.now())
      .digest("hex")) as `0x${string}`;
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
  console.log("lock", lockTx.hash);
  await lockTx.wait();

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

  let final = await waitStatus(created.jobId, ["CLOSED", "PASSED", "NEEDS_LOOK", "FAILED"]);
  if (final === "NEEDS_LOOK") {
    await api(`/v1/jobs/${created.jobId}/look`, {
      method: "POST",
      body: JSON.stringify({ decision: "accept" }),
    });
    final = await waitStatus(created.jobId, ["CLOSED", "PASSED", "FAILED"]);
  }
  if (final === "PASSED") final = await waitStatus(created.jobId, ["CLOSED", "FAILED"]);

  const arts = await api<{
    artifacts: Array<{ id: string; kind: string; meta: { mimeType?: string } | null }>;
  }>(`/v1/jobs/${created.jobId}/artifacts`);
  console.log(
    "artifacts",
    arts.artifacts.map((a) => ({ kind: a.kind, mime: a.meta?.mimeType })),
  );
  const video = arts.artifacts.find((a) => a.kind === "video");
  const image = arts.artifacts.find((a) => a.kind === "image");
  const lock = await escrow.locks(jobHash);
  console.log("final", final, { released: lock[2], refunded: lock[3], video: !!video, image: !!image });
  if (!video && !image) throw new Error("video/image artifact missing");
  if (final !== "CLOSED" && final !== "PASSED") throw new Error(`bad final ${final}`);
  console.log("=== VIDEO PASS ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
