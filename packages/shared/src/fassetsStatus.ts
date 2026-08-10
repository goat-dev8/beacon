/**
 * FAssets desk — real Coston2 reads + honest mint handoff + redeem prepare + lifecycle track.
 *
 * Coston2 AssetManagerController returns a single manager (Testnet XRP / FXRP).
 * FBTC / FDOGE are not deployed as AssetManagers on Coston2 — listed as unavailable.
 *
 * Mint: XRPL + agent reservation is not completable end-to-end in Beacon wallet UI
 * (Xaman / underlying payment). Present documented handoff — never a fake mint button.
 *
 * Redeem prepare: AssetManager.redeem / redeemAmount / redeemWithTag after FXRP approve.
 * Lifecycle: PENDING (ACTIVE) → COMPLETED only with RedemptionPerformed XRPL tx evidence;
 * DEFAULTED from on-chain status / RedemptionDefault. Never invent COMPLETE.
 *
 * https://dev.flare.network/fassets/overview
 * https://dev.flare.network/fassets/redemption
 * https://dev.flare.network/fassets/developer-guides/fassets-redeem
 * https://dev.flare.network/fassets/developer-guides/fassets-redeem-amount
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
  "function getAvailableAgentsList(uint256 start, uint256 end) view returns (address[] agents, uint256 totalLength)",
  "function getAgentOwnerRegistry() view returns (address)",
  "function redeem(uint256 _lots, string _redeemerUnderlyingAddressString, address payable _executor) payable returns (uint256)",
  "function redeemAmount(uint256 _amountUBA, string _redeemerUnderlyingAddressString, address payable _executor) payable returns (uint256)",
  "function redeemWithTag(uint256 _amountUBA, string _redeemerUnderlyingAddressString, address payable _executor, uint256 _destinationTag) payable returns (uint256)",
  "function minimumRedeemAmountUBA() view returns (uint256)",
  "function redemptionQueue(uint256 _firstRedemptionTicketId, uint256 _pageSize) view returns (tuple(uint256 redemptionTicketId, address agentVault, uint256 ticketValueUBA)[] _queue, uint256 _nextRedemptionTicketId)",
  "function redemptionRequestInfo(uint256 _redemptionRequestId) view returns (tuple(address agentVault, address redeemer, string paymentAddress, bool paymentAddressValid, uint256 valueUBA, uint256 feeUBA, uint256 firstUnderlyingBlock, uint256 lastUnderlyingBlock, uint256 lastUnderlyingTimestamp, bytes32 paymentReference, address executor, uint256 executorFeeNatWei, uint64 status, uint64 timestamp))",
  "event RedemptionRequested(address indexed agentVault, address indexed redeemer, uint256 indexed requestId, string paymentAddress, uint256 valueUBA, uint256 feeUBA, uint256 firstUnderlyingBlock, uint256 lastUnderlyingBlock, uint256 lastUnderlyingTimestamp, bytes32 paymentReference, address executor, uint256 executorFeeNatWei)",
  "event RedemptionWithTagRequested(address indexed agentVault, address indexed redeemer, uint256 indexed requestId, string paymentAddress, uint256 valueUBA, uint256 feeUBA, uint256 firstUnderlyingBlock, uint256 lastUnderlyingBlock, uint256 lastUnderlyingTimestamp, bytes32 paymentReference, address executor, uint256 executorFeeNatWei, uint256 destinationTag)",
  "event RedemptionPerformed(address indexed agentVault, address indexed redeemer, uint64 indexed requestId, bytes32 transactionHash, uint256 redemptionAmountUBA, int256 spentUnderlyingUBA)",
  "event RedemptionDefault(address indexed agentVault, address indexed redeemer, uint256 indexed requestId, uint256 redemptionAmountUBA, uint256 redeemedVaultCollateralWei, uint256 redeemedPoolCollateralWei)",
  "event RedemptionAmountIncomplete(address indexed redeemer, uint256 remainingAmountUBA)",
  "event RedemptionRequestIncomplete(address indexed redeemer, uint256 remainingLots)",
  "event MintingExecuted(address indexed agentVault, uint256 indexed collateralReservationId, uint256 mintedAmountUBA, uint256 agentFeeUBA, uint256 poolFeeUBA)",
];
const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const XRPL_CLASSIC_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

/** On-chain Redemption.Status (EMPTY=0, ACTIVE=1, DEFAULTED=2). REJECTED finishes the request. */
export type OnChainRedemptionStatus = "EMPTY" | "ACTIVE" | "DEFAULTED" | "UNKNOWN";

