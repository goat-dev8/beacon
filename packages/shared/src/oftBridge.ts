import { Options } from "@layerzerolabs/lz-v2-utilities";
import { loadEnv, type BeaconEnv } from "./env.js";
import { resolveFxrpAddress } from "./ftso.js";

/** Official Coston2 FXRP OFT Adapter (LayerZero V2). */
export const COSTON2_FXRP_OFT_ADAPTER = "0xCd3d2127935Ae82Af54Fc31cCD9D3440dbF46639";

export type FxrpOftRoute = {
  chain: string;
  eid: number;
  peer: string;
  asset: string;
  status: "supported";
  eta: string;
  fees: string;
};

/** Fallback peers (DevHub getOftPeers snapshot). Prefer discoverFxrpOftRoutes at runtime. */
export const COSTON2_FXRP_OFT_ROUTES_FALLBACK: FxrpOftRoute[] = [
  {
    chain: "BSC Testnet",
    eid: 40102,
    peer: "0xac7c4a07670589cf83b134a843bfe86c45a4bf4e",
    asset: "FXRP",
    status: "supported",
    eta: "minutes (LayerZero)",
    fees: "LayerZero messaging fee in native gas, quote on send",
  },
  {
    chain: "Sepolia",
    eid: 40161,
    peer: "0x81672c5d42f3573ad95a0bdfbe824faac547d4e6",
    asset: "FXRP",
    status: "supported",
    eta: "minutes (LayerZero)",
    fees: "LayerZero messaging fee in native gas, quote on send",
  },
  {
    chain: "Hyperliquid EVM Testnet",
    eid: 40362,
    peer: "0x14bfb521e318fc3d5e92a8462c65079bc7d4284c",
    asset: "FXRP",
    status: "supported",
    eta: "minutes (LayerZero)",
    fees: "HYPE gas + LZ fee, quote on send",
  },
];

/** @deprecated alias — use discoverFxrpOftRoutes or COSTON2_FXRP_OFT_ROUTES_FALLBACK */
export const COSTON2_FXRP_OFT_ROUTES = COSTON2_FXRP_OFT_ROUTES_FALLBACK;

export type Coston2FxrpOftRoute = FxrpOftRoute;

const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

/**
 * Candidate LayerZero V2 testnet EIDs scanned for FXRP OFT peers.
 * Matches DevHub getOftPeers pattern: call peers(eid) on the Coston2 adapter.
 * Names for known EIDs; unknown configured peers still surface as EID labels.
 */
const LZ_V2_TESTNET_CANDIDATES: { name: string; eid: number }[] = [
  { name: "BSC Testnet", eid: 40102 },
  { name: "Sepolia", eid: 40161 },
  { name: "Hyperliquid EVM Testnet", eid: 40362 },
  { name: "Amoy", eid: 40267 },
  { name: "Base Sepolia", eid: 40245 },
  { name: "Arbitrum Sepolia", eid: 40231 },
  { name: "Optimism Sepolia", eid: 40232 },
  { name: "Avalanche Fuji", eid: 40106 },
  { name: "Mantle Sepolia", eid: 40246 },
  { name: "Scroll Sepolia", eid: 40170 },
  { name: "Linea Sepolia", eid: 40283 },
  { name: "Mode Testnet", eid: 40298 },
  { name: "Sonic Testnet", eid: 40349 },
  { name: "Unichain Sepolia", eid: 40333 },
];

const PEERS_ABI = [
  "function peers(uint32 eid) view returns (bytes32)",
] as const;

let routesCache: { at: number; routes: FxrpOftRoute[]; source: "onchain" | "fallback" } | null =
  null;
const ROUTES_TTL_MS = 10 * 60 * 1000;

function routeFromPeer(name: string, eid: number, peer: string): FxrpOftRoute {
  const known = COSTON2_FXRP_OFT_ROUTES_FALLBACK.find((r) => r.eid === eid);
  return {
    chain: known?.chain ?? name,
    eid,
    peer,
    asset: "FXRP",
    status: "supported",
    eta: known?.eta ?? "minutes (LayerZero)",
    fees: known?.fees ?? "LayerZero messaging fee in native gas, quote on send",
  };
}

/**
 * Discover FXRP OFT destinations by reading peers() on the Coston2 adapter.
 * Falls back to the DevHub snapshot if RPC fails or returns empty.
 */
