import { readFassetsDesk } from "../packages/shared/src/fassetsStatus.ts";

const d = await readFassetsDesk();
console.log(
  JSON.stringify(
    {
      lot: d.managers[0]?.lotSizeUnderlying,
      lotUsd: d.lotValueUsd,
      agents: d.managers[0]?.agentCount,
      symbol: d.managers[0]?.symbol,
    },
    null,
    2,
  ),
);