/**
 * Beacon lifecycle labels (honest):
 * - PENDING: request ACTIVE, awaiting agent XRPL payment / proof
 * - COMPLETED: RedemptionPerformed with non-zero XRPL transactionHash evidence
 * - DEFAULTED: on-chain DEFAULTED or RedemptionDefault event
 * - NOT_FOUND: no open request and no performed evidence for this id
 * - PREPARED: calldata only (API prepare) — never a chain completion claim
 */
export type FAssetsLifecycleState =
  | "PREPARED"
  | "PENDING"
  | "COMPLETED"
  | "DEFAULTED"
  | "NOT_FOUND";

function mapOnChainStatus(raw: number | bigint): OnChainRedemptionStatus {
  const n = Number(raw);
  if (n === 0) return "EMPTY";
  if (n === 1) return "ACTIVE";
  if (n === 2) return "DEFAULTED";
  return "UNKNOWN";
}

function assertXrplClassic(addr: string): string | null {
  if (!addr || !XRPL_CLASSIC_RE.test(addr)) {
    return "underlyingAddress must be a valid XRPL classic address (r…)";
  }
  return null;
}

export interface FAssetManagerStatus {
  assetManager: string;
  fAsset: string;
  symbol: string;
  name: string;
  decimals: number;
  lotSizeAMG: string;
  lotSizeUnderlying: number;
  minimumRedeemAmountUBA: string | null;
  minimumRedeemUnderlying: number | null;
  agentOwnerRegistry: string;
  agentCount: number;
  availableAgentCount: number;
  sampleAgents: string[];
  status: "live" | "unavailable";
  actions: {
    /** Mint needs XRPL/Xaman agent flow — docs handoff only, not an in-app mint CTA. */
    mint: "docs_handoff" | "unavailable";
    /** Redeem lots / amount / withTag can be prepared for wallet when AssetManager redeem exists. */
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
  lifecycleHonesty: string;
}

export type FAssetsRedeemKind = "redeem_lots" | "redeem_amount" | "redeem_with_tag";

export interface FAssetsRedeemPrep {
  ok: true;
  kind: FAssetsRedeemKind;
  chainId: number;
  network: string;
  assetManager: string;
  fAsset: string;
  symbol: string;
  lots: number | null;
  lotSizeUBA: string;
  amountUBA: string;
  amountDisplay: string;
  minimumRedeemAmountUBA: string | null;
  underlyingAddress: string;
  destinationTag: number | null;
  executor: string;
  approveTo: string;
  approveData: string;
  redeemTo: string;
  redeemData: string;
  value: "0";
  lifecycleNext: "PENDING_after_wallet_submit";
  honesty: string;
  docs: string[];
  tag: string;
}

export interface RedemptionQueuePage {
  ok: true;
  assetManager: string;
  tickets: Array<{
    redemptionTicketId: string;
    agentVault: string;
    ticketValueUBA: string;
    ticketValueDisplay: string;
  }>;
  nextRedemptionTicketId: string;
  decimals: number;
  honesty: string;
}

export interface FAssetsRedemptionTrack {
  ok: true;
  requestId: string;
  assetManager: string;
  onChainStatus: OnChainRedemptionStatus;
  lifecycle: FAssetsLifecycleState;
  request: {
    agentVault: string;
    redeemer: string;
    paymentAddress: string;
    paymentAddressValid: boolean;
    valueUBA: string;
    feeUBA: string;
    firstUnderlyingBlock: string;
    lastUnderlyingBlock: string;
    lastUnderlyingTimestamp: string;
    paymentReference: string;
    executor: string;
    executorFeeNatWei: string;
    timestamp: string;
  } | null;
  performed: {
    flareTxHash: string;
    blockNumber: number;
    xrplTransactionHash: string;
    redemptionAmountUBA: string;
    explorerXrplHint: string | null;
  } | null;
  defaulted: {
    flareTxHash: string;
    blockNumber: number;
    redemptionAmountUBA: string;
  } | null;
  honesty: string;
  docs: string[];
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

