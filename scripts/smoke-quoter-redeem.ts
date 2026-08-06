import {
  prepareUsdt0ToFxrpSwap,
  prepareFassetsRedeemLots,
  SPARKDEX_QUOTER_V2,
} from "../packages/shared/src/index.ts";

const swap = await prepareUsdt0ToFxrpSwap({
  amountInUnits: "1",
  recipient: "0x3be57a5b65265d3704f846b93600308154fec794",
});
console.log(
  "QUOTE",
  JSON.stringify(
    {
      quoteSource: swap.quoteSource,
      estimateBasis: swap.estimateBasis,
      estimatedOut: swap.estimatedOut,
      amountOutMinimum: swap.amountOutMinimum,
      slippageBps: swap.slippageBps,
      priceImpactVsFtsoBps: swap.priceImpactVsFtsoBps,
      ftsoMidOut: swap.ftsoMidOut,
      quoterOk: swap.quoter === SPARKDEX_QUOTER_V2,
      chainId: swap.chainId,
    },
    null,
    2,
  ),
);

const redeem = await prepareFassetsRedeemLots({
  lots: 1,
  underlyingAddress: "rSHYuiEvsYsKR8uUHhBTuGP5zjRcGt4nm",
});
console.log("REDEEM", JSON.stringify(redeem, null, 2));
