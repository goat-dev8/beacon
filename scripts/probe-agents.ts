import "dotenv/config";
import { runBeaconAgentChat } from "../packages/shared/src/flareAgents.ts";
import { readFtsoFeeds } from "../packages/shared/src/ftso.ts";

async function main() {
  const snap = await readFtsoFeeds();
  console.log(
    "feeds",
    snap.feeds.map((x) => `${x.symbol}:${x.value.toFixed(4)}`),
  );
  const r = await runBeaconAgentChat({
    agentId: "signals",
    message: "@signals show live prices",
  });
  console.log("agent", r.agentId, r.cards.map((c) => c.type), r.text.slice(0, 200));
  const s = await runBeaconAgentChat({
    agentId: "swap",
    message: "@swap 1 USDT0 to FXRP",
    wallet: "0xBDfCeE82Bd42FEfA58ee850B3709636a8B6b0034",
  });
  console.log("swap cards", s.cards.map((c) => c.type));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