    let minimumRedeemAmountUBA: string | null = null;
    let minimumRedeemUnderlying: number | null = null;
    try {
      const minUba = (await manager.minimumRedeemAmountUBA()) as bigint;
      minimumRedeemAmountUBA = minUba.toString();
      minimumRedeemUnderlying = Number(minUba) / 10 ** decimals;
    } catch {
      minimumRedeemAmountUBA = null;
      minimumRedeemUnderlying = null;
    }

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

    let availableAgentCount = 0;
    try {
      const avail = await manager.getAvailableAgentsList(0, 1);
      availableAgentCount = Number(avail[1] ?? 0);
    } catch {
      availableAgentCount = 0;
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
      minimumRedeemAmountUBA,
      minimumRedeemUnderlying,
      agentOwnerRegistry,
      agentCount,
      availableAgentCount,
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
        "Mint/redeem require XRPL + FAssets agent flow (DevHub guides) — Beacon shows live status, redeem prepare (lots/amount/tag), and tracks PENDING/COMPLETED/DEFAULTED honestly.",
        isFxrp
          ? "FXRP OFT bridge is available on Coston2 via LayerZero adapter."
          : "No OFT path wired for this asset in Beacon.",
        isFxrp
          ? "Mint = docs handoff (Xaman/XRPL). Redeem prepare = wallet calldata. COMPLETED only after RedemptionPerformed with XRPL payment hash."
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
      "Coston2 currently exposes one FAsset manager (Testnet XRP / FXRP) via AssetManagerController.getAssetManagers(). FBTC/FDOGE are listed as not deployed on this network. Mint is a documented XRPL/Xaman handoff — never presented as a one-click wallet mint. Redeem prepare is REAL; COMPLETED requires RedemptionPerformed XRPL evidence.",
    docs: [
      "https://dev.flare.network/fassets/overview",
      "https://dev.flare.network/fassets/redemption",
      "https://dev.flare.network/fassets/developer-guides/fassets-settings-node",
      "https://dev.flare.network/fassets/developer-guides/fassets-redeem",
      "https://dev.flare.network/fassets/developer-guides/fassets-redeem-amount",
      "https://dev.flare.network/fassets/developer-guides/fassets-list-agents",
      "https://dev.flare.network/fassets/developer-guides/fassets-minting",
      "https://dev.flare.network/fassets/reference",
    ],
    flarePrimitive: "FAssets + FTSO",
    lifecycleHonesty:
      "PREPARED = calldata only. PENDING = on-chain ACTIVE redemption awaiting agent XRPL pay. COMPLETED only with RedemptionPerformed + non-zero XRPL transactionHash. DEFAULTED from on-chain status / RedemptionDefault. Never invent COMPLETE.",
  };
}

async function resolveRedeemableManager(
  assetManager: string | undefined,
  env: BeaconEnv,
): Promise<FAssetManagerStatus | null> {
  const desk = await readFassetsDesk(env);
  if (assetManager) {
    return (
      desk.managers.find((m) => m.assetManager.toLowerCase() === assetManager.toLowerCase()) ?? null
    );
  }
  return desk.managers.find((m) => m.actions.redeem === "prepare") ?? null;
}

async function readMinimumRedeemAmountUBA(
  assetManager: string,
  env: BeaconEnv,
): Promise<bigint | null> {
  try {
    const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
    const manager = new Contract(assetManager, ASSET_MANAGER_ABI, provider);
    return (await manager.minimumRedeemAmountUBA()) as bigint;
  } catch {
    return null;
  }
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

  const xrplErr = assertXrplClassic(params.underlyingAddress);
  if (xrplErr) return { ok: false, error: xrplErr };

  const mgr = await resolveRedeemableManager(params.assetManager, env);
  if (!mgr) return { ok: false, error: "No redeemable FAsset manager on Coston2" };

  const lotSizeUBA = BigInt(mgr.lotSizeAMG);
  const amountUBA = lotSizeUBA * BigInt(lots);
  const executor = params.executor || ZERO_ADDRESS;
  const minRedeem = await readMinimumRedeemAmountUBA(mgr.assetManager, env);

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
    minimumRedeemAmountUBA: minRedeem?.toString() ?? null,
    underlyingAddress: params.underlyingAddress,
    destinationTag: null,
    executor,
    approveTo: mgr.fAsset,
    approveData: erc20.encodeFunctionData("approve", [mgr.assetManager, amountUBA]),
    redeemTo: mgr.assetManager,
    redeemData: amIf.encodeFunctionData("redeem", [lots, params.underlyingAddress, executor]),
    value: "0",
    lifecycleNext: "PENDING_after_wallet_submit",
    honesty:
      "Lots-based redeem prepare via AssetManager.redeem. After wallet submit expect PENDING (ACTIVE) until agent XRPL payment is proven. COMPLETED only with RedemptionPerformed + XRPL tx hash — never claim complete from prepare alone.",
    docs: [
      "https://dev.flare.network/fassets/developer-guides/fassets-redeem",
      "https://dev.flare.network/fassets/reference/IAssetManager#redeem",
    ],
    tag: "lots_based_redeem_prepare",
  };
}

