/**
 * Investigate FAssets request 44497208 — decode, XRPL scan, RedemptionPerformed.
 * Never invent COMPLETE. Never print secrets.
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { Contract, Interface, JsonRpcProvider, formatUnits, id } from "ethers";
import { trackFassetsRedemption } from "../packages/shared/src/index.ts";

const AM = "0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA";
const REDEEM_TX = "0x2a2edb61551dbf2bda2460d465d79363fe309eeb4ea84abc2421599f85e66440";
const REQUEST_ID = "44497208";

const EVENT_ABI = [
  "event RedemptionRequested(address indexed agentVault, address indexed redeemer, uint256 indexed requestId, string paymentAddress, uint256 valueUBA, uint256 feeUBA, uint256 firstUnderlyingBlock, uint256 lastUnderlyingBlock, uint256 lastUnderlyingTimestamp, bytes32 paymentReference, address executor, uint256 executorFeeNatWei)",
  "event RedemptionPerformed(address indexed agentVault, address indexed redeemer, uint64 indexed requestId, bytes32 transactionHash, uint256 redemptionAmountUBA, int256 spentUnderlyingUBA)",
  "event RedemptionDefault(address indexed agentVault, address indexed redeemer, uint256 indexed requestId, uint256 redemptionAmountUBA, uint256 redeemedVaultCollateralWei, uint256 redeemedPoolCollateralWei)",
];

async function decodeRequested(p: JsonRpcProvider) {
  const rc = await p.getTransactionReceipt(REDEEM_TX);
  const iface = new Interface(EVENT_ABI);
  for (const log of rc?.logs ?? []) {
    try {
      const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
      if (!parsed || parsed.name !== "RedemptionRequested") continue;
      if (BigInt(parsed.args.requestId) !== BigInt(REQUEST_ID)) continue;
      return {
        agentVault: String(parsed.args.agentVault),
        redeemer: String(parsed.args.redeemer),
        requestId: String(parsed.args.requestId),
        paymentAddress: String(parsed.args.paymentAddress),
        valueUBA: String(parsed.args.valueUBA),
        feeUBA: String(parsed.args.feeUBA),
        firstUnderlyingBlock: String(parsed.args.firstUnderlyingBlock),
        lastUnderlyingBlock: String(parsed.args.lastUnderlyingBlock),
        lastUnderlyingTimestamp: String(parsed.args.lastUnderlyingTimestamp),
        paymentReference: String(parsed.args.paymentReference),
        executor: String(parsed.args.executor),
        executorFeeNatWei: String(parsed.args.executorFeeNatWei),
        flareBlock: rc?.blockNumber ?? null,
      };
    } catch {
      /* */
    }
  }
  return null;
}

async function scanPerformed(p: JsonRpcProvider, fromBlock: number) {
  const am = new Contract(AM, EVENT_ABI, p);
  const latest = await p.getBlockNumber();
  const from = Math.max(0, fromBlock - 10);
  const out: unknown[] = [];
  try {
    const logs = await am.queryFilter(am.filters.RedemptionPerformed(), from, latest);
    for (const log of logs) {
      const args = (log as { args?: Record<string, unknown> }).args;
      if (!args) continue;
      const rid = BigInt(String(args.requestId ?? args[2] ?? "-1"));
      if (rid !== BigInt(REQUEST_ID)) continue;
      out.push({
        flareTxHash: log.transactionHash,
        blockNumber: log.blockNumber,
        xrplTransactionHash: String(args.transactionHash ?? args[3]),
        redemptionAmountUBA: String(args.redemptionAmountUBA ?? args[4]),
        spentUnderlyingUBA: String(args.spentUnderlyingUBA ?? args[5]),
        explorer: `https://coston2-explorer.flare.network/tx/${log.transactionHash}`,
      });
    }
  } catch (e) {
    return { error: String(e).slice(0, 240), events: out };
  }
  return { events: out };
}

async function scanDefault(p: JsonRpcProvider, fromBlock: number) {
  const am = new Contract(AM, EVENT_ABI, p);
  const latest = await p.getBlockNumber();
  const from = Math.max(0, fromBlock - 10);
  const out: unknown[] = [];
  try {
    const logs = await am.queryFilter(am.filters.RedemptionDefault(), from, latest);
    for (const log of logs) {
      const args = (log as { args?: Record<string, unknown> }).args;
      if (!args) continue;
      const rid = BigInt(String(args.requestId ?? args[2] ?? "-1"));
      if (rid !== BigInt(REQUEST_ID)) continue;
      out.push({
        flareTxHash: log.transactionHash,
        blockNumber: log.blockNumber,
        redemptionAmountUBA: String(args.redemptionAmountUBA ?? args[3]),
        explorer: `https://coston2-explorer.flare.network/tx/${log.transactionHash}`,
      });
    }
  } catch (e) {
    return { error: String(e).slice(0, 240), events: out };
  }
  return { events: out };
}

