/**
 * Attempt maximum-real FAssets redeemAmount on Coston2.
 * Funds FXRP via Beacon Safe swap if signer balance < minimumRedeemAmountUBA.
 * Marks lifecycle PENDING after RedemptionRequested — never COMPLETE without XRPL evidence.
 *
 * Env:
 *   FASSETS_SUBMIT=true  required to send txs
 *   FASSETS_UNDERLYING   XRPL classic address (default docs example)
 */
import "dotenv/config";
import { Contract, JsonRpcProvider, Wallet, formatUnits, parseUnits } from "ethers";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  loadEnv,
  prepareFassetsRedeemAmount,
  trackFassetsRedemption,
  executeBeaconSafeSwap,
} from "../packages/shared/src/index.ts";

const FXRP = "0x0b6A3645c240605887a5532109323A3E12273dc7";
const AM = "0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA";

async function main() {
  const env = loadEnv();
  const submit = String(process.env.FASSETS_SUBMIT || "").toLowerCase() === "true";
  const underlying =
    process.env.FASSETS_UNDERLYING || "rSHYuiEvsYsKR8uUHhBTuGP5zjRcGt4nm";
  const key = process.env.DEPLOYER_PRIVATE_KEY || process.env.SETTLER_PRIVATE_KEY;
  if (!key) throw new Error("DEPLOYER/SETTLER key missing");

  const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
  const wallet = new Wallet(key, provider);
  const token = new Contract(
    FXRP,
    [
      "function balanceOf(address) view returns (uint256)",
      "function decimals() view returns (uint8)",
      "function approve(address,uint256) returns (bool)",
      "function allowance(address,address) view returns (uint256)",
    ],
    wallet,
  );
  const am = new Contract(
    AM,
    [
      "function minimumRedeemAmountUBA() view returns (uint256)",
      "function redeemAmount(uint256,string,address) payable returns (uint256)",
      "event RedemptionRequested(address indexed agentVault, address indexed redeemer, uint256 indexed requestId, string paymentAddress, uint256 valueUBA, uint256 feeUBA, uint256 firstUnderlyingBlock, uint256 lastUnderlyingBlock, uint256 lastUnderlyingTimestamp, bytes32 paymentReference, address executor, uint256 executorFeeNatWei)",
    ],
    wallet,
  );

  const decimals = Number(await token.decimals());
  const minUBA = (await am.minimumRedeemAmountUBA()) as bigint;
  let bal = (await token.balanceOf(wallet.address)) as bigint;

  const fundLog: Record<string, unknown> = { needed: false };
  if (bal < minUBA) {
    fundLog.needed = true;
    fundLog.before = formatUnits(bal, decimals);
    // ~6 USDT0 → FXRP should cover 5 FXRP min with buffer under Safe per-trade 10.
    if (submit) {
      const swap = await executeBeaconSafeSwap(
        {
          amountInUnits: "6",
          recipient: wallet.address,
          address: process.env.OWNER_ADDRESS || undefined,
        },
        env,
      );
      fundLog.swap = swap.ok
        ? { ok: true, txHash: (swap as { txHash?: string }).txHash || (swap as { hash?: string }).hash }
        : { ok: false, error: (swap as { error?: string }).error };
      bal = (await token.balanceOf(wallet.address)) as bigint;
      fundLog.after = formatUnits(bal, decimals);
    } else {
      fundLog.note = "Dry-run: would Safe-swap ~6 USDT0→FXRP to fund min redeem";
    }
  }

  const amountUBA = minUBA;
  const prep = await prepareFassetsRedeemAmount(
    { amountUBA: amountUBA.toString(), underlyingAddress: underlying },
    env,
  );

  const result: Record<string, unknown> = {
    capturedAt: new Date().toISOString(),
    network: "coston2",
    chainId: 114,
    submit,
    signer: wallet.address,
    underlying,
    minRedeemAmountUBA: minUBA.toString(),
    amountUBA: amountUBA.toString(),
    amountDisplay: formatUnits(amountUBA, decimals),
    fxrpBalance: formatUnits(bal, decimals),
    fundLog,
    prepare: prep.ok
      ? { ok: true, kind: prep.kind, assetManager: prep.assetManager, lifecycleNext: prep.lifecycleNext }
      : prep,
  };

  if (!submit) {
    result.lifecycle = "PREPARED";
    result.blocker =
      bal < minUBA
        ? `Signer FXRP ${formatUnits(bal, decimals)} < min ${formatUnits(minUBA, decimals)}. Set FASSETS_SUBMIT=true to Safe-swap fund + redeemAmount.`
        : "Dry-run only. Set FASSETS_SUBMIT=true to broadcast approve+redeemAmount.";
    result.honesty =
      "No COMPLETE claimed. PREPARE is real calldata; REQUEST needs submit; COMPLETE needs RedemptionPerformed XRPL hash.";
  } else if (bal < amountUBA) {
    result.lifecycle = "BLOCKED";
    result.blocker = `Insufficient FXRP after funding attempt: have ${formatUnits(bal, decimals)}, need ${formatUnits(amountUBA, decimals)}`;
  } else if (!prep.ok) {
    result.lifecycle = "BLOCKED";
    result.blocker = prep.error;
  } else {
    const allowance = (await token.allowance(wallet.address, AM)) as bigint;
    if (allowance < amountUBA) {
      const txA = await token.approve(AM, amountUBA);
      const rcA = await txA.wait();
      result.approveTx = txA.hash;
      result.approveStatus = rcA?.status;
    }
    const tx = await am.redeemAmount(amountUBA, underlying, "0x0000000000000000000000000000000000000000");
    const rc = await tx.wait();
    result.redeemTx = tx.hash;
    result.redeemStatus = rc?.status;
    result.explorer = `https://coston2-explorer.flare.network/tx/${tx.hash}`;

    let requestId: string | null = null;
    try {
      for (const log of rc?.logs ?? []) {
        try {
          const parsed = am.interface.parseLog(log);
          if (parsed?.name === "RedemptionRequested") {
            requestId = parsed.args.requestId.toString();
            break;
          }
        } catch {
          /* not our event */
        }
      }
    } catch {
      /* */
    }
    result.requestId = requestId;
    result.lifecycle = "PENDING";
    if (requestId) {
      const track = await trackFassetsRedemption({ requestId, lookbackBlocks: 5_000, env });
      result.track = track.ok
        ? {
            lifecycle: track.lifecycle,
            onChainStatus: track.onChainStatus,
            hasPerformed: Boolean(track.performed),
          }
        : track;
    }
    result.honesty =
      "Redemption REQUESTED on Coston2. Lifecycle=PENDING until RedemptionPerformed with XRPL transactionHash. Not COMPLETE.";
  }

  const outDir = resolve("docs/evidence");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, "fassets-redemption-request.json");
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ wrote: outPath, ...result }, null, 2));
}

main().catch((e) => {
  console.error(String(e).slice(0, 300));
  process.exit(1);
});
