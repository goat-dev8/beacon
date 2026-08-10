import "dotenv/config";
import { Contract, JsonRpcProvider, Interface } from "ethers";
import { writeFileSync, readFileSync } from "node:fs";
import { trackFassetsRedemption } from "../packages/shared/src/index.ts";

async function main() {
  const rpc = process.env.COSTON2_RPC_URL!;
  const p = new JsonRpcProvider(rpc);
  const amAddr = "0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA";
  const txHash = "0x2a2edb61551dbf2bda2460d465d79363fe309eeb4ea84abc2421599f85e66440";
  const requestId = "44497208";
  const rc = await p.getTransactionReceipt(txHash);
  const iface = new Interface([
    "event RedemptionRequested(address indexed agentVault, address indexed redeemer, uint256 indexed requestId, string paymentAddress, uint256 valueUBA, uint256 feeUBA, uint256 firstUnderlyingBlock, uint256 lastUnderlyingBlock, uint256 lastUnderlyingTimestamp, bytes32 paymentReference, address executor, uint256 executorFeeNatWei)",
    "event RedemptionAmountIncomplete(address indexed redeemer, uint256 remainingAmountUBA)",
  ]);
  const decoded: unknown[] = [];
  for (const log of rc?.logs ?? []) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed) {
        const args: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed.args)) {
          if (/^\d+$/.test(k)) continue;
          args[k] = typeof v === "bigint" ? v.toString() : String(v);
        }
        decoded.push({ name: parsed.name, args });
      }
    } catch {
      /* */
    }
  }

  const am = new Contract(
    amAddr,
    [
      "function redemptionRequestInfo(uint256) view returns (tuple(address agentVault, address redeemer, string paymentAddress, bool paymentAddressValid, uint256 valueUBA, uint256 feeUBA, uint256 firstUnderlyingBlock, uint256 lastUnderlyingBlock, uint256 lastUnderlyingTimestamp, bytes32 paymentReference, address executor, uint256 executorFeeNatWei, uint64 status, uint64 timestamp))",
    ],
    p,
  );
  let info: Record<string, unknown> | null = null;
  let infoErr: string | null = null;
  try {
    const i = await am.redemptionRequestInfo(BigInt(requestId));
    info = {
      agentVault: i.agentVault,
      redeemer: i.redeemer,
      paymentAddress: i.paymentAddress,
      valueUBA: i.valueUBA.toString(),
      status: Number(i.status),
      timestamp: i.timestamp.toString(),
    };
  } catch (e) {
    infoErr = String(e).slice(0, 300);
  }

  const track = await trackFassetsRedemption({ requestId, lookbackBlocks: 5_000 });
  const out = {
    network: "coston2",
    chainId: 114,
    redeemTx: txHash,
    explorer: `https://coston2-explorer.flare.network/tx/${txHash}`,
    requestId,
    receiptStatus: rc?.status ?? null,
    decodedEvents: decoded,
    redemptionRequestInfo: info,
    redemptionRequestInfoError: infoErr,
    track: track.ok
      ? {
          lifecycle: track.lifecycle,
          onChainStatus: track.onChainStatus,
          request: track.request,
          performed: track.performed,
        }
      : track,
    lifecycleClaim: "PENDING",
    honesty:
      "REAL redeemAmount tx confirmed. COMPLETED not claimed — awaiting agent XRPL payment + RedemptionPerformed.",
  };

  const prev = JSON.parse(readFileSync("docs/evidence/fassets-redemption-request.json", "utf8"));
  writeFileSync(
    "docs/evidence/fassets-redemption-request.json",
    JSON.stringify({ ...prev, verification: out }, null, 2),
  );
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(String(e).slice(0, 400));
  process.exit(1);
});
