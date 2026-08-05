/**
 * FAssets desk — real Coston2 reads only.
 *
 * Coston2 AssetManagerController returns a single manager (Testnet XRP / FXRP).
 * FBTC / FDOGE are not deployed as AssetManagers on Coston2 — listed as unavailable.
 *
 * https://dev.flare.network/fassets/reference
 * https://dev.flare.network/fassets/reference/IAssetManagerController
 */

import { Contract, JsonRpcProvider } from "ethers";
import { loadEnv, type BeaconEnv } from "./env.js";
import { FLARE_CONTRACT_REGISTRY_DEFAULT, readFtsoFeeds } from "./ftso.js";

const CONTROLLER_ABI = ["function getAssetManagers() view returns (address[])"];
const ASSET_MANAGER_ABI = [
  "function fAsset() view returns (address)",
  "function getSettings() view returns (tuple(uint64 lotSizeAMG, uint8 assetDecimals, address agentOwnerRegistry))",
  "function getAllAgents(uint256 start, uint256 end) view returns (address[] agents, uint256 totalLength)",
  "function getCollateralPoolTokenTimelockSeconds() view returns (uint256)",
];
const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
];

export interface FAssetManagerStatus {
  assetManager: string;
  fAsset: string;
  symbol: string;
  name: string;
  decimals: number;
  lotSizeAMG: string;
  lotSizeUnderlying: number;
  agentOwnerRegistry: string;
  agentCount: number;
  sampleAgents: string[];
  status: "live" | "unavailable";
  actions: {
    mint: "guided" | "unavailable";
    redeem: "guided" | "unavailable";
    bridge: "oft" | "unavailable";
    yield: "external" | "unavailable";
  };
  notes: string[];
}

export interface FAssetsDesk {
  network: string;
  chainId: number;
  controller: string;
  managers: FAssetManagerStatus[];
  documentedElsewhere: Array<{
    symbol: string;
    status: "not_on_coston2";
    note: string;
  }>;
  xrpUsd: number;
  lotValueUsd: number | null;
  honesty: string;
  docs: string[];
  flarePrimitive: "FAssets + FTSO";
}

export async function readFassetsDesk(env: BeaconEnv = loadEnv()): Promise<FAssetsDesk> {
  const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
  const registry = env.FLARE_CONTRACT_REGISTRY || FLARE_CONTRACT_REGISTRY_DEFAULT;
  const reg = new Contract(
    registry,
    ["function getContractAddressByName(string) view returns (address)"],
    provider,
  );
  const controller = (await reg.getContractAddressByName("AssetManagerController")) as string;
  const ctrl = new Contract(controller, CONTROLLER_ABI, provider);
  const managers = (await ctrl.getAssetManagers()) as string[];

  const snap = await readFtsoFeeds(env);
  const xrpUsd = snap.feeds.find((f) => f.symbol === "XRP/USD")?.value ?? 0;

  const rows: FAssetManagerStatus[] = [];
  for (const am of managers) {
    const manager = new Contract(am, ASSET_MANAGER_ABI, provider);
    const fAsset = (await manager.fAsset()) as string;
    const settings = await manager.getSettings();
    const lotSizeAMG = settings.lotSizeAMG as bigint;
    const assetDecimals = Number(settings.assetDecimals);
    const agentOwnerRegistry = settings.agentOwnerRegistry as string;
    const lotSizeUnderlying = Number(lotSizeAMG) / 10 ** assetDecimals;

    const token = new Contract(fAsset, ERC20_ABI, provider);
    let symbol = "FAsset";
    let name = "FAsset";
    let decimals = assetDecimals;
    try {
      symbol = String(await token.symbol());
      name = String(await token.name());
      decimals = Number(await token.decimals());
    } catch {
      /* tolerate */
    }

    let agentCount = 0;
    let sampleAgents: string[] = [];
    try {
      const res = await manager.getAllAgents(0, 5);
      sampleAgents = (res[0] as string[]) ?? [];
      agentCount = Number(res[1] ?? sampleAgents.length);
    } catch {
      try {
        const res = await manager.getAllAgents(0, 20);
        sampleAgents = ((res[0] as string[]) ?? []).slice(0, 5);
        agentCount = Number(res[1] ?? sampleAgents.length);
      } catch {
        agentCount = 0;
      }
    }

    const isFxrp = /xrp|fxrp|ftestxrp/i.test(symbol + name);
    rows.push({
      assetManager: am,
      fAsset,
      symbol,
      name,
      decimals,
      lotSizeAMG: lotSizeAMG.toString(),
      lotSizeUnderlying,
      agentOwnerRegistry,
      agentCount,
      sampleAgents,
      status: "live",
      actions: {
        mint: isFxrp ? "guided" : "unavailable",
        redeem: isFxrp ? "guided" : "unavailable",
        bridge: isFxrp ? "oft" : "unavailable",
        yield: "external",
      },
      notes: [
        "Mint/redeem require XRPL + FAssets agent flow (DevHub guides) — Beacon shows live status and routes to bridge/swap when applicable.",
        isFxrp
          ? "FXRP OFT bridge is available on Coston2 via LayerZero adapter."
          : "No OFT path wired for this asset in Beacon.",
      ],
    });
  }

  const fxrpRow = rows.find((r) => /xrp|fxrp/i.test(r.symbol));
  const lotValueUsd =
    fxrpRow && xrpUsd > 0 ? fxrpRow.lotSizeUnderlying * xrpUsd : null;

  return {
    network: "coston2",
    chainId: 114,
    controller,
    managers: rows,
    documentedElsewhere: [
      {
        symbol: "FBTC",
        status: "not_on_coston2",
        note: "No AssetManager for FBTC on Coston2 controller. Do not invent mint UI here.",
      },
      {
        symbol: "FDOGE",
        status: "not_on_coston2",
        note: "No AssetManager for FDOGE on Coston2 controller. Do not invent mint UI here.",
      },
    ],
    xrpUsd,
    lotValueUsd,
    honesty:
      "Coston2 currently exposes one FAsset manager (Testnet XRP / FXRP) via AssetManagerController.getAssetManagers(). FBTC/FDOGE are listed as not deployed on this network.",
    docs: [
      "https://dev.flare.network/fassets/overview",
      "https://dev.flare.network/fassets/developer-guides/fassets-settings-node",
      "https://dev.flare.network/fassets/developer-guides/fassets-swap-redeem",
      "https://dev.flare.network/fassets/reference",
    ],
    flarePrimitive: "FAssets + FTSO",
  };
}
