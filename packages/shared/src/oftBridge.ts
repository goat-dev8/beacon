import { Options } from "@layerzerolabs/lz-v2-utilities";
import { loadEnv, type BeaconEnv } from "./env.js";
import { resolveFxrpAddress } from "./ftso.js";

/** Official Coston2 FXRP OFT Adapter (LayerZero V2). */
export const COSTON2_FXRP_OFT_ADAPTER = "0xCd3d2127935Ae82Af54Fc31cCD9D3440dbF46639";

/** Coston2 LayerZero Endpoint V2 (Flare testnet). */
export const COSTON2_LZ_ENDPOINT_V2 = "0x6EDCE65403992e310A62460808c4b910D972f10f";

export type FxrpOftRouteStatus = "live" | "fallback-snapshot";

export type FxrpOftRoute = {
  chain: string;
  eid: number;
  peer: string;
  asset: string;
  /** "live" = peers(eid) on-chain; "fallback-snapshot" = DevHub snapshot — NOT a proven live route. */
  status: FxrpOftRouteStatus;
  eta: string;
  fees: string;
  /** Explicit honesty flag for UI — never treat fallback as live. */
  live: boolean;
};

/** DevHub getOftPeers snapshot — NEVER present as live without peers(eid) confirmation. */
export const COSTON2_FXRP_OFT_ROUTES_FALLBACK: FxrpOftRoute[] = [
  {
    chain: "BSC Testnet",
    eid: 40102,
    peer: "0xac7c4a07670589cf83b134a843bfe86c45a4bf4e",
    asset: "FXRP",
    status: "fallback-snapshot",
    live: false,
    eta: "minutes (LayerZero) — snapshot only",
    fees: "LayerZero messaging fee in native gas, quote on send",
  },
  {
    chain: "Sepolia",
    eid: 40161,
    peer: "0x81672c5d42f3573ad95a0bdfbe824faac547d4e6",
    asset: "FXRP",
    status: "fallback-snapshot",
    live: false,
    eta: "minutes (LayerZero) — snapshot only",
    fees: "LayerZero messaging fee in native gas, quote on send",
  },
  {
    chain: "Hyperliquid EVM Testnet",
    eid: 40362,
    peer: "0x14bfb521e318fc3d5e92a8462c65079bc7d4284c",
    asset: "FXRP",
    status: "fallback-snapshot",
    live: false,
    eta: "minutes (LayerZero) — snapshot only",
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
 */
const LZ_V2_TESTNET_CANDIDATES: { name: string; eid: number; rpc?: string; explorer?: string }[] =
  [
    { name: "BSC Testnet", eid: 40102, rpc: "https://data-seed-prebsc-1-s1.binance.org:8545", explorer: "https://testnet.bscscan.com" },
    { name: "Sepolia", eid: 40161, rpc: "https://ethereum-sepolia-rpc.publicnode.com", explorer: "https://sepolia.etherscan.io" },
    { name: "Hyperliquid EVM Testnet", eid: 40362 },
    { name: "Amoy", eid: 40267, rpc: "https://rpc-amoy.polygon.technology", explorer: "https://amoy.polygonscan.com" },
    { name: "Base Sepolia", eid: 40245, rpc: "https://sepolia.base.org", explorer: "https://sepolia.basescan.org" },
    { name: "Arbitrum Sepolia", eid: 40231, rpc: "https://sepolia-rollup.arbitrum.io/rpc", explorer: "https://sepolia.arbiscan.io" },
    { name: "Optimism Sepolia", eid: 40232, rpc: "https://sepolia.optimism.io", explorer: "https://sepolia-optimism.etherscan.io" },
    { name: "Avalanche Fuji", eid: 40106, rpc: "https://api.avax-test.network/ext/bc/C/rpc", explorer: "https://testnet.snowtrace.io" },
    { name: "Mantle Sepolia", eid: 40246 },
    { name: "Scroll Sepolia", eid: 40170 },
    { name: "Linea Sepolia", eid: 40283 },
    { name: "Mode Testnet", eid: 40298 },
    { name: "Sonic Testnet", eid: 40349 },
    { name: "Unichain Sepolia", eid: 40333 },
  ];

const PEERS_ABI = [
  "function peers(uint32 eid) view returns (bytes32)",
  "event PeerSet(uint32 eid, bytes32 peer)",
] as const;

let routesCache: {
  at: number;
  routes: FxrpOftRoute[];
  source: "onchain" | "fallback";
} | null = null;
const ROUTES_TTL_MS = 10 * 60 * 1000;

function routeFromPeer(
  name: string,
  eid: number,
  peer: string,
  live: boolean,
): FxrpOftRoute {
  const known = COSTON2_FXRP_OFT_ROUTES_FALLBACK.find((r) => r.eid === eid);
  const candidate = LZ_V2_TESTNET_CANDIDATES.find((c) => c.eid === eid);
  return {
    chain: known?.chain ?? candidate?.name ?? name,
    eid,
    peer,
    asset: "FXRP",
    status: live ? "live" : "fallback-snapshot",
    live,
    eta: live
      ? (known?.eta.replace(" — snapshot only", "") ?? "minutes (LayerZero)")
      : "minutes (LayerZero) — snapshot only",
    fees: known?.fees ?? "LayerZero messaging fee in native gas, quote on send",
  };
}

function peerBytesToAddress(peerBytes: string): string | null {
  if (!peerBytes || peerBytes.toLowerCase() === ZERO_BYTES32) return null;
  const peer = `0x${peerBytes.slice(-40)}`;
  if (peer === "0x0000000000000000000000000000000000000000") return null;
  return peer.toLowerCase();
}

/**
 * Discover FXRP OFT destinations by reading peers(eid) + PeerSet events on the Coston2 adapter.
 * Falls back to the DevHub snapshot only when RPC fails or returns empty — labeled non-live.
 */
export async function discoverFxrpOftRoutes(
  env: BeaconEnv = loadEnv(),
  opts?: { force?: boolean },
): Promise<{
  routes: FxrpOftRoute[];
  discoveredAt: number;
  source: "onchain" | "fallback";
  oftAdapter: string;
  honesty: string;
}> {
  const now = Date.now();
  if (!opts?.force && routesCache && now - routesCache.at < ROUTES_TTL_MS) {
    return {
      routes: routesCache.routes,
      discoveredAt: routesCache.at,
      source: routesCache.source,
      oftAdapter: COSTON2_FXRP_OFT_ADAPTER,
      honesty: honestyForSource(routesCache.source),
    };
  }

  try {
    const { Contract, JsonRpcProvider } = await import("ethers");
    const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
    const oft = new Contract(COSTON2_FXRP_OFT_ADAPTER, PEERS_ABI, provider);
    const found = new Map<number, FxrpOftRoute>();

    // 1) peers(eid) scan
    for (const candidate of LZ_V2_TESTNET_CANDIDATES) {
      if (found.has(candidate.eid)) continue;
      try {
        const peerBytes = (await oft.peers(candidate.eid)) as string;
        const peer = peerBytesToAddress(peerBytes);
        if (!peer) continue;
        found.set(candidate.eid, routeFromPeer(candidate.name, candidate.eid, peer, true));
      } catch {
        // endpoint may not exist on this adapter
      }
    }

    // 2) PeerSet events — catch eids outside the candidate list
    try {
      const latest = await provider.getBlockNumber();
      const fromBlock = Math.max(0, latest - 50_000);
      const logs = await oft.queryFilter(oft.filters.PeerSet(), fromBlock, latest);
      for (const log of logs) {
        const args = (log as { args?: { eid?: bigint | number; peer?: string } }).args;
        if (!args?.eid || !args.peer) continue;
        const eid = Number(args.eid);
        const peer = peerBytesToAddress(String(args.peer));
        if (!peer || found.has(eid)) continue;
        const name =
          LZ_V2_TESTNET_CANDIDATES.find((c) => c.eid === eid)?.name ?? `EID ${eid}`;
        found.set(eid, routeFromPeer(name, eid, peer, true));
      }
    } catch {
      // Event scan is best-effort; peers() results still count as on-chain.
    }

    const routes = [...found.values()].sort((a, b) => a.eid - b.eid);

    if (routes.length === 0) {
      routesCache = {
        at: now,
        routes: COSTON2_FXRP_OFT_ROUTES_FALLBACK.map((r) => ({ ...r, live: false, status: "fallback-snapshot" })),
        source: "fallback",
      };
    } else {
      routesCache = { at: now, routes, source: "onchain" };
    }
  } catch {
    routesCache = {
      at: now,
      routes: COSTON2_FXRP_OFT_ROUTES_FALLBACK.map((r) => ({ ...r, live: false, status: "fallback-snapshot" })),
      source: "fallback",
    };
  }

  return {
    routes: routesCache.routes,
    discoveredAt: routesCache.at,
    source: routesCache.source,
    oftAdapter: COSTON2_FXRP_OFT_ADAPTER,
    honesty: honestyForSource(routesCache.source),
  };
}

function honestyForSource(source: "onchain" | "fallback"): string {
  if (source === "onchain") {
    return "Peers read live from FXRP OFT Adapter peers(eid) (+ PeerSet events). Destination fill only via LayerZero Scan / dest receipt.";
  }
  return "FALLBACK SNAPSHOT — peers(eid) unavailable. These are NOT proven live routes. Re-query when RPC recovers; do not claim live bridging.";
}

export function resolveOftRouteByEid(
  dstEid: number,
  routes: FxrpOftRoute[] = COSTON2_FXRP_OFT_ROUTES_FALLBACK,
): FxrpOftRoute {
  const route = routes.find((r) => r.eid === dstEid);
  if (!route) {
    const known = COSTON2_FXRP_OFT_ROUTES_FALLBACK.find((r) => r.eid === dstEid);
    if (known) return { ...known, live: false, status: "fallback-snapshot" };
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
  const fromList = routes.find((r) => r.chain.toLowerCase() === norm);
  if (fromList) return fromList;
  // Snapshot lookup only — caller must check .live before prepare/send.
  const snap = COSTON2_FXRP_OFT_ROUTES_FALLBACK.find((r) => r.chain.toLowerCase() === norm);
  return snap ? { ...snap, live: false, status: "fallback-snapshot" } : undefined;
}

const OFT_ADAPTER_ABI = [
  "function quoteSend((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) _sendParam, bool _payInLzToken) view returns (uint256 nativeFee, uint256 lzTokenFee)",
  "function send((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) _sendParam, (uint256 nativeFee, uint256 lzTokenFee) _fee, address _refundAddress) payable",
  "event OFTSent(bytes32 indexed guid, uint32 dstEid, address indexed fromAddress, uint256 amountSentLD, uint256 amountReceivedLD)",
  "event OFTReceived(bytes32 indexed guid, uint32 srcEid, address indexed toAddress, uint256 amountReceivedLD)",
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
 * Decode OFT GUID from a source-chain send receipt (OFTSent indexed guid).
 * Returns null if the log is missing — UI should still show source tx + LZ Scan by hash.
 */
export function decodeOftGuidFromReceipt(receipt: {
  logs?: readonly {
    address?: string;
    topics?: readonly string[];
    data?: string;
  }[];
}): string | null {
  const logs = receipt.logs ?? [];
  // Lazy: ethers Interface is async-import heavy in sync helper — match via topic0 from known ABI hash.
  // keccak256("OFTSent(bytes32,uint32,address,uint256,uint256)")
  const OFT_SENT_TOPIC0 =
    "0x85496b760a4b7f8d66384b9df21b381f5d1b1e79f229a47aaf4c232edc2fe59a";
  const adapter = COSTON2_FXRP_OFT_ADAPTER.toLowerCase();
  for (const log of logs) {
    const topics = log.topics ?? [];
    if (topics[0]?.toLowerCase() !== OFT_SENT_TOPIC0) continue;
    if (topics[1]?.length === 66) {
      if (!log.address || log.address.toLowerCase() === adapter) return topics[1];
      return topics[1];
    }
  }
  return null;
}

/** Fetch source receipt and extract GUID + destination eid from OFTSent. */
export async function observeOftSourceSend(
  sourceTxHash: string,
  env: BeaconEnv = loadEnv(),
): Promise<{
  phase: "source_confirmed" | "source_pending" | "source_failed";
  sourceTxHash: string;
  guid: string | null;
  dstEid: number | null;
  amountSentLD: string | null;
  layerZeroScanUrl: string;
  explorerUrl: string;
}> {
  const { JsonRpcProvider, Interface } = await import("ethers");
  const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
  const receipt = await provider.getTransactionReceipt(sourceTxHash);
  const layerZeroScanUrl = `https://testnet.layerzeroscan.com/tx/${sourceTxHash}`;
  const explorerUrl = `https://coston2-explorer.flare.network/tx/${sourceTxHash}`;

  if (!receipt) {
    return {
      phase: "source_pending",
      sourceTxHash,
      guid: null,
      dstEid: null,
      amountSentLD: null,
      layerZeroScanUrl,
      explorerUrl,
    };
  }
  if (receipt.status !== 1) {
    return {
      phase: "source_failed",
      sourceTxHash,
      guid: null,
      dstEid: null,
      amountSentLD: null,
      layerZeroScanUrl,
      explorerUrl,
    };
  }

  const guid = decodeOftGuidFromReceipt(receipt);
  let dstEid: number | null = null;
  let amountSentLD: string | null = null;
  try {
    const iface = new Interface(OFT_ADAPTER_ABI);
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== COSTON2_FXRP_OFT_ADAPTER.toLowerCase()) continue;
      try {
        const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
        if (parsed?.name === "OFTSent") {
          dstEid = Number(parsed.args.dstEid);
          amountSentLD = parsed.args.amountSentLD?.toString?.() ?? null;
          break;
        }
      } catch {
        // not OFTSent
      }
    }
  } catch {
    // guid from topics is enough for observe phase
  }

  return {
    phase: "source_confirmed",
    sourceTxHash,
    guid,
    dstEid,
    amountSentLD,
    layerZeroScanUrl,
    explorerUrl,
  };
}

export type OftDeliveryPhase =
  | "source_pending"
  | "source_confirmed"
  | "protocol_observe"
  | "dest_confirmed"
  | "dest_unknown"
  | "failed";

export type OftDeliveryStatus = {
  phase: OftDeliveryPhase;
  sourceTxHash: string;
  guid: string | null;
  dstEid: number | null;
  destination: string | null;
  destPeer: string | null;
  destTxHash: string | null;
  amountReceivedLD: string | null;
  layerZeroScanUrl: string;
  explorerUrl: string;
  destExplorerUrl: string | null;
  note: string;
  /** UI phase ladder: source → protocol observe → dest receipt */
  uiPhases: Array<{ id: "source" | "protocol" | "dest"; label: string; status: "pending" | "active" | "done" | "failed" }>;
};

function uiPhasesFor(phase: OftDeliveryPhase): OftDeliveryStatus["uiPhases"] {
  const base: OftDeliveryStatus["uiPhases"] = [
    { id: "source", label: "Source tx", status: "pending" },
    { id: "protocol", label: "Protocol observe", status: "pending" },
    { id: "dest", label: "Dest receipt", status: "pending" },
  ];
  if (phase === "source_pending") {
    base[0].status = "active";
  } else if (phase === "source_confirmed" || phase === "protocol_observe") {
    base[0].status = "done";
    base[1].status = "active";
  } else if (phase === "dest_confirmed") {
    base[0].status = "done";
    base[1].status = "done";
    base[2].status = "done";
  } else if (phase === "dest_unknown") {
    base[0].status = "done";
    base[1].status = "done";
    base[2].status = "pending";
  } else if (phase === "failed") {
    base[0].status = "failed";
  }
  return base;
}

/**
 * Poll destination confirmation for known dest chains with public RPCs.
 * Looks for OFTReceived(guid) on the peer OFT — never invents fills.
 */
export async function trackOftDelivery(params: {
  sourceTxHash: string;
  dstEid?: number;
  peer?: string;
  guid?: string | null;
  maxBlocks?: number;
  env?: BeaconEnv;
}): Promise<OftDeliveryStatus> {
  const env = params.env ?? loadEnv();
  const source = await observeOftSourceSend(params.sourceTxHash, env);
  const dstEid = params.dstEid ?? source.dstEid;
  const guid = params.guid ?? source.guid;
  const candidate = dstEid != null ? LZ_V2_TESTNET_CANDIDATES.find((c) => c.eid === dstEid) : undefined;
  const discovered = await discoverFxrpOftRoutes(env);
  const route = dstEid != null ? discovered.routes.find((r) => r.eid === dstEid) : undefined;
  const peer = (params.peer ?? route?.peer)?.toLowerCase() ?? null;

  const base: OftDeliveryStatus = {
    phase: source.phase === "source_failed" ? "failed" : source.phase === "source_pending" ? "source_pending" : "protocol_observe",
    sourceTxHash: params.sourceTxHash,
    guid,
    dstEid,
    destination: route?.chain ?? candidate?.name ?? null,
    destPeer: peer,
    destTxHash: null,
    amountReceivedLD: null,
    layerZeroScanUrl: source.layerZeroScanUrl,
    explorerUrl: source.explorerUrl,
    destExplorerUrl: candidate?.explorer ? `${candidate.explorer}/tx/` : null,
    note:
      source.phase === "source_failed"
        ? "Source OFT send reverted."
        : source.phase === "source_pending"
          ? "Waiting for source-chain confirmation."
          : "Source confirmed — observe on LayerZero Scan. Destination fill not claimed until OFTReceived or Scan delivery.",
    uiPhases: uiPhasesFor(
      source.phase === "source_failed"
        ? "failed"
        : source.phase === "source_pending"
          ? "source_pending"
          : "protocol_observe",
    ),
  };

  if (source.phase !== "source_confirmed") return base;

  if (!guid || !peer || !candidate?.rpc) {
    return {
      ...base,
      phase: "dest_unknown",
      note: !candidate?.rpc
        ? `No public RPC configured for EID ${dstEid ?? "?"}. Track delivery on LayerZero Scan — Beacon will not invent a dest fill.`
        : !guid
          ? "OFT GUID not found in source logs. Use LayerZero Scan with the source tx hash."
          : "Peer address missing — cannot poll OFTReceived.",
      uiPhases: uiPhasesFor("dest_unknown"),
    };
  }

  try {
    const { Contract, JsonRpcProvider } = await import("ethers");
    const destProvider = new JsonRpcProvider(candidate.rpc);
    const destOft = new Contract(peer, OFT_ADAPTER_ABI, destProvider);
    const latest = await destProvider.getBlockNumber();
    const lookback = params.maxBlocks ?? 8_000;
    const fromBlock = Math.max(0, latest - lookback);
    const filter = destOft.filters.OFTReceived(guid);
    const logs = await destOft.queryFilter(filter, fromBlock, latest);

    if (logs.length > 0) {
      const log = logs[logs.length - 1];
      let amountReceivedLD: string | null = null;
      try {
        const args = (log as { args?: { amountReceivedLD?: bigint } }).args;
        amountReceivedLD = args?.amountReceivedLD?.toString() ?? null;
      } catch {
        // ignore
      }
      const destTxHash = log.transactionHash;
      return {
        ...base,
        phase: "dest_confirmed",
        destTxHash,
        amountReceivedLD,
        destExplorerUrl: candidate.explorer ? `${candidate.explorer}/tx/${destTxHash}` : null,
        note: "Destination OFTReceived found on-chain. Bridge fill confirmed.",
        uiPhases: uiPhasesFor("dest_confirmed"),
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ...base,
      phase: "protocol_observe",
      note: `Dest poll failed (${msg.slice(0, 120)}). Use LayerZero Scan — do not assume fill.`,
      uiPhases: uiPhasesFor("protocol_observe"),
    };
  }

  return {
    ...base,
    phase: "protocol_observe",
    note: "OFTReceived not seen yet on dest. Protocol still in flight — check LayerZero Scan.",
    uiPhases: uiPhasesFor("protocol_observe"),
  };
}

/**
 * Prepare LayerZero OFT Adapter approve + send calldata for Coston2 → peer.
 * Messaging fee comes from on-chain quoteSend, never invented.
 * Refuses prepare when only fallback-snapshot peers are available for dstEid (fail closed for "live" claim).
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
  routesSource: "onchain" | "fallback";
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
  deliveryHint: string;
}> {
  const { Contract, Interface, JsonRpcProvider, parseUnits, formatUnits } = await import("ethers");
  const discovered = await discoverFxrpOftRoutes(env);
  const route = resolveOftRouteByEid(params.dstEid, discovered.routes);

  if (discovered.source === "fallback" || !route.live) {
    throw new Error(
      `Refuse OFT prepare for EID ${params.dstEid}: peer list is fallback-snapshot (not live peers()). Re-discover via GET /v1/agents/bridge/routes when Coston2 RPC is healthy.`,
    );
  }

  // Re-verify peers(eid) immediately before quoting — never trust stale cache alone for send.
  const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
  const oftCheck = new Contract(COSTON2_FXRP_OFT_ADAPTER, PEERS_ABI, provider);
  const peerBytes = (await oftCheck.peers(params.dstEid)) as string;
  const livePeer = peerBytesToAddress(peerBytes);
  if (!livePeer || livePeer !== route.peer.toLowerCase()) {
    throw new Error(
      `Peer mismatch for EID ${params.dstEid}: expected ${route.peer}, on-chain ${livePeer ?? "none"}.`,
    );
  }

  const fxrp = await resolveFxrpAddress(env);
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
    routesSource: discovered.source,
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
    deliveryHint:
      "After send: decode OFT GUID from logs → observe on LayerZero Scan → poll dest OFTReceived. Never claim fill from source tx alone.",
  };
}
