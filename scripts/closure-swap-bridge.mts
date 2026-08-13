import { config } from "dotenv";
config({ path: ".env", override: true });
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resetEnvCache, loadEnv } from "../packages/shared/src/env.ts";
import { executeBeaconSafeSwap } from "../packages/shared/src/safeSwap.ts";
import { executeBeaconAgentBridge } from "../packages/shared/src/agentBridge.ts";
import { trackOftDelivery } from "../packages/shared/src/oftBridge.ts";

const OUT = join(process.cwd(), "docs", "evidence");
function save(name: string, data: unknown) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), JSON.stringify(data, null, 2));
  console.log("wrote", name);
}

resetEnvCache();
const env = loadEnv();
const wallet = "0x3bE57A5b65265D3704f846B93600308154fec794";

console.log("SWAP 0.1 USDT0 → FXRP…");
const swap = await executeBeaconSafeSwap({ amountInUnits: "0.1", recipient: wallet, wallet }, env);
save("closure-flow-swap.json", { at: new Date().toISOString(), ...swap });
console.log(JSON.stringify(swap, null, 2));
if (!swap.ok) process.exit(2);

console.log("BRIDGE 0.05 FXRP → Sepolia…");
const send = await executeBeaconAgentBridge(
  { amountFxrpUnits: "0.05", recipient: wallet, destination: "Sepolia", preferSafeFunding: false },
  env,
);
save("closure-lz-source.json", { at: new Date().toISOString(), ...send });
console.log(JSON.stringify(send, null, 2));
if (!send.ok) process.exit(3);

let dest: Record<string, unknown> | null = null;
for (let i = 0; i < 48; i++) {
  const track = await trackOftDelivery({ sourceTxHash: send.sendHash, dstEid: send.dstEid, env });
  const scanRes = await fetch(`https://scan-testnet.layerzero-api.com/v1/messages/tx/${send.sendHash}`);
  const scanJson = (await scanRes.json()) as {
    data?: Array<{
      guid?: string;
      status?: { name?: string };
      destination?: { status?: string; tx?: { txHash?: string } };
    }>;
  };
  const scan = scanJson.data?.[0];
  dest = {
    attempt: i + 1,
    guid: scan?.guid ?? track.guid ?? null,
    scanStatus: scan?.status?.name ?? null,
    destStatus: scan?.destination?.status ?? null,
    destTx: scan?.destination?.tx?.txHash ?? track.destTxHash ?? null,
    trackPhase: track.phase,
    layerZeroScan: `https://testnet.layerzeroscan.com/tx/${send.sendHash}`,
    sepoliaExplorer: (scan?.destination?.tx?.txHash ?? track.destTxHash)
      ? `https://sepolia.etherscan.io/tx/${scan?.destination?.tx?.txHash ?? track.destTxHash}`
      : null,
  };
  console.log("LZ poll", JSON.stringify(dest));
  const delivered =
    scan?.status?.name === "DELIVERED" ||
    scan?.destination?.status === "SUCCEEDED" ||
    track.phase === "dest_confirmed";
  if (delivered && dest.destTx) {
    save("closure-lz-dest.json", { at: new Date().toISOString(), source: send, dest });
    console.log("LZ_DEST_OK");
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 15000));
}
save("closure-lz-dest.json", { at: new Date().toISOString(), source: send, dest, timeout: true });
console.error("LZ dest not confirmed");
process.exit(4);