/**
 * Prepare redeemAmount calldata (arbitrary UBA, not whole lots).
 * Validates against minimumRedeemAmountUBA when available.
 */
export async function prepareFassetsRedeemAmount(
  params: {
    amountUBA: string;
    underlyingAddress: string;
    executor?: string;
    assetManager?: string;
  },
  env: BeaconEnv = loadEnv(),
): Promise<FAssetsRedeemPrep | { ok: false; error: string }> {
  const xrplErr = assertXrplClassic(params.underlyingAddress);
  if (xrplErr) return { ok: false, error: xrplErr };

  let amountUBA: bigint;
  try {
    amountUBA = BigInt(params.amountUBA);
  } catch {
    return { ok: false, error: "amountUBA must be an integer string" };
  }
  if (!(amountUBA > 0n)) return { ok: false, error: "amountUBA must be positive" };

  const mgr = await resolveRedeemableManager(params.assetManager, env);
  if (!mgr) return { ok: false, error: "No redeemable FAsset manager on Coston2" };

  const minRedeem = await readMinimumRedeemAmountUBA(mgr.assetManager, env);
  if (minRedeem !== null && amountUBA < minRedeem) {
    return {
      ok: false,
      error: `amountUBA ${amountUBA} below minimumRedeemAmountUBA ${minRedeem}`,
    };
  }

  const lotSizeUBA = BigInt(mgr.lotSizeAMG);
  const lots = lotSizeUBA > 0n ? Number(amountUBA / lotSizeUBA) : null;
  const executor = params.executor || ZERO_ADDRESS;
  const erc20 = new Interface(ERC20_ABI);
  const amIf = new Interface(ASSET_MANAGER_ABI);

  return {
    ok: true,
    kind: "redeem_amount",
    chainId: 114,
    network: "Flare Testnet Coston2",
    assetManager: mgr.assetManager,
    fAsset: mgr.fAsset,
    symbol: mgr.symbol,
    lots,
    lotSizeUBA: lotSizeUBA.toString(),
    amountUBA: amountUBA.toString(),
    amountDisplay: formatUnits(amountUBA, mgr.decimals),
    minimumRedeemAmountUBA: minRedeem?.toString() ?? null,
    underlyingAddress: params.underlyingAddress,
    destinationTag: null,
    executor,
    approveTo: mgr.fAsset,
    approveData: erc20.encodeFunctionData("approve", [mgr.assetManager, amountUBA]),
    redeemTo: mgr.assetManager,
    redeemData: amIf.encodeFunctionData("redeemAmount", [
      amountUBA,
      params.underlyingAddress,
      executor,
    ]),
    value: "0",
    lifecycleNext: "PENDING_after_wallet_submit",
    honesty:
      "Amount-based redeem prepare via AssetManager.redeemAmount. May be partially fulfilled (RedemptionAmountIncomplete). COMPLETED only after RedemptionPerformed with XRPL evidence.",
    docs: [
      "https://dev.flare.network/fassets/developer-guides/fassets-redeem-amount",
      "https://dev.flare.network/fassets/reference/IAssetManager#redeemamount",
    ],
    tag: "amount_based_redeem_prepare",
  };
}

/**
 * Prepare redeemWithTag calldata (UBA + XRPL destination tag).
 */
