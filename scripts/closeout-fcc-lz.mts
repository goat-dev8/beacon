/**
 * Closeout: hardware FCC ALLOW + policy DENY + diagnostic over-cap EVALUATE,
 * then a FRESH FXRP OFT send and dest poll. No secrets in output files.
 */
import { config } from "dotenv";
config({ path: ".env", override: true });

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Contract, JsonRpcProvider, formatEther, formatUnits } from "ethers";
import { loadEnv, resetEnvCache, executeBeaconAgentBridge, trackOftDelivery } from "@beacon/shared";
import { FccExtensionClient, fccConfigFromEnv } from "@beacon/fdc";

const API = "https://beacon-api-97gl.onrender.com";
const WALLET = "0x3bE57A5b65265D3704f846B93600308154fec794";
const SAFE = "0x96875f3F4346e2183A3ee0d156cAe6871551A0A6";
const EXEC = "0xBDfCeE82Bd42FEfA58ee850B3709636a8B6b0034";
const USDT0 = "0xC1A5B41512496B80903D1f32d6dEa3a73212E71F";
const FXRP = "0x0b6A3645c240605887a5532109323A3E12273dc7";
const OLD_LZ = "0x954228b00a6b6cffb886e09e9e766c5d8cdb397026796bbf7fe6fa895fe45d6e";
const OUT = join(process.cwd(), "docs", "evidence");

function save(name: string, data: unknown) {
  mkdirSync(OUT, { recursive: true });
  const path = join(OUT, name);
  writeFileSync(path, JSON.stringify(data, null, 2));
  console.log("wrote", path);
}

async function apiJson(path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { ok: res.ok, status: res.status, json };
}

async function lzScan(tx: string) {
  const res = await fetch(`https://scan-testnet.layerzero-api.com/v1/messages/tx/${tx}`);
  const json = (await res.json()) as {
    data?: Array<{
      guid?: string;
      status?: { name?: string };
      destination?: { status?: string; tx?: { txHash?: string } };
      source?: { tx?: { txHash?: string; from?: string } };
      pathway?: { dstEid?: number; receiver?: { chain?: string; address?: string } };
    }>;
  };
  return json.data?.[0] ?? null;
}