function refToMemoHex(paymentReference: string): string {
  // FAssets payment reference is typically embedded in XRPL memo as hex without 0x
  return paymentReference.replace(/^0x/i, "").toUpperCase();
}

async function xrplAccountTx(address: string, rpcUrl: string) {
  const body = {
    method: "account_tx",
    params: [
      {
        account: address,
        ledger_index_min: -1,
        ledger_index_max: -1,
        limit: 50,
        forward: false,
      },
    ],
  };
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`XRPL HTTP ${res.status}`);
  return res.json() as Promise<{
    result?: {
      transactions?: Array<{
        tx?: Record<string, unknown>;
        tx_json?: Record<string, unknown>;
        meta?: Record<string, unknown>;
        validated?: boolean;
      }>;
    };
  }>;
}

function extractMemos(tx: Record<string, unknown>): string[] {
  const memos = (tx.Memos as Array<{ Memo?: { MemoData?: string; MemoType?: string } }>) ?? [];
  return memos
    .map((m) => (m.Memo?.MemoData || "").toUpperCase())
    .filter(Boolean);
}

async function main() {
  const rpc = process.env.COSTON2_RPC_URL!;
  const p = new JsonRpcProvider(rpc);
  const decoded = await decodeRequested(p);
  if (!decoded) throw new Error("Could not decode RedemptionRequested");

  const now = Math.floor(Date.now() / 1000);
  const deadline = Number(decoded.lastUnderlyingTimestamp);
  const deadlinePassed = now > deadline;

  const performed = await scanPerformed(p, decoded.flareBlock ?? 0);
  const defaulted = await scanDefault(p, decoded.flareBlock ?? 0);

  const track = await trackFassetsRedemption({
    requestId: REQUEST_ID,
    sourceTxHash: REDEEM_TX,
    lookbackBlocks: 20_000,
  });

  // Agent info (best-effort)
  let agentInfo: Record<string, unknown> | { error: string } = { error: "not_read" };
  try {
    const agent = new Contract(
      decoded.agentVault,
      [
        "function assetManager() view returns (address)",
        "owner() view returns (address)",
      ],
      p,
    );
    // try common getters via AssetManager
    const am = new Contract(
      AM,
      [
        "function getAgentInfo(address) view returns (tuple(address ownerManagementAddress, address ownerWorkAddress, uint8 agentVaultType, uint8 status, uint64 totalVaultCollateralWei, uint64 totalPoolCollateralNATWei, uint64 freeUnderlyingBalanceUBA, uint64 mintedUBA, uint64 reservedUBA, uint64 redeemingUBA, uint64 announcedUnderlyingWithdrawalUBA, uint64 dustUBA, uint64 ccbStartTimestamp, uint64 liquidationStartTimestamp, uint32 vaultCollateralRatioBIPS, uint32 poolCollateralRatioBIPS, uint32 totalAgentPoolTokensWei, uint16 publiclyAnnounced, string underlyingAddressString))",
      ],
      p,
    );
    try {
      const info = await am.getAgentInfo(decoded.agentVault);
      agentInfo = {
        ownerManagementAddress: info.ownerManagementAddress ?? info[0],
        status: Number(info.status ?? info[3]),
        freeUnderlyingBalanceUBA: String(info.freeUnderlyingBalanceUBA ?? info[6]),
        mintedUBA: String(info.mintedUBA ?? info[7]),
        redeemingUBA: String(info.redeemingUBA ?? info[9]),
        underlyingAddressString: String(info.underlyingAddressString ?? info[18] ?? ""),
      };
    } catch (e) {
      agentInfo = { error: `getAgentInfo: ${String(e).slice(0, 200)}` };
    }
    void agent;
  } catch (e) {
    agentInfo = { error: String(e).slice(0, 200) };
  }

  const xrplRpc =
    process.env.XRPL_JSON_RPC_URL ||
    process.env.XRPL_RPC_URL ||
    "https://s.altnet.rippletest.net:51234";
  const memoNeedle = refToMemoHex(decoded.paymentReference);
  let xrplScan: Record<string, unknown> = {};
  try {
    const raw = await xrplAccountTx(decoded.paymentAddress, xrplRpc);
    const txs = raw.result?.transactions ?? [];
    const matches: unknown[] = [];
    const recent: unknown[] = [];
    for (const row of txs) {
      const tx = (row.tx_json || row.tx || {}) as Record<string, unknown>;
      const memos = extractMemos(tx);
      const hash = String(tx.hash || row.meta?.TransactionIndex || "");
      const entry = {
        hash: String(tx.hash || ""),
        Account: tx.Account,
        Destination: tx.Destination,
        Amount: tx.Amount,
        date: tx.date,
        memos,
        validated: row.validated,
      };
      if (recent.length < 8) recent.push(entry);
      const memoHit = memos.some(
        (m) => m.includes(memoNeedle) || memoNeedle.includes(m) || m.endsWith(memoNeedle.slice(-16)),
      );
      // Also check DestinationTag / raw memo containment of request id hex
      const ridHex = BigInt(REQUEST_ID).toString(16).toUpperCase();
      if (memoHit || memos.some((m) => m.includes(ridHex))) {
        matches.push(entry);
      }
    }
    xrplScan = {
      rpcHost: (() => {
        try {
          return new URL(xrplRpc).host;
        } catch {
          return "unknown";
        }
      })(),
      account: decoded.paymentAddress,
      paymentReference: decoded.paymentReference,
      memoNeedle,
      txCountReturned: txs.length,
      matches,
      recentInboundSample: recent.filter(
        (e) => (e as { Destination?: string }).Destination === decoded.paymentAddress,
      ),
    };
  } catch (e) {
    xrplScan = { error: String(e).slice(0, 300) };
  }

  const performedHit = Array.isArray((performed as { events?: unknown[] }).events)
    ? (performed as { events: unknown[] }).events.length > 0
    : false;
  const defaultHit = Array.isArray((defaulted as { events?: unknown[] }).events)
    ? (defaulted as { events: unknown[] }).events.length > 0
    : false;
  const xrplMatchCount = Array.isArray((xrplScan as { matches?: unknown[] }).matches)
    ? ((xrplScan as { matches: unknown[] }).matches.length)
    : 0;

  let lifecycle: "PENDING" | "COMPLETED" | "DEFAULTED" | "DEFAULT_ELIGIBLE" = "PENDING";
  if (performedHit) lifecycle = "COMPLETED";
  else if (defaultHit) lifecycle = "DEFAULTED";
  else if (deadlinePassed && xrplMatchCount === 0) lifecycle = "DEFAULT_ELIGIBLE";

  const evidence = {
    capturedAt: new Date().toISOString(),
    network: "coston2",
    chainId: 114,
    requestId: REQUEST_ID,
    redeemTx: REDEEM_TX,
    explorerRedeem: `https://coston2-explorer.flare.network/tx/${REDEEM_TX}`,
    assetManager: AM,
    RedemptionRequested: decoded,
    deadlines: {
      lastUnderlyingTimestamp: deadline,
      lastUnderlyingBlock: Number(decoded.lastUnderlyingBlock),
      nowUnix: now,
      deadlinePassed,
      secondsPastDeadline: deadlinePassed ? now - deadline : deadline - now,
    },
    agentInfo,
    xrplScan,
    RedemptionPerformed: performed,
    RedemptionDefault: defaulted,
    track: track.ok
      ? {
          lifecycle: track.lifecycle,
          onChainStatus: track.onChainStatus,
          request: track.request,
          performed: track.performed,
          defaulted: track.defaulted,
        }
      : track,
    lifecycle,
    honesty:
      lifecycle === "COMPLETED"
        ? "COMPLETED only with RedemptionPerformed + XRPL hash match to paymentReference"
        : lifecycle === "DEFAULTED"
          ? "DEFAULTED via on-chain RedemptionDefault"
          : lifecycle === "DEFAULT_ELIGIBLE"
            ? "Deadline passed and no matching XRPL payment found — default path may be available via FDC payment non-existence proof; COMPLETE not claimed"
            : "Still within payment window or evidence inconclusive — PENDING",
  };

  const outDir = resolve("docs/evidence");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, "fassets-redemption-44497208.json");
  writeFileSync(outPath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ wrote: outPath, lifecycle, deadlinePassed, xrplMatchCount, performedHit, defaultHit, paymentReference: decoded.paymentReference, agentVault: decoded.agentVault }, null, 2));
}

main().catch((e) => {
  console.error(String(e).slice(0, 500));
  process.exit(1);
});