export async function prepareFassetsRedeemWithTag(
  params: {
    amountUBA: string;
    underlyingAddress: string;
    destinationTag: number;
    executor?: string;
    assetManager?: string;
  },
  env: BeaconEnv = loadEnv(),
): Promise<FAssetsRedeemPrep | { ok: false; error: string }> {
  if (!(Number.isInteger(params.destinationTag) && params.destinationTag >= 0)) {
    return { ok: false, error: "destinationTag must be a non-negative integer" };
  }
  const base = await prepareFassetsRedeemAmount(
    {
      amountUBA: params.amountUBA,
      underlyingAddress: params.underlyingAddress,
      executor: params.executor,
      assetManager: params.assetManager,
    },
    env,
  );
  if (!base.ok) return base;

  const amIf = new Interface(ASSET_MANAGER_ABI);
  return {
    ...base,
    kind: "redeem_with_tag",
    destinationTag: params.destinationTag,
    redeemData: amIf.encodeFunctionData("redeemWithTag", [
      BigInt(base.amountUBA),
      params.underlyingAddress,
      base.executor,
      params.destinationTag,
    ]),
    honesty:
      "Tag-based redeem prepare via AssetManager.redeemWithTag. Destination tag is included for XRPL payment routing. COMPLETED only with RedemptionPerformed + XRPL tx hash.",
    docs: [
      "https://dev.flare.network/fassets/developer-guides/fassets-redeem-amount",
      "https://dev.flare.network/fassets/reference/IAssetManager#redeemwithtag",
    ],
    tag: "tag_based_redeem_prepare",
  };
}

/** Read FIFO redemption queue page from AssetManager. */
export async function readFassetsRedemptionQueue(
  opts: {
    assetManager?: string;
    firstTicketId?: string;
    pageSize?: number;
    env?: BeaconEnv;
  } = {},
): Promise<RedemptionQueuePage | { ok: false; error: string }> {
  const env = opts.env ?? loadEnv();
  const mgr = await resolveRedeemableManager(opts.assetManager, env);
  if (!mgr) return { ok: false, error: "No FAsset manager on Coston2" };

  const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
  const manager = new Contract(mgr.assetManager, ASSET_MANAGER_ABI, provider);
  const pageSize = Math.min(Math.max(opts.pageSize ?? 20, 1), 100);
  const first = BigInt(opts.firstTicketId ?? "0");

  try {
    const res = await manager.redemptionQueue(first, pageSize);
    const queue = (res[0] as Array<{
      redemptionTicketId: bigint;
      agentVault: string;
      ticketValueUBA: bigint;
    }>) ?? [];
    const next = (res[1] as bigint) ?? 0n;
    return {
      ok: true,
      assetManager: mgr.assetManager,
      tickets: queue.map((t) => ({
        redemptionTicketId: t.redemptionTicketId.toString(),
        agentVault: t.agentVault,
        ticketValueUBA: t.ticketValueUBA.toString(),
        ticketValueDisplay: formatUnits(t.ticketValueUBA, mgr.decimals),
      })),
      nextRedemptionTicketId: next.toString(),
      decimals: mgr.decimals,
      honesty:
        "Live FIFO redemption queue from AssetManager.redemptionQueue. Ticket presence ≠ a user redemption COMPLETE.",
    };
  } catch (e) {
    return { ok: false, error: `redemptionQueue failed: ${String(e).slice(0, 200)}` };
  }
}

/**
 * Track a redemption request honestly:
 * ACTIVE → PENDING; DEFAULTED → DEFAULTED; COMPLETED only with RedemptionPerformed XRPL hash.
 */
