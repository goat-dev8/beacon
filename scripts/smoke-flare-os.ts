import {
  discoverSparkDexPools,
  readFassetsDesk,
  buildMarketIntelligence,
  readPortfolioDesk,
} from "../packages/shared/src/index.ts";

const wallet = "0x3be57a5b65265d3704f846b93600308154fec794";

const pools = await discoverSparkDexPools();
console.log(
  "SPARKDEX",
  pools.deployment.network,
  pools.pairs.map((p) => `${p.symbolA}/${p.symbolB}@${p.bestFee}`).join(", "),
);

const f = await readFassetsDesk();
console.log(
  "FASSETS",
  f.managers.map((m) => `${m.symbol}:agents=${m.agentCount}`).join(", "),
  "unavail",
  f.documentedElsewhere.map((d) => d.symbol).join(","),
);

const i = await buildMarketIntelligence({ wallet });
console.log("INTEL", i.bias, i.probabilityRiskOn, i.confidence, i.risk);

const p = await readPortfolioDesk(wallet);
console.log(
  "PORT",
  p.totalUsd,
  p.positions.map((x) => `${x.symbol}:${x.balance}`).join(" | "),
);