async function main() {
  resetEnvCache();
  const env = loadEnv();
  const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
  const erc = ["function balanceOf(address) view returns (uint256)", "function name() view returns (string)"];
  const usdt = new Contract(USDT0, erc, provider);
  const fxrp = new Contract(FXRP, erc, provider);

  const balances = {
    at: new Date().toISOString(),
    tokenName: await usdt.name(),
    wallet: {
      address: WALLET,
      usdt0: formatUnits(await usdt.balanceOf(WALLET), 6),
      fxrp: formatUnits(await fxrp.balanceOf(WALLET), 6),
      c2flr: formatEther(await provider.getBalance(WALLET)),
    },
    safe: {
      address: SAFE,
      usdt0: formatUnits(await usdt.balanceOf(SAFE), 6),
    },
    executor: {
      address: EXEC,
      usdt0: formatUnits(await usdt.balanceOf(EXEC), 6),
      fxrp: formatUnits(await fxrp.balanceOf(EXEC), 6),
      c2flr: formatEther(await provider.getBalance(EXEC)),
    },
  };
  save("closeout-balances.json", balances);
  console.log("balances", JSON.stringify(balances, null, 2));

  const fccStatus = await apiJson("/v1/fcc/status");
  save("closeout-fcc-status.json", fccStatus.json);

  const deny = await apiJson("/v1/fcc/policy/evaluate", {
    method: "POST",
    body: JSON.stringify({
      useCase: "amount_cap",
      wallet: WALLET,
      actionHash: `closeout-deny-100-vs-10-${Date.now()}`,
      amountUsdt0: 100,
      amountCapUsdt0: 10,
      submitInstruction: true,
    }),
  });
  save("closeout-fcc-deny.json", deny.json);
  console.log("DENY decision", (deny.json as { valueProtection?: { decision?: string } })?.valueProtection?.decision);
  console.log("DENY onChain", (deny.json as { onChainInstruction?: unknown })?.onChainInstruction);

  console.log("ALLOW submitInstruction starting…");
  const allow = await apiJson("/v1/fcc/policy/evaluate", {
    method: "POST",
    body: JSON.stringify({
      useCase: "amount_cap",
      wallet: WALLET,
      actionHash: `closeout-allow-1-vs-10-${Date.now()}`,
      amountUsdt0: 1,
      amountCapUsdt0: 10,
      submitInstruction: true,
    }),
  });
  save("closeout-fcc-allow.json", allow.json);
  console.log(
    "ALLOW instruction",
    JSON.stringify((allow.json as { onChainInstruction?: unknown })?.onChainInstruction),
  );

  console.log("Diagnostic EVALUATE over-cap (well-formed FIT JSON, not empty-name)…");
  const client = new FccExtensionClient(fccConfigFromEnv(env));
  const originalPoll = client.pollActionResult.bind(client);
  client.pollActionResult = (id: string) => originalPoll(id, 90, 5000);
  let diagnostic: Record<string, unknown>;
  try {
    const result = await client.sendEvaluateFit({
      brief: "policy amount cap check",
      serviceId: "desk",
      amountUsdt0: 100,
      amountCapUsdt0: 10,
      wallet: WALLET,
      valueProtectionDecision: "DENY",
      note: "Beacon already DENY; this asks whether the measured image signs status 0 for over-cap.",
    });
    diagnostic = {
      ok: true,
      kind: "diagnostic-overcap-evaluate-fit",
      notClaimedAsSignedDeny: result.status !== 0,
      instructionId: result.instructionId,
      txHash: result.txHash,
      explorer: `https://coston2-explorer.flare.network/tx/${result.txHash}`,
      teeSignedStatus: result.status,
      data: result.data,
      log: result.log,
      extensionId: 65925,
      teeId: "0xA5E9a81044dd4d66384DE09CF95dB317fde5646d",
      attestationKind: "hardware",
      honesty:
        result.status === 0
          ? "Measured image signed status 0 for over-cap EVALUATE."
          : "Measured image signed status != 0 for a well-formed over-cap EVALUATE. processFit does not enforce amount caps. Empty-name SAY_HELLO was not used.",
      timestamp: new Date().toISOString(),
    };
  } catch (e) {
    diagnostic = {
      ok: false,
      error: e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500),
      timestamp: new Date().toISOString(),
    };
  }
  save("closeout-fcc-overcap-evaluate.json", diagnostic);
  console.log("diagnostic", JSON.stringify(diagnostic, null, 2));

  console.log("Track prior LZ dest…");
  const oldScan = await lzScan(OLD_LZ);
  const oldTrack = await trackOftDelivery({ sourceTxHash: OLD_LZ, dstEid: 40161, env });
  save("closeout-lz-prior-dest.json", {
    sourceTx: OLD_LZ,
    layerZeroScan: "https://testnet.layerzeroscan.com/tx/" + OLD_LZ,
    scanApi: oldScan,
    trackOftDelivery: oldTrack,
    sepoliaDestTx: oldScan?.destination?.tx?.txHash ?? null,
    sepoliaExplorer: oldScan?.destination?.tx?.txHash
      ? `https://sepolia.etherscan.io/tx/${oldScan.destination.tx.txHash}`
      : null,
    status: oldScan?.status?.name ?? null,
  });

  console.log("Fresh FXRP OFT 0.05 → Sepolia…");
  const send = await executeBeaconAgentBridge(
    {
      amountFxrpUnits: "0.05",
      recipient: WALLET,
      destination: "Sepolia",
      preferSafeFunding: false,
    },
    env,
  );
  save("closeout-lz-fresh-source.json", send);
  console.log("LZ send", JSON.stringify(send, null, 2));
  if (!send.ok) {
    process.exit(1);
  }

  let dest: unknown = null;
  for (let i = 0; i < 40; i++) {
    const scan = await lzScan(send.sendHash);
    const track = await trackOftDelivery({ sourceTxHash: send.sendHash, dstEid: send.dstEid, env });
    dest = {
      attempt: i + 1,
      scanStatus: scan?.status?.name ?? null,
      destStatus: scan?.destination?.status ?? null,
      destTx: scan?.destination?.tx?.txHash ?? null,
      guid: scan?.guid ?? null,
      track,
    };
    console.log("LZ poll", JSON.stringify(dest));
    const delivered =
      scan?.status?.name === "DELIVERED" ||
      scan?.destination?.status === "SUCCEEDED" ||
      track.phase === "dest_confirmed";
    if (delivered && (scan?.destination?.tx?.txHash || track.destTxHash)) {
      save("closeout-lz-fresh-dest.json", {
        sourceTx: send.sendHash,
        destinationTx: scan?.destination?.tx?.txHash ?? track.destTxHash,
        guid: scan?.guid ?? track.guid,
        layerZeroScan: send.layerZeroScanUrl,
        sepoliaExplorer: `https://sepolia.etherscan.io/tx/${scan?.destination?.tx?.txHash ?? track.destTxHash}`,
        coston2Explorer: send.explorerSend,
        amountFxrp: "0.05",
        recipient: WALLET,
        dstEid: send.dstEid,
        peer: send.peer,
        scan,
        track,
        timestamp: new Date().toISOString(),
      });
      console.log("LZ DEST CONFIRMED");
      return;
    }
    await new Promise((r) => setTimeout(r, 20_000));
  }
  save("closeout-lz-fresh-dest.json", {
    inFlight: true,
    last: dest,
    sourceTx: send.sendHash,
    timestamp: new Date().toISOString(),
  });
  console.log("LZ dest still in flight after polls");
  process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