export async function trackFassetsRedemption(
  opts: {
    requestId: string;
    assetManager?: string;
    lookbackBlocks?: number;
    /** Decode RedemptionRequested from this confirmed redeem tx when info ABI drifts. */
    sourceTxHash?: string;
    env?: BeaconEnv;
  },
): Promise<FAssetsRedemptionTrack | { ok: false; error: string }> {
  const env = opts.env ?? loadEnv();
  let requestId: bigint;
  try {
    requestId = BigInt(opts.requestId);
  } catch {
    return { ok: false, error: "requestId must be an integer string" };
  }
  if (requestId < 0n) return { ok: false, error: "requestId must be non-negative" };

  const mgr = await resolveRedeemableManager(opts.assetManager, env);
  if (!mgr) return { ok: false, error: "No FAsset manager on Coston2" };

  const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
  const manager = new Contract(mgr.assetManager, ASSET_MANAGER_ABI, provider);
  const amIf = new Interface(ASSET_MANAGER_ABI);

  let onChainStatus: OnChainRedemptionStatus = "UNKNOWN";
  let request: FAssetsRedemptionTrack["request"] = null;

  if (opts.sourceTxHash && /^0x[a-fA-F0-9]{64}$/.test(opts.sourceTxHash)) {
    try {
      const rc = await provider.getTransactionReceipt(opts.sourceTxHash);
      for (const log of rc?.logs ?? []) {
        if (log.address.toLowerCase() !== mgr.assetManager.toLowerCase()) continue;
        try {
          const parsed = amIf.parseLog({ topics: [...log.topics], data: log.data });
          if (!parsed || parsed.name !== "RedemptionRequested") continue;
          const rid = BigInt(String(parsed.args.requestId ?? parsed.args[2]));
          if (rid !== requestId) continue;
          request = {
            agentVault: String(parsed.args.agentVault ?? parsed.args[0]),
            redeemer: String(parsed.args.redeemer ?? parsed.args[1]),
            paymentAddress: String(parsed.args.paymentAddress ?? parsed.args[3]),
            paymentAddressValid: true,
            valueUBA: String(parsed.args.valueUBA ?? parsed.args[4] ?? "0"),
            feeUBA: String(parsed.args.feeUBA ?? parsed.args[5] ?? "0"),
            firstUnderlyingBlock: String(parsed.args.firstUnderlyingBlock ?? parsed.args[6] ?? "0"),
            lastUnderlyingBlock: String(parsed.args.lastUnderlyingBlock ?? parsed.args[7] ?? "0"),
            lastUnderlyingTimestamp: String(
              parsed.args.lastUnderlyingTimestamp ?? parsed.args[8] ?? "0",
            ),
            paymentReference: String(parsed.args.paymentReference ?? parsed.args[9] ?? "0x"),
            executor: String(parsed.args.executor ?? parsed.args[10] ?? ZERO_ADDRESS),
            executorFeeNatWei: String(parsed.args.executorFeeNatWei ?? parsed.args[11] ?? "0"),
            timestamp: "0",
          };
          onChainStatus = "ACTIVE";
          break;
        } catch {
          /* next */
        }
      }
    } catch {
      /* fall through */
    }
  }

  try {
    const info = await manager.redemptionRequestInfo(requestId);
    onChainStatus = mapOnChainStatus(info.status ?? info[12]);
    request = {
      agentVault: String(info.agentVault ?? info[0]),
      redeemer: String(info.redeemer ?? info[1]),
      paymentAddress: String(info.paymentAddress ?? info[2]),
      paymentAddressValid: Boolean(info.paymentAddressValid ?? info[3]),
      valueUBA: (info.valueUBA ?? info[4]).toString(),
      feeUBA: (info.feeUBA ?? info[5]).toString(),
      firstUnderlyingBlock: (info.firstUnderlyingBlock ?? info[6]).toString(),
      lastUnderlyingBlock: (info.lastUnderlyingBlock ?? info[7]).toString(),
      lastUnderlyingTimestamp: (info.lastUnderlyingTimestamp ?? info[8]).toString(),
      paymentReference: String(info.paymentReference ?? info[9]),
      executor: String(info.executor ?? info[10]),
      executorFeeNatWei: (info.executorFeeNatWei ?? info[11]).toString(),
      timestamp: (info.timestamp ?? info[13]).toString(),
    };
  } catch {
    if (!request) {
      onChainStatus = "EMPTY";
    }
  }

  const latest = await provider.getBlockNumber();
  // Public RPCs often reject huge eth_getLogs windows.
  const lookback = opts.lookbackBlocks ?? 8_000;
  const fromBlock = Math.max(0, latest - lookback);

  let performed: FAssetsRedemptionTrack["performed"] = null;
  let defaulted: FAssetsRedemptionTrack["defaulted"] = null;

  try {
    const performedLogs = await manager.queryFilter(
      manager.filters.RedemptionPerformed(),
      fromBlock,
      latest,
    );
    for (const log of performedLogs) {
      const args = (log as { args?: Record<string, unknown> }).args;
      if (!args) continue;
      const rid = BigInt(String(args.requestId ?? args[2] ?? "-1"));
      if (rid !== requestId) continue;
      const xrplHash = String(args.transactionHash ?? args[3] ?? "0x");
      const zero =
        !xrplHash ||
        xrplHash === "0x" ||
        /^0x0+$/i.test(xrplHash) ||
        xrplHash ===
          "0x0000000000000000000000000000000000000000000000000000000000000000";
      if (zero) continue;
      performed = {
        flareTxHash: log.transactionHash,
        blockNumber: log.blockNumber,
        xrplTransactionHash: xrplHash,
        redemptionAmountUBA: String(args.redemptionAmountUBA ?? args[4] ?? "0"),
        explorerXrplHint: env.XRPL_EXPLORER_URL
          ? `${env.XRPL_EXPLORER_URL.replace(/\/$/, "")}/transactions/${xrplHash.replace(/^0x/, "")}`
          : null,
      };
      break;
    }
  } catch {
    /* RPC filter limits — leave performed null */
  }

  try {
    const defaultLogs = await manager.queryFilter(
      manager.filters.RedemptionDefault(),
      fromBlock,
      latest,
    );
    for (const log of defaultLogs) {
      const args = (log as { args?: Record<string, unknown> }).args;
      if (!args) continue;
      const rid = BigInt(String(args.requestId ?? args[2] ?? "-1"));
      if (rid !== requestId) continue;
      defaulted = {
        flareTxHash: log.transactionHash,
        blockNumber: log.blockNumber,
        redemptionAmountUBA: String(args.redemptionAmountUBA ?? args[3] ?? "0"),
      };
      break;
    }
  } catch {
    /* optional */
  }

  let lifecycle: FAssetsLifecycleState = "NOT_FOUND";
  if (performed) lifecycle = "COMPLETED";
  else if (defaulted || onChainStatus === "DEFAULTED") lifecycle = "DEFAULTED";
  else if (request && !performed) lifecycle = "PENDING";
  else if (onChainStatus === "ACTIVE") lifecycle = "PENDING";

  // Fallback: if ABI layout for redemptionRequestInfo drifts, still treat a confirmed
  // RedemptionRequested event for this requestId as PENDING (never COMPLETE).
  if (lifecycle === "NOT_FOUND" && !performed && !defaulted) {
    try {
      const requestedLogs = await manager.queryFilter(
        manager.filters.RedemptionRequested(),
        fromBlock,
        latest,
      );
      for (const log of requestedLogs) {
        const args = (log as { args?: Record<string, unknown> }).args;
        if (!args) continue;
        const rid = BigInt(String(args.requestId ?? args[2] ?? "-1"));
        if (rid !== requestId) continue;
        lifecycle = "PENDING";
        if (!request) {
          request = {
            agentVault: String(args.agentVault ?? args[0] ?? ""),
            redeemer: String(args.redeemer ?? args[1] ?? ""),
            paymentAddress: String(args.paymentAddress ?? args[3] ?? ""),
            paymentAddressValid: true,
            valueUBA: String(args.valueUBA ?? args[4] ?? "0"),
            feeUBA: String(args.feeUBA ?? args[5] ?? "0"),
            firstUnderlyingBlock: String(args.firstUnderlyingBlock ?? args[6] ?? "0"),
            lastUnderlyingBlock: String(args.lastUnderlyingBlock ?? args[7] ?? "0"),
            lastUnderlyingTimestamp: String(args.lastUnderlyingTimestamp ?? args[8] ?? "0"),
            paymentReference: String(args.paymentReference ?? args[9] ?? "0x"),
            executor: String(args.executor ?? args[10] ?? ZERO_ADDRESS),
            executorFeeNatWei: String(args.executorFeeNatWei ?? args[11] ?? "0"),
            timestamp: "0",
          };
          onChainStatus = "ACTIVE";
        }
        break;
      }
    } catch {
      /* optional */
    }
  }

  return {
    ok: true,
    requestId: requestId.toString(),
    assetManager: mgr.assetManager,
    onChainStatus,
    lifecycle,
    request,
    performed,
    defaulted,
    honesty:
      "COMPLETED requires RedemptionPerformed with non-zero XRPL transactionHash. ACTIVE without that evidence remains PENDING. Never treat prepare or REQUESTED as COMPLETE.",
    docs: [
      "https://dev.flare.network/fassets/redemption",
      "https://dev.flare.network/fassets/developer-guides/fassets-redeem",
    ],
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

  const names = [
    "RedemptionRequested",
    "RedemptionWithTagRequested",
    "RedemptionPerformed",
    "RedemptionDefault",
    "RedemptionAmountIncomplete",
    "MintingExecuted",
  ] as const;
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
