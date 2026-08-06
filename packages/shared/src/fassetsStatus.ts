/**
 * FAssets desk — real Coston2 reads + honest mint handoff + redeem prepare.
 *
 * Coston2 AssetManagerController returns a single manager (Testnet XRP / FXRP).
 * FBTC / FDOGE are not deployed as AssetManagers on Coston2 — listed as unavailable.
 *
 * Mint: XRPL + agent reservation is not completable end-to-end in Beacon wallet UI
 * (Xaman / underlying payment). Present documented handoff — never a fake mint button.
 *
 * Redeem: AssetManager.redeem(lots, underlyingAddress, executor) is wallet-callable
 * after FXRP approve — prepare calldata when lotSize() is live.
 *
 * https://dev.flare.network/fassets/reference
 * https://dev.flare.network/fassets/developer-guides/fassets-redeem
 * https://dev.flare.network/fassets/developer-guides/fassets-minting
 */

import { Contract, Interface, JsonRpcProvider, formatUnits } from "ethers";
import { loadEnv, type BeaconEnv } from "./env.js";
import { FLARE_CONTRACT_REGISTRY_DEFAULT, readFtsoFeeds } from "./ftso.js";

const CONTROLLER_ABI = ["function getAssetManagers() view returns (address[])"];
const ASSET_MANAGER_ABI = [
  "function fAsset() view returns (address)",
  "function lotSize() view returns (uint256)",
  "function getAllAgents(uint256 start, uint256 end) view returns (address[] agents, uint256 totalLength)",
  "function getAgentOwnerRegistry() view returns (address)",
  "function redeem(uint256 _lots, string _redeemerUnderlyingAddressString, address payable _executor) payable returns (uint256)",
  "function minimumRedeemAmountUBA() view returns (uint256)",
  "event RedemptionRequested(address indexed agentVault, address indexed redeemer, uint256 indexed requestId, address payable executor, string paymentAddress, uint128 valueUBA, uint128 feeUBA, uint64 firstUnderlyingBlock, uint64 lastUnderlyingBlock, uint64 lastUnderlyingTimestamp, bytes32 paymentReference)",
  "event RedemptionPerformed(address indexed agentVault, address indexed redeemer, bytes32 indexed transactionHash, uint256 requestId, uint256 redemptionAmountUBA, int256 spentUnderlyingBalanceUBA)",
  "event MintingExecuted(address indexed agentVault, address indexed minter, uint256 indexed collateralReservationId, uint256 mintedAmountUBA, uint256 agentFeeUBA, uint256 poolFeeUBA)",
];
const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

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
    /** Mint needs XRPL/Xaman agent flow — docs handoff only, not an in-app mint CTA. */
    mint: "docs_handoff" | "unavailable";
    /** Redeem lots can be prepared for wallet when AssetManager.redeem exists. */
    redeem: "prepare" | "docs_handoff" | "unavailable";
    bridge: "oft" | "unavailable";
    yield: "vault_rails" | "external" | "unavailable";
  };
  mintHandoff: {
    kind: "documented_xrpl_agent_flow";
    summary: string;
    docs: string[];
    fakeButton: false;
  } | null;
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

export interface FAssetsRedeemPrep {
  ok: true;
  kind: "redeem_lots";
  chainId: number;
  network: string;
  assetManager: string;
  fAsset: string;
  symbol: string;
  lots: number;
  lotSizeUBA: string;
  amountUBA: string;
  amountDisplay: string;
  underlyingAddress: string;
  executor: string;
  approveTo: string;
  approveData: string;
  redeemTo: string;
  redeemData: string;
  value: "0";
  honesty: string;
  docs: string[];
  tag: "lots_based_redeem_prepare";
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

  const mintDocs = [
    "https://dev.flare.network/fassets/developer-guides/fassets-minting",
    "https://dev.flare.network/fassets/minting",
    "https://dev.flare.network/fassets/overview",
  ];