export async function discoverFxrpOftRoutes(
  env: BeaconEnv = loadEnv(),
  opts?: { force?: boolean },
): Promise<{
  routes: FxrpOftRoute[];
  discoveredAt: number;
  source: "onchain" | "fallback";
  oftAdapter: string;
}> {
  const now = Date.now();
  if (!opts?.force && routesCache && now - routesCache.at < ROUTES_TTL_MS) {
    return {
      routes: routesCache.routes,
      discoveredAt: routesCache.at,
      source: routesCache.source,
      oftAdapter: COSTON2_FXRP_OFT_ADAPTER,
    };
  }

  try {
    const { Contract, JsonRpcProvider } = await import("ethers");
    const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
    const oft = new Contract(COSTON2_FXRP_OFT_ADAPTER, PEERS_ABI, provider);
    const found: FxrpOftRoute[] = [];
    const seen = new Set<number>();

    for (const candidate of LZ_V2_TESTNET_CANDIDATES) {
      if (seen.has(candidate.eid)) continue;
      seen.add(candidate.eid);
      try {
        const peerBytes = (await oft.peers(candidate.eid)) as string;
        if (!peerBytes || peerBytes.toLowerCase() === ZERO_BYTES32) continue;
        const peer = `0x${peerBytes.slice(-40)}`;
        if (peer === "0x0000000000000000000000000000000000000000") continue;
        found.push(routeFromPeer(candidate.name, candidate.eid, peer.toLowerCase()));
      } catch {
        // endpoint may not exist on this adapter
      }
    }

    if (found.length === 0) {
      routesCache = {
        at: now,
        routes: [...COSTON2_FXRP_OFT_ROUTES_FALLBACK],
        source: "fallback",
      };
    } else {
      routesCache = { at: now, routes: found, source: "onchain" };
    }
  } catch {
    routesCache = {
      at: now,
      routes: [...COSTON2_FXRP_OFT_ROUTES_FALLBACK],
      source: "fallback",
    };
  }

  return {
    routes: routesCache.routes,
    discoveredAt: routesCache.at,
    source: routesCache.source,
    oftAdapter: COSTON2_FXRP_OFT_ADAPTER,
  };
}

export function resolveOftRouteByEid(
  dstEid: number,
  routes: FxrpOftRoute[] = COSTON2_FXRP_OFT_ROUTES_FALLBACK,
): FxrpOftRoute {
  const route = routes.find((r) => r.eid === dstEid);
  if (!route) {
    const known = COSTON2_FXRP_OFT_ROUTES_FALLBACK.find((r) => r.eid === dstEid);
    if (known) return known;
    throw new Error(
      `Unsupported dstEid ${dstEid}. Discover peers via GET /v1/agents/bridge/routes or DevHub getOftPeers.`,
    );
  }
  return route;
}

export function resolveOftRouteByChain(
  chain: string,
  routes: FxrpOftRoute[] = COSTON2_FXRP_OFT_ROUTES_FALLBACK,
): FxrpOftRoute | undefined {
  const norm = chain.trim().toLowerCase();
  return (
    routes.find((r) => r.chain.toLowerCase() === norm) ??
    COSTON2_FXRP_OFT_ROUTES_FALLBACK.find((r) => r.chain.toLowerCase() === norm)
  );
}

const OFT_ADAPTER_ABI = [
  "function quoteSend((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) _sendParam, bool _payInLzToken) view returns (uint256 nativeFee, uint256 lzTokenFee)",
  "function send((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) _sendParam, (uint256 nativeFee, uint256 lzTokenFee) _fee, address _refundAddress) payable",
] as const;

export interface FxrpOftSendParam {
  dstEid: number;
  to: string;
  amountLD: bigint;
  minAmountLD: bigint;
  extraOptions: string;
  composeMsg: string;
  oftCmd: string;
}

function addressToBytes32(recipient: string): string {
  const addr = recipient.toLowerCase().replace(/^0x/, "");
  return `0x${addr.padStart(64, "0")}`;
}

/** Executor gas for destination lzReceive, matches flare-viem-starter default. */
export const OFT_EXECUTOR_GAS = 400_000;

/** Build LayerZero V2 OFT SendParam with executor lzReceive options (required for delivery). */
export function buildFxrpOftSendParam(params: {
  dstEid: number;
  recipient: string;
  amountLD: bigint;
  slippageBps?: number;
  executorGas?: number;
}): FxrpOftSendParam {
  const gas = params.executorGas ?? OFT_EXECUTOR_GAS;
  const extraOptions = Options.newOptions().addExecutorLzReceiveOption(gas, 0).toHex();
  const slippageBps = params.slippageBps ?? 100;
  const minAmountLD = (params.amountLD * BigInt(10_000 - slippageBps)) / 10_000n;
  return {
    dstEid: params.dstEid,
    to: addressToBytes32(params.recipient),
    amountLD: params.amountLD,
    minAmountLD,
    extraOptions,
    composeMsg: "0x",
    oftCmd: "0x",
  };
}

