import {
  readFtsoFeeds,
  evaluateFtsoGuard,
  FTSO_GUARD_DEFAULTS,
  loadEnv,
} from "../packages/shared/src/index.ts";

async function main() {
  const env = loadEnv();
  const s = await readFtsoFeeds(env);
  const g = evaluateFtsoGuard(s.feeds, {
    feedSymbol: "XRP/USD",
    maxAgeSeconds: FTSO_GUARD_DEFAULTS.maxAgeSeconds,
  });
  console.log(
    JSON.stringify(
      {
        status: "REAL",
        ftsoV2: s.ftsoV2,
        timestamp: s.timestamp,
        xrp: s.feeds.find((f) => f.symbol === "XRP/USD"),
        guard: g,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