  const rows: FAssetManagerStatus[] = [];
  for (const am of managers) {
    const manager = new Contract(am, ASSET_MANAGER_ABI, provider);
    const fAsset = (await manager.fAsset()) as string;
    // Prefer lotSize() — settings tuple indexing historically broke Beacon.
    const lotSizeUba = (await manager.lotSize()) as bigint;

    const token = new Contract(fAsset, ERC20_ABI, provider);
    let symbol = "FAsset";
    let name = "FAsset";
    let decimals = 6;
    try {
      symbol = String(await token.symbol());
      name = String(await token.name());
      decimals = Number(await token.decimals());
    } catch {
      /* tolerate */
    }
    const lotSizeUnderlying = Number(lotSizeUba) / 10 ** decimals;

    let agentOwnerRegistry = "";
    try {
      agentOwnerRegistry = (await manager.getAgentOwnerRegistry()) as string;
    } catch {
      agentOwnerRegistry = "";
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
    let redeemAction: FAssetManagerStatus["actions"]["redeem"] = "unavailable";
    if (isFxrp) {
      try {
        // Probe redeem selector exists (bytecode present on manager).
        const code = await provider.getCode(am);
        redeemAction = code.length > 2 ? "prepare" : "docs_handoff";
      } catch {
        redeemAction = "docs_handoff";
      }
    }

    rows.push({
      assetManager: am,
      fAsset,
      symbol,
      name,
      decimals,
      lotSizeAMG: lotSizeUba.toString(),
      lotSizeUnderlying,
      agentOwnerRegistry,
      agentCount,
      sampleAgents,
      status: "live",
      actions: {
        mint: isFxrp ? "docs_handoff" : "unavailable",
        redeem: redeemAction,
        bridge: isFxrp ? "oft" : "unavailable",
        yield: isFxrp ? "vault_rails" : "external",
      },
      mintHandoff: isFxrp
        ? {
            kind: "documented_xrpl_agent_flow",
            summary:
              "Minting FXRP requires reserving collateral with an agent and paying XRP on XRPL (often via Xaman). Beacon cannot complete that end-to-end in-wallet — follow DevHub minting guides. This is a documented handoff, not a mint button.",
            docs: mintDocs,
            fakeButton: false,
          }
        : null,
      notes: [
        "Mint/redeem require XRPL + FAssets agent flow (DevHub guides) — Beacon shows live status, redeem prepare for lots, and routes to bridge/swap when applicable.",
        isFxrp
          ? "FXRP OFT bridge is available on Coston2 via LayerZero adapter."
          : "No OFT path wired for this asset in Beacon.",
        isFxrp
          ? "Mint = docs handoff (Xaman/XRPL). Redeem lots = wallet prepare when you supply an XRPL address."
          : "",
      ].filter(Boolean),
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
      "Coston2 currently exposes one FAsset manager (Testnet XRP / FXRP) via AssetManagerController.getAssetManagers(). FBTC/FDOGE are listed as not deployed on this network. Mint is a documented XRPL/Xaman handoff — never presented as a one-click wallet mint.",
    docs: [
      "https://dev.flare.network/fassets/overview",
      "https://dev.flare.network/fassets/developer-guides/fassets-settings-node",
      "https://dev.flare.network/fassets/developer-guides/fassets-redeem",
      "https://dev.flare.network/fassets/developer-guides/fassets-minting",
      "https://dev.flare.network/fassets/reference",
    ],
    flarePrimitive: "FAssets + FTSO",
  };
}

/**
 * Prepare lots-based AssetManager.redeem calldata.
 * Amount is floored to whole lots via lotSize() — never invents lot size.
 */
export async function prepareFassetsRedeemLots(
  params: {
    lots: number;
    underlyingAddress: string;
    executor?: string;
    assetManager?: string;
  },
  env: BeaconEnv = loadEnv(),
): Promise<FAssetsRedeemPrep | { ok: false; error: string }> {
  const lots = Math.floor(params.lots);
  if (!(lots > 0)) return { ok: false, error: "lots must be a positive integer" };
  if (!params.underlyingAddress || !/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(params.underlyingAddress)) {
    return {
      ok: false,
      error: "underlyingAddress must be a valid XRPL classic address (r…)",
    };
  }

  const desk = await readFassetsDesk(env);
  const mgr =
    (params.assetManager
      ? desk.managers.find((m) => m.assetManager.toLowerCase() === params.assetManager!.toLowerCase())
      : desk.managers.find((m) => m.actions.redeem === "prepare")) ?? null;
  if (!mgr) return { ok: false, error: "No redeemable FAsset manager on Coston2" };

  const lotSizeUBA = BigInt(mgr.lotSizeAMG);
  const amountUBA = lotSizeUBA * BigInt(lots);
  const executor = params.executor || ZERO_ADDRESS;

  const erc20 = new Interface(ERC20_ABI);
  const amIf = new Interface(ASSET_MANAGER_ABI);

  return {
    ok: true,
    kind: "redeem_lots",
    chainId: 114,
    network: "Flare Testnet Coston2",
    assetManager: mgr.assetManager,
    fAsset: mgr.fAsset,
    symbol: mgr.symbol,
    lots,
    lotSizeUBA: lotSizeUBA.toString(),
    amountUBA: amountUBA.toString(),
    amountDisplay: formatUnits(amountUBA, mgr.decimals),
    underlyingAddress: params.underlyingAddress,
    executor,
    approveTo: mgr.fAsset,
    approveData: erc20.encodeFunctionData("approve", [mgr.assetManager, amountUBA]),
    redeemTo: mgr.assetManager,
    redeemData: amIf.encodeFunctionData("redeem", [lots, params.underlyingAddress, executor]),
    value: "0",
    honesty:
      "Lots-based redeem prepare via AssetManager.redeem. Agent pays XRP to your XRPL address after request; monitor RedemptionRequested / RedemptionPerformed. Not a mint path.",
    docs: [
      "https://dev.flare.network/fassets/developer-guides/fassets-redeem",
      "https://dev.flare.network/fassets/reference/IAssetManager#redeem",
    ],
    tag: "lots_based_redeem_prepare",
  };
}

/** Convert a display FXRP amount to whole lots using live lotSize(). */
export async function lotsFromAmountDisplay(
  amountDisplay: string,
  env: BeaconEnv = loadEnv(),
): Promise<{ lots: number; lotSizeUnderlying: number; remainderDisplay: string } | { error: string }> {
  const desk = await readFassetsDesk(env);
  const mgr = desk.managers.find((m) => /xrp|fxrp/i.test(m.symbol));
  if (!mgr) return { error: "No FXRP manager" };
  const amount = parseFloat(amountDisplay);
  if (!(amount > 0)) return { error: "amount must be positive" };
  const lots = Math.floor(amount / mgr.lotSizeUnderlying);
  const remainder = amount - lots * mgr.lotSizeUnderlying;
  return {
    lots,
    lotSizeUnderlying: mgr.lotSizeUnderlying,
    remainderDisplay: remainder.toFixed(Math.min(6, mgr.decimals)),
  };
}

export interface FAssetsEventCursor {
  fromBlock: number;
  toBlock: number;
  events: Array<{
    name: string;
    txHash: string;
    blockNumber: number;
    args: Record<string, string>;
  }>;
}

/** Light event monitor helper for redemption / minting logs on an AssetManager. */
export async function watchFassetsManagerEvents(
  opts: {
    assetManager: string;
    fromBlock?: number;
    toBlock?: number | "latest";
    maxBlocks?: number;
    env?: BeaconEnv;
  },
): Promise<FAssetsEventCursor> {
  const env = opts.env ?? loadEnv();
  const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
  const latest = await provider.getBlockNumber();
  const maxBlocks = opts.maxBlocks ?? 5_000;
  const toBlock = opts.toBlock === undefined || opts.toBlock === "latest" ? latest : opts.toBlock;
  const fromBlock = opts.fromBlock ?? Math.max(0, toBlock - maxBlocks);
  const manager = new Contract(opts.assetManager, ASSET_MANAGER_ABI, provider);

  const names = ["RedemptionRequested", "RedemptionPerformed", "MintingExecuted"] as const;
  const events: FAssetsEventCursor["events"] = [];

  for (const name of names) {
    try {
      const filter = manager.filters[name]();
      const logs = await manager.queryFilter(filter, fromBlock, toBlock);
      for (const log of logs) {
        const args: Record<string, string> = {};
        const raw = (log as { args?: Record<string, unknown> }).args;
        if (raw) {
          for (const [k, v] of Object.entries(raw)) {
            if (/^\d+$/.test(k)) continue;
            args[k] = typeof v === "bigint" ? v.toString() : String(v);
          }
        }
        events.push({
          name,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          args,
        });
      }
    } catch {
      /* optional — RPC may reject filters */
    }
  }

  events.sort((a, b) => a.blockNumber - b.blockNumber);
  return { fromBlock, toBlock, events };
}
