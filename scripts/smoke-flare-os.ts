import {
  discoverSparkDexPools,
  readFassetsDesk,
  buildMarketIntelligence,
  readPortfolioDesk,
  readYieldVaultDesk,
  SPARKDEX_QUOTER_V2,
} from "../packages/shared/src/index.ts";

const wallet = "0x3be57a5b65265d3704f846b93600308154fec794";

const pools = await discoverSparkDexPools();
console.log(
  "SPARKDEX",
  pools.deployment.network,
  "quoter",
  pools.deployment.quoter === SPARKDEX_QUOTER_V2 ? "ok" : pools.deployment.quoter,
  pools.pairs.map((p) => `${p.symbolA}/${p.symbolB}@${p.bestFee}`).join(", "),
);

const f = await readFassetsDesk();
console.log(
  "FASSETS",
  f.managers
    .map((m) => `${m.symbol}:agents=${m.agentCount}:mint=${m.actions.mint}:redeem=${m.actions.redeem}`)
    .join(", "),
  "unavail",
  f.documentedElsewhere.map((d) => d.symbol).join(","),
);

const y = await readYieldVaultDesk({ wallet });
const fl =
  "error" in y.firelight
    ? `err=${y.firelight.error}`
    : `assets=${y.firelight.totalAssetsDisplay} share=${y.firelight.sharePriceDisplay}`;
const up =
  "error" in y.upshift ? `err=${y.upshift.error}` : `lp=${y.upshift.user?.lpBalanceDisplay ?? "0"}`;
console.log("YIELD", "firelight", fl, "upshift", up);

const i = await buildMarketIntelligence({ wallet });
console.log("INTEL", i.bias, i.probabilityRiskOn, i.confidence, i.risk);

const p = await readPortfolioDesk(wallet);
console.log(
  "PORT",
  p.totalUsd,
  p.positions.map((x) => `${x.symbol}:${x.balance}`).join(" | "),
);
