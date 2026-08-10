import { writeFileSync } from "fs";
import { trackFassetsRedemption } from "../packages/shared/src/fassetsStatus.ts";

const t = await trackFassetsRedemption({
  requestId: "44497208",
  sourceTxHash: "0x2a2edb61551dbf2bda2460d465d79363fe309eeb4ea84abc2421599f85e66440",
  lookbackBlocks: 5000,
});
writeFileSync("docs/evidence/fassets-track-verify.json", JSON.stringify(t, null, 2));
console.log("lifecycle", (t as any).lifecycle, "onChain", (t as any).onChainStatus, "performed", !!(t as any).performed);
