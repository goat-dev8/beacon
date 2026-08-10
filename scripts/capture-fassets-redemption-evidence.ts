/**
 * Capture FAssets prepare/queue/track evidence (read-only + prepare calldata).
 * Never invents COMPLETE without RedemptionPerformed XRPL hash.
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  loadEnv,
  prepareFassetsRedeemLots,
  prepareFassetsRedeemAmount,
  readFassetsRedemptionQueue,
  trackFassetsRedemption,
} from "../packages/shared/src/index.ts";

async function main() {
  const env = loadEnv();
  const prep = await prepareFassetsRedeemLots(
    { lots: 1, underlyingAddress: "rSHYuiEvsYsKR8uUHhBTuGP5zjRcGt4nm" },
    env,
  );
  const prepAmt = await prepareFassetsRedeemAmount(
    { amountUBA: "1000000", underlyingAddress: "rSHYuiEvsYsKR8uUHhBTuGP5zjRcGt4nm" },
    env,
  );
  const queue = await readFassetsRedemptionQueue({ pageSize: 5, env });
  const track = await trackFassetsRedemption({
    requestId: "6797056",
    lookbackBlocks: 80_000,
    env,
  });

  const evidence = {
    capturedAt: new Date().toISOString(),
    network: "coston2",
    chainId: 114,
    prepareLots: prep.ok
      ? {
          ok: true,
          kind: prep.kind,
          assetManager: prep.assetManager,
          fAsset: prep.fAsset,
          amountUBA: prep.amountUBA,
          amountDisplay: prep.amountDisplay,
          lifecycleNext: prep.lifecycleNext,
          honesty: prep.honesty,
        }
      : prep,
    prepareAmount: prepAmt.ok
      ? {
          ok: true,
          kind: prepAmt.kind,
          amountUBA: prepAmt.amountUBA,
          minimumRedeemAmountUBA: prepAmt.minimumRedeemAmountUBA,
          lifecycleNext: prepAmt.lifecycleNext,
        }
      : prepAmt,
    queue: queue.ok
      ? {
          ok: true,
          assetManager: queue.assetManager,
          ticketCount: queue.tickets.length,
          next: queue.nextRedemptionTicketId,
          sample: queue.tickets.slice(0, 3),
          honesty: queue.honesty,
        }
      : queue,
    trackSample: track.ok
      ? {
          ok: true,
          requestId: track.requestId,
          lifecycle: track.lifecycle,
          onChainStatus: track.onChainStatus,
          hasPerformed: Boolean(track.performed),
          performed: track.performed,
          honesty: track.honesty,
        }
      : track,
    honesty:
      "REAL prepare + queue + status track. COMPLETED only if RedemptionPerformed XRPL hash present — never invent.",
  };

  const outDir = resolve("docs/evidence");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, "fassets-redemption.json");
  writeFileSync(outPath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ wrote: outPath, ...evidence }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
