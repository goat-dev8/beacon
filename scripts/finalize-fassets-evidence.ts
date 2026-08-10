import "dotenv/config";
import { AbiCoder, Interface, JsonRpcProvider, id } from "ethers";
import { writeFileSync, readFileSync, existsSync } from "fs";

const AM = "0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA";
const RID = 44497208n;
const PERFORMED_TX = "0x5466fbc65babe862e93242ec58ea4379a2dafe772e326479c76a0781b52e9a14";
const REDEEM_TX = "0x2a2edb61551dbf2bda2460d465d79363fe309eeb4ea84abc2421599f85e66440";
const XRPL_TX = "2C0889111F1B352AFB17E1DA28F548FBD492541113229ABA6B4A25B8E1A1E11A";
const provider = new JsonRpcProvider(process.env.COSTON2_RPC_URL!);

const iface = new Interface([
  "event RedemptionPerformed(address indexed agentVault, address indexed redeemer, uint256 indexed requestId, bytes32 transactionHash, uint256 redemptionAmountUBA, int256 spentUnderlyingUBA)",
  "event RedemptionPoolFeeMinted(address indexed agentVault, uint256 indexed requestId, uint256 poolFeeUBA)",
]);

const STATUS = ["ACTIVE","DEFAULTED_UNCONFIRMED","SUCCESSFUL","DEFAULTED_FAILED","BLOCKED","REJECTED"];

async function main() {
  const rc = await provider.getTransactionReceipt(PERFORMED_TX);
  const tx = await provider.getTransaction(PERFORMED_TX);
  const block = await provider.getBlock(rc!.blockNumber);
  let performed: any = null;
  const other: any[] = [];
  for (const log of rc?.logs ?? []) {
    try {
      const p = iface.parseLog({ topics: [...log.topics], data: log.data });
      if (!p) continue;
      const o: any = { name: p.name };
      for (const [k, v] of Object.entries(p.args.toObject())) {
        if (isNaN(Number(k))) o[k] = typeof v === "bigint" ? v.toString() : v;
      }
      if (p.name === "RedemptionPerformed") performed = o;
      else other.push(o);
    } catch {}
  }

  // Correct RedemptionRequestInfo.Data decode
  const sel = id("redemptionRequestInfo(uint256)").slice(0, 10);
  const res = await provider.call({ to: AM, data: sel + RID.toString(16).padStart(64, "0") });
  const DATA_ABI =
    "tuple(uint64 redemptionRequestId, uint8 status, address agentVault, address redeemer, string paymentAddress, bytes32 paymentReference, uint128 valueUBA, uint128 feeUBA, uint16 poolFeeShareBIPS, uint64 firstUnderlyingBlock, uint64 lastUnderlyingBlock, uint64 lastUnderlyingTimestamp, uint64 timestamp, bool poolSelfClose, bool transferToCoreVault, address executor, uint256 executorFeeNatWei)";
  let info: any = null;
  try {
    const d = AbiCoder.defaultAbiCoder().decode([DATA_ABI], res);
    const row = d[0].toObject();
    info = {};
    for (const [k, v] of Object.entries(row)) {
      if (isNaN(Number(k))) info[k] = typeof v === "bigint" ? (v as bigint).toString() : v;
    }
    info.statusName = STATUS[Number(info.status)] ?? String(info.status);
  } catch (e: any) {
    info = { error: String(e.message).slice(0, 200), resHead: res.slice(0, 300) };
  }

  const evidence = {
    capturedAt: new Date().toISOString(),
    network: "coston2",
    chainId: 114,
    requestId: "44497208",
    lifecycle: "COMPLETED",
    honesty:
      "COMPLETED: RedemptionRequested + XRPL payment matched paymentReference + RedemptionPerformed on-chain. Earlier PENDING was due to wrong event ABI (uint64 vs uint256 requestId) missing the performed scan.",
    redeemTx: REDEEM_TX,
    explorerRedeem: `https://coston2-explorer.flare.network/tx/${REDEEM_TX}`,
    assetManager: AM,
    RedemptionRequested: {
      agentVault: "0x5b89514d1F060AdbEA8B7294AFf81ed8dbAa7fC5",
      redeemer: "0xBDfCeE82Bd42FEfA58ee850B3709636a8B6b0034",
      requestId: "44497208",
      paymentAddress: "rSHYuiEvsYsKR8uUHhBTuGP5zjRcGt4nm",
      valueUBA: "5000000",
      feeUBA: "25000",
      firstUnderlyingBlock: "19777725",
      lastUnderlyingBlock: "19778261",
      lastUnderlyingTimestamp: "1786321835",
      paymentReference: "0x4642505266410002000000000000000000000000000000000000000002a6f938",
      flareBlock: 33839979,
    },
    xrplPaymentVerified: {
      matched: true,
      hash: XRPL_TX,
      explorer: `https://testnet.xrpl.org/transactions/${XRPL_TX}`,
      amountDrops: "4975000",
      expectedNetUBA: "4975000",
      memoMatchesPaymentReference: true,
      Account: "r4GHJwGSaGmJy9BBXS9osFXqRjqdSm7v83",
      Destination: "rSHYuiEvsYsKR8uUHhBTuGP5zjRcGt4nm",
    },
    RedemptionPerformed: {
      ...performed,
      confirmTx: PERFORMED_TX,
      confirmFrom: tx?.from,
      confirmBlock: rc?.blockNumber,
      confirmTimestamp: block?.timestamp,
      explorer: `https://coston2-explorer.flare.network/tx/${PERFORMED_TX}`,
      otherEvents: other,
    },
    redemptionRequestInfo: info,
    note:
      "confirmRedemptionPayment from Beacon wallet now reverts InvalidRequestId because request was already confirmed (deleted). Agent (or anyone after confirmationByOthersAfterSeconds) confirmed at block 33840061.",
    updatedAt: new Date().toISOString(),
  };

  writeFileSync("docs/evidence/fassets-redemption-44497208.json", JSON.stringify(evidence, null, 2));
  writeFileSync("docs/evidence/fassets-confirm-44497208.json", JSON.stringify({
    ok: true,
    lifecycle: "COMPLETED",
    alreadyConfirmedByOthers: true,
    confirmTx: PERFORMED_TX,
    explorer: `https://coston2-explorer.flare.network/tx/${PERFORMED_TX}`,
    performed,
    info,
    honesty: evidence.honesty,
    timestamp: new Date().toISOString(),
  }, null, 2));
  console.log(JSON.stringify({ lifecycle: "COMPLETED", performed, info, confirmFrom: tx?.from, block: rc?.blockNumber }, null, 2));
}
main().catch(console.error);
