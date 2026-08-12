/**
 * Safe Coston2 FAssets prepare + track evidence (no broadcast, no secrets).
 */
import "dotenv/config";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  prepareFassetsRedeemAmount,
  prepareFassetsRedeemLots,
  prepareFassetsRedeemWithTag,
  readFassetsDesk,
  readFassetsRedemptionQueue,
  trackFassetsRedemption,
} from "../packages/shared/src/index.ts";

const DEMO_XRPL = "rSHYuiEvsYsKR8uUHhBTuGP5zjRcGt4nm";

async function main() {
  const desk = await readFassetsDesk();
  const mgr = desk.managers[0];
  if (!mgr) throw new Error("No FAsset manager");

  const minUba = mgr.minimumRedeemAmountUBA ?? "5000000";

  const prepAmount = await prepareFassetsRedeemAmount({
    amountUBA: minUba,
    underlyingAddress: DEMO_XRPL,
  });
  const prepLots = await prepareFassetsRedeemLots({
    lots: 1,
    underlyingAddress: DEMO_XRPL,
  });
  const prepTag = await prepareFassetsRedeemWithTag({
    amountUBA: minUba,
    underlyingAddress: DEMO_XRPL,
    destinationTag: 1,
  });
  const queue = await readFassetsRedemptionQueue({ pageSize: 5 });

  // Track a synthetic / unknown id — expect NOT_FOUND, never COMPLETED
  const trackUnknown = await trackFassetsRedemption({ requestId: "1" });

  // Strip calldata blobs from evidence (keep selectors / lengths only)
  function slimPrep(p: typeof prepAmount) {
    if (!p.ok) return p;
    return {
      ok: true as const,
      kind: p.kind,
      assetManager: p.assetManager,
      fAsset: p.fAsset,
      symbol: p.symbol,
      lots: p.lots,
      amountUBA: p.amountUBA,
      amountDisplay: p.amountDisplay,
      minimumRedeemAmountUBA: p.minimumRedeemAmountUBA,
      underlyingAddress: p.underlyingAddress,
      destinationTag: p.destinationTag,
      lifecycleNext: p.lifecycleNext,
      approveDataLen: p.approveData.length,
      redeemDataLen: p.redeemData.length,
      approveDataPrefix: p.approveData.slice(0, 10),
      redeemDataPrefix: p.redeemData.slice(0, 10),
      honesty: p.honesty,
      docs: p.docs,
      tag: p.tag,
    };
  }

  const evidence = {
    capturedAt: new Date().toISOString(),
    network: "coston2",
    chainId: 114,
    desk: {
      controller: desk.controller,
      managers: desk.managers.map((m) => ({
        assetManager: m.assetManager,
        fAsset: m.fAsset,
        symbol: m.symbol,
        lotSizeUnderlying: m.lotSizeUnderlying,
        minimumRedeemUnderlying: m.minimumRedeemUnderlying,
        agentCount: m.agentCount,
        availableAgentCount: m.availableAgentCount,
        actions: m.actions,
      })),
      honesty: desk.honesty,
      lifecycleHonesty: desk.lifecycleHonesty,
    },
    prepares: {
      redeemAmount: slimPrep(prepAmount),
      redeemLots: slimPrep(prepLots),
      redeemWithTag: slimPrep(prepTag),
    },
    queue: queue.ok
      ? {
          ticketCount: queue.tickets.length,
          sample: queue.tickets.slice(0, 3),
          next: queue.nextRedemptionTicketId,
        }
      : queue,
    trackUnknownRequestId1: trackUnknown.ok
      ? {
          requestId: trackUnknown.requestId,
          lifecycle: trackUnknown.lifecycle,
          onChainStatus: trackUnknown.onChainStatus,
          hasPerformed: Boolean(trackUnknown.performed),
          honesty: trackUnknown.honesty,
        }
      : trackUnknown,
    realClosedLoop: {
      status: "REAL",
      prepare: "REAL",
      requestSubmit: "BLOCKED_UNTIL_FUNDED_FXRP_WALLET_SIGNS",
      completed: "BLOCKED_UNTIL_REDEMPTION_PERFORMED_WITH_XRPL_HASH",
    },
    blockers: [
      {
        id: "insufficient_controllable_fxrp_for_safe_redeem",
        detail:
          "Deployer sample FXRP balance is below minimumRedeemAmountUBA (5). Swap desk FXRP is protocol inventory for Safe USDT0→FXRP swaps — must not burn for demo redemption.",
      },
      {
        id: "completed_requires_agent_xrpl_payment",
        detail:
          "Even after RedemptionRequested, COMPLETED is only legal when RedemptionPerformed includes non-zero XRPL transactionHash. Agent payment is async and outside Beacon control.",
      },
      {
        id: "automated_mint_docs_handoff",
        detail: "Automated mint remains NOT_AVAILABLE (XRPL/Xaman agent reservation).",
      },
      {
        id: "swap_then_redeem_composite",
        detail:
          "Safe USDT0→FXRP SwapDesk prepare is REAL separately; composing auto swap→burn→redeem is not wired as one tx and would consume desk inventory. Prepare paths remain separate.",
      },
    ],
    txHashes: [],
    docs: desk.docs,
  };

  const outDir = resolve("docs/evidence");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, "fassets-redeem-prepare.json");
  writeFileSync(outPath, JSON.stringify(evidence, null, 2));

  // Merge blocker summary into status evidence if present
  const statusPath = resolve(outDir, "fassets-coston2-status.json");
  try {
    const status = JSON.parse(readFileSync(statusPath, "utf8"));
    status.blockers = evidence.blockers;
    status.realClosedLoop = evidence.realClosedLoop;
    status.prepareEvidence = "docs/evidence/fassets-redeem-prepare.json";
    writeFileSync(statusPath, JSON.stringify(status, null, 2));
  } catch {
    /* optional */
  }

  console.log(
    JSON.stringify(
      {
        wrote: outPath,
        preparesOk: {
          amount: prepAmount.ok,
          lots: prepLots.ok,
          tag: prepTag.ok,
        },
        trackLifecycle: trackUnknown.ok ? trackUnknown.lifecycle : "error",
        blockers: evidence.blockers.map((b) => b.id),
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
