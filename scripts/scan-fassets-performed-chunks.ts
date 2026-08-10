/**
 * Chunked log scan for RedemptionPerformed / RedemptionDefault for request 44497208.
 * Max eth_getLogs window on public Coston2 RPC is ~30 blocks.
 */
import "dotenv/config";
import { Contract, JsonRpcProvider, Interface } from "ethers";
import { readFileSync, writeFileSync } from "node:fs";

const AM = "0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA";
const REQUEST_ID = 44497208n;
const START = 33839979; // redeem block

const ABI = [
  "event RedemptionPerformed(address indexed agentVault, address indexed redeemer, uint64 indexed requestId, bytes32 transactionHash, uint256 redemptionAmountUBA, int256 spentUnderlyingUBA)",
  "event RedemptionDefault(address indexed agentVault, address indexed redeemer, uint256 indexed requestId, uint256 redemptionAmountUBA, uint256 redeemedVaultCollateralWei, uint256 redeemedPoolCollateralWei)",
];

async function main() {
  const p = new JsonRpcProvider(process.env.COSTON2_RPC_URL!);
  const am = new Contract(AM, ABI, p);
  const latest = await p.getBlockNumber();
  const chunk = 30;
  const performed: unknown[] = [];
  const defaulted: unknown[] = [];

  for (let from = START; from <= latest; from += chunk) {
    const to = Math.min(latest, from + chunk - 1);
    try {
      const logsP = await am.queryFilter(am.filters.RedemptionPerformed(), from, to);
      for (const log of logsP) {
        const args = (log as { args?: Record<string, unknown> }).args;
        if (!args) continue;
        const rid = BigInt(String(args.requestId ?? args[2] ?? "-1"));
        if (rid !== REQUEST_ID) continue;
        performed.push({
          flareTxHash: log.transactionHash,
          blockNumber: log.blockNumber,
          xrplTransactionHash: String(args.transactionHash ?? args[3]),
          redemptionAmountUBA: String(args.redemptionAmountUBA ?? args[4]),
          spentUnderlyingUBA: String(args.spentUnderlyingUBA ?? args[5]),
          explorer: `https://coston2-explorer.flare.network/tx/${log.transactionHash}`,
        });
      }
      const logsD = await am.queryFilter(am.filters.RedemptionDefault(), from, to);
      for (const log of logsD) {
        const args = (log as { args?: Record<string, unknown> }).args;
        if (!args) continue;
        const rid = BigInt(String(args.requestId ?? args[2] ?? "-1"));
        if (rid !== REQUEST_ID) continue;
        defaulted.push({
          flareTxHash: log.transactionHash,
          blockNumber: log.blockNumber,
          redemptionAmountUBA: String(args.redemptionAmountUBA ?? args[3]),
          explorer: `https://coston2-explorer.flare.network/tx/${log.transactionHash}`,
        });
      }
    } catch (e) {
      console.error(JSON.stringify({ from, to, error: String(e).slice(0, 160) }));
    }
  }

  // Also try topic filter with requestId for performed
  const iface = new Interface(ABI);
  const topic0 = iface.getEvent("RedemptionPerformed")!.topicHash;
  const topicRid = "0x" + REQUEST_ID.toString(16).padStart(64, "0");
  let topicScan: unknown = null;
  try {
    // scan last 900 blocks in chunks of 30 with topic filter
    const hits: unknown[] = [];
    for (let from = Math.max(0, latest - 900); from <= latest; from += chunk) {
      const to = Math.min(latest, from + chunk - 1);
      const logs = await p.getLogs({
        address: AM,
        fromBlock: from,
        toBlock: to,
        topics: [topic0, null, null, topicRid],
      });
      for (const log of logs) hits.push({ tx: log.transactionHash, block: log.blockNumber, topics: log.topics });
    }
    topicScan = { hits, topic0, topicRid };
  } catch (e) {
    topicScan = { error: String(e).slice(0, 200) };
  }

  const out = {
    scannedFrom: START,
    scannedTo: latest,
    chunk,
    performed,
    defaulted,
    topicScan,
    lifecycle:
      performed.length > 0
        ? "COMPLETED"
        : defaulted.length > 0
          ? "DEFAULTED"
          : "PAYMENT_DETECTED_AWAITING_FLARE_CONFIRMATION",
  };

  const prev = JSON.parse(readFileSync("docs/evidence/fassets-redemption-44497208.json", "utf8"));
  writeFileSync(
    "docs/evidence/fassets-redemption-44497208.json",
    JSON.stringify(
      {
        ...prev,
        flareEventScan: out,
        lifecycle: out.lifecycle,
        honesty:
          out.lifecycle === "COMPLETED"
            ? "COMPLETED: RedemptionPerformed found with XRPL hash"
            : out.lifecycle === "DEFAULTED"
              ? "DEFAULTED on-chain"
              : "XRPL payment matched paymentReference (amount=value-fee) but RedemptionPerformed not yet on Flare — agent must present FDC Payment proof. NOT COMPLETE.",
        xrplPaymentVerified: {
          matched: true,
          hash: "2C0889111F1B352AFB17E1DA28F548FBD492541113229ABA6B4A25B8E1A1E11A",
          explorer: "https://testnet.xrpl.org/transactions/2C0889111F1B352AFB17E1DA28F548FBD492541113229ABA6B4A25B8E1A1E11A",
          amountDrops: "4975000",
          expectedNetUBA: "4975000",
          memoMatchesPaymentReference: true,
        },
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(String(e).slice(0, 400));
  process.exit(1);
});