/**
 * Prepare LayerZero OFT Adapter approve + send calldata for Coston2 → peer.
 * Messaging fee comes from on-chain quoteSend, never invented.
 */
export async function prepareFxrpOftBridge(
  params: { amountFxrpUnits: string; recipient: string; dstEid: number },
  env: BeaconEnv = loadEnv(),
): Promise<{
  fxrp: string;
  oftAdapter: string;
  approveTo: string;
  approveData: string;
  sendTo: string;
  sendData: string;
  nativeFee: string;
  lzTokenFee: string;
  nativeFeeDisplay: string;
  dstEid: number;
  amountLD: string;
  amountDisplay: string;
  minAmountLD: string;
  recipient: string;
  peer: Coston2FxrpOftRoute;
  sendParam: {
    dstEid: number;
    to: string;
    amountLD: string;
    minAmountLD: string;
    extraOptions: string;
    composeMsg: string;
    oftCmd: string;
  };
  docs: string[];
  layerZeroScanBase: string;
  explorerBase: string;
}> {
  const { Contract, Interface, JsonRpcProvider, parseUnits, formatUnits } = await import("ethers");
  const discovered = await discoverFxrpOftRoutes(env);
  const route = resolveOftRouteByEid(params.dstEid, discovered.routes);
  const fxrp = await resolveFxrpAddress(env);
  const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);

  const erc = new Contract(fxrp, ["function decimals() view returns (uint8)"], provider);
  const decimals = Number(await erc.decimals());
  const amountLD = parseUnits(params.amountFxrpUnits, decimals);
  const sendParam = buildFxrpOftSendParam({
    dstEid: params.dstEid,
    recipient: params.recipient,
    amountLD,
    slippageBps: 100,
  });

  const oftAdapter = new Contract(COSTON2_FXRP_OFT_ADAPTER, OFT_ADAPTER_ABI, provider);
  const quote = (await oftAdapter.quoteSend(sendParam, false)) as {
    nativeFee: bigint;
    lzTokenFee: bigint;
  };
  const nativeFee = quote.nativeFee;
  const lzTokenFee = quote.lzTokenFee;

  const erc20If = new Interface(["function approve(address spender, uint256 amount) returns (bool)"]);
  const oftIf = new Interface(OFT_ADAPTER_ABI);
  const approveData = erc20If.encodeFunctionData("approve", [COSTON2_FXRP_OFT_ADAPTER, amountLD]);
  const sendData = oftIf.encodeFunctionData("send", [
    sendParam,
    { nativeFee, lzTokenFee },
    params.recipient,
  ]);

  return {
    fxrp,
    oftAdapter: COSTON2_FXRP_OFT_ADAPTER,
    approveTo: fxrp,
    approveData,
    sendTo: COSTON2_FXRP_OFT_ADAPTER,
    sendData,
    nativeFee: nativeFee.toString(),
    lzTokenFee: lzTokenFee.toString(),
    nativeFeeDisplay: `${Number(formatUnits(nativeFee, 18)).toFixed(4)} C2FLR`,
    dstEid: params.dstEid,
    amountLD: amountLD.toString(),
    amountDisplay: params.amountFxrpUnits,
    minAmountLD: sendParam.minAmountLD.toString(),
    recipient: params.recipient,
    peer: route,
    sendParam: {
      dstEid: sendParam.dstEid,
      to: sendParam.to,
      amountLD: sendParam.amountLD.toString(),
      minAmountLD: sendParam.minAmountLD.toString(),
      extraOptions: sendParam.extraOptions,
      composeMsg: sendParam.composeMsg,
      oftCmd: sendParam.oftCmd,
    },
    docs: [
      "https://dev.flare.network/fxrp/oft/fxrp-automint",
      "https://dev.flare.network/fxrp/oft/fxrp-autoredeem#discovering-available-bridge-routes",
      "https://docs.layerzero.network/v2/deployments/chains/flare-testnet",
    ],
    layerZeroScanBase: "https://testnet.layerzeroscan.com/tx/",
    explorerBase: "https://coston2-explorer.flare.network/tx/",
  };
}
