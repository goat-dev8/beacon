/**
 * SparkDEX (Uniswap V3) discovery + swap prepare.
 *
 * Honesty (verified 2026-08-06):
 * - SparkDEX V3 Factory / SwapRouter bytecode exists on Flare Mainnet (chain 14).
 * - Same published addresses have NO code on Coston2 (chain 114).
 * - DevHub Coston2 USDT0 guides reuse the mainnet router address — do not execute dead swaps.
 *
 * Sources:
 * https://docs.sparkdex.ai/additional-information/smart-contract-overview/v2-v3.1-dex
 * https://dev.flare.network/fxrp/token-interactions/usdt0-fxrp-swap
 */

import { Contract, Interface, JsonRpcProvider, parseUnits } from "ethers";
import { loadEnv, type BeaconEnv } from "./env.js";
import {
  COSTON2_USDT0,
  FLARE_CONTRACT_REGISTRY_DEFAULT,
  readFtsoFeeds,
  resolveFxrpAddress,
} from "./ftso.js";

export { COSTON2_USDT0 };

export const SPARKDEX_V3_FACTORY = "0x8A2578d23d4C532cC9A98FaD91C0523f5efDE652";
export const SPARKDEX_SWAP_ROUTER = "0x8a1E35F5c98C4E85B36B7B253222eE17773b2781";
export const SPARKDEX_FEE_TIERS = [100, 500, 3000, 10000] as const;

export const FLARE_MAINNET_CHAIN_ID = 14;
export const FLARE_MAINNET_RPC_DEFAULT = "https://flare-api.flare.network/ext/C/rpc";
/** Official Flare Mainnet USDT0 (SparkDEX guide). */
export const FLARE_MAINNET_USDT0 = "0xe7cd86e13AC4309349F30B3435a9d337750fC82D";

const FACTORY_ABI = ["function getPool(address,address,uint24) view returns (address)"];
const POOL_ABI = [
  "function liquidity() view returns (uint128)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
];
const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

export type SparkDexNetwork = "flare" | "none";

export interface SparkDexDeployment {
  network: SparkDexNetwork;
  chainId: number;
  rpc: string;
  explorer: string;
  factory: string;
  router: string;
  usdt0: string;
  fxrp: string;
  wnat: string;
  honesty: string;
}

export interface SparkDexPool {
  pairKey: string;
  symbolA: string;
  symbolB: string;
  tokenA: string;
  tokenB: string;
  fee: number;
  pool: string;
  liquidity: string;
  executable: boolean;
}

export interface SparkDexPairView {
  pairKey: string;
  symbolA: string;
  symbolB: string;
  tokenA: string;
  tokenB: string;
  bestFee: number;
  bestPool: string;
  liquidity: string;
  directions: Array<"A_TO_B" | "B_TO_A">;
}

let pairsCache:
  | { at: number; deployment: SparkDexDeployment; pairs: SparkDexPairView[]; pools: SparkDexPool[] }
  | null = null;
const PAIRS_TTL_MS = 5 * 60_000;

async function codeLen(rpc: string, address: string): Promise<number> {
  const provider = new JsonRpcProvider(rpc);
  const code = await provider.getCode(address);
  return code.length;
}

async function resolveTokenMeta(
  provider: JsonRpcProvider,
  address: string,
): Promise<{ symbol: string; decimals: number }> {
  const erc = new Contract(address, ERC20_ABI, provider);
  const decimals = Number(await erc.decimals());
  let symbol = "TOKEN";
  try {
    symbol = String(await erc.symbol());
  } catch {
    /* some tokens revert on symbol */
  }
  return { symbol, decimals };
}

export async function resolveSparkDexDeployment(
  env: BeaconEnv = loadEnv(),
): Promise<SparkDexDeployment> {
  const mainRpc = process.env.FLARE_MAINNET_RPC_URL || FLARE_MAINNET_RPC_DEFAULT;
  const coston2Rpc = env.COSTON2_RPC_URL;

  const [mainRouter, c2Router] = await Promise.all([
    codeLen(mainRpc, SPARKDEX_SWAP_ROUTER),
    codeLen(coston2Rpc, SPARKDEX_SWAP_ROUTER),
  ]);

  if (mainRouter > 2) {
    const provider = new JsonRpcProvider(mainRpc);
    const registry = env.FLARE_CONTRACT_REGISTRY || FLARE_CONTRACT_REGISTRY_DEFAULT;
    const reg = new Contract(
      registry,
      ["function getContractAddressByName(string) view returns (address)"],
      provider,
    );
    const am = await reg.getContractAddressByName("AssetManagerFXRP");
    const manager = new Contract(am, ["function fAsset() view returns (address)"], provider);
    const fxrp = (await manager.fAsset()) as string;
    const wnat = (await reg.getContractAddressByName("WNat")) as string;
    return {
      network: "flare",
      chainId: FLARE_MAINNET_CHAIN_ID,
      rpc: mainRpc,
      explorer: "https://flarescan.com",
      factory: SPARKDEX_V3_FACTORY,
      router: SPARKDEX_SWAP_ROUTER,
      usdt0: FLARE_MAINNET_USDT0,
      fxrp,
      wnat,
      honesty:
        c2Router <= 2
          ? "SparkDEX SwapRouter has bytecode on Flare Mainnet only. Coston2 has no SparkDEX router at the published address — swaps execute on chain 14."
          : "SparkDEX SwapRouter verified on Flare Mainnet.",
    };
  }

  return {
    network: "none",
    chainId: 0,
    rpc: "",
    explorer: "",
    factory: SPARKDEX_V3_FACTORY,
    router: SPARKDEX_SWAP_ROUTER,
    usdt0: FLARE_MAINNET_USDT0,
    fxrp: "",
    wnat: "",
    honesty:
      "SparkDEX contracts not reachable. Cannot prepare executable swaps until Flare Mainnet RPC is available.",
  };
}

function pairKey(a: string, b: string): string {
  return [a.toLowerCase(), b.toLowerCase()].sort().join("-");
}

export async function discoverSparkDexPools(
  env: BeaconEnv = loadEnv(),
  opts?: { force?: boolean },
): Promise<{
  deployment: SparkDexDeployment;
  pools: SparkDexPool[];
  pairs: SparkDexPairView[];
  discoveredAt: number;
}> {
  if (!opts?.force && pairsCache && Date.now() - pairsCache.at < PAIRS_TTL_MS) {
    return {
      deployment: pairsCache.deployment,
      pools: pairsCache.pools,
      pairs: pairsCache.pairs,
      discoveredAt: pairsCache.at,
    };
  }

  const deployment = await resolveSparkDexDeployment(env);
  if (deployment.network === "none") {
    const empty = { deployment, pools: [] as SparkDexPool[], pairs: [] as SparkDexPairView[], discoveredAt: Date.now() };
    return empty;
  }

  const provider = new JsonRpcProvider(deployment.rpc);
  const factory = new Contract(deployment.factory, FACTORY_ABI, provider);

  const tokens: Array<{ address: string; symbolHint: string }> = [
    { address: deployment.usdt0, symbolHint: "USDT0" },
    { address: deployment.fxrp, symbolHint: "FXRP" },
    { address: deployment.wnat, symbolHint: "WFLR" },
  ];

  const metas = await Promise.all(
    tokens.map(async (t) => {
      const meta = await resolveTokenMeta(provider, t.address);
      return { ...t, symbol: meta.symbol || t.symbolHint, decimals: meta.decimals };
    }),
  );

  const pools: SparkDexPool[] = [];
  for (let i = 0; i < metas.length; i++) {
    for (let j = i + 1; j < metas.length; j++) {
      const A = metas[i]!;
      const B = metas[j]!;
      for (const fee of SPARKDEX_FEE_TIERS) {
        try {
          const poolAddr = (await factory.getPool(A.address, B.address, fee)) as string;
          if (!poolAddr || poolAddr === "0x0000000000000000000000000000000000000000") continue;
          const pool = new Contract(poolAddr, POOL_ABI, provider);
          const liquidity = (await pool.liquidity()) as bigint;
          if (liquidity <= 0n) continue;
          pools.push({
            pairKey: pairKey(A.symbol, B.symbol),
            symbolA: A.symbol,
            symbolB: B.symbol,
            tokenA: A.address,
            tokenB: B.address,
            fee,
            pool: poolAddr,
            liquidity: liquidity.toString(),
            executable: true,
          });
        } catch {
          /* skip missing fee tier */
        }
      }
    }
  }

  const byPair = new Map<string, SparkDexPool[]>();
  for (const p of pools) {
    const list = byPair.get(p.pairKey) ?? [];
    list.push(p);
    byPair.set(p.pairKey, list);
  }

  const pairs: SparkDexPairView[] = [...byPair.entries()].map(([, list]) => {
    const sorted = [...list].sort((a, b) => (BigInt(b.liquidity) > BigInt(a.liquidity) ? 1 : -1));
    const best = sorted[0]!;
    return {
      pairKey: best.pairKey,
      symbolA: best.symbolA,
      symbolB: best.symbolB,
      tokenA: best.tokenA,
      tokenB: best.tokenB,
      bestFee: best.fee,
      bestPool: best.pool,
      liquidity: best.liquidity,
      directions: ["A_TO_B", "B_TO_A"],
    };
  });

  const at = Date.now();
  pairsCache = { at, deployment, pairs, pools };
  return { deployment, pools, pairs, discoveredAt: at };
}

export async function estimateSparkDexOut(params: {
  tokenInSymbol: string;
  tokenOutSymbol: string;
  amountInUnits: string;
  env?: BeaconEnv;
}): Promise<{ estimatedOut: string; basis: string; xrpUsd?: number; flrUsd?: number }> {
  const env = params.env ?? loadEnv();
  const snap = await readFtsoFeeds(env);
  const xrp = snap.feeds.find((f) => f.symbol === "XRP/USD")?.value ?? 0;
  const flr = snap.feeds.find((f) => f.symbol === "FLR/USD")?.value ?? 0;
  const amount = parseFloat(params.amountInUnits) || 0;
  const a = params.tokenInSymbol.toUpperCase();
  const b = params.tokenOutSymbol.toUpperCase();

  const usdOf = (sym: string, qty: number) => {
    if (sym.includes("USDT")) return qty;
    if (sym.includes("FXRP") || sym === "XRP") return qty * xrp;
    if (sym.includes("WFLR") || sym.includes("FLR") || sym.includes("WNAT")) return qty * flr;
    return 0;
  };

  const inUsd = usdOf(a, amount);
  let out = 0;
  if (b.includes("USDT")) out = inUsd;
  else if (b.includes("FXRP") || b === "XRP") out = xrp > 0 ? inUsd / xrp : 0;
  else if (b.includes("WFLR") || b.includes("FLR") || b.includes("WNAT")) out = flr > 0 ? inUsd / flr : 0;

  return {
    estimatedOut: out.toFixed(6),
    basis: "FTSO mid (not pool quoter) — final fill is SparkDEX pool",
    xrpUsd: xrp,
    flrUsd: flr,
  };
}

export async function prepareSparkDexSwap(
  params: {
    tokenIn: string;
    tokenOut: string;
    fee?: number;
    amountInUnits: string;
    recipient: string;
    amountOutMinUnits?: string;
  },
  env: BeaconEnv = loadEnv(),
): Promise<{
  ok: true;
  chainId: number;
  network: string;
  tokenIn: string;
  tokenOut: string;
  symbolIn: string;
  symbolOut: string;
  router: string;
  factory: string;
  pool: string;
  fee: number;
  amountIn: string;
  amountInDisplay: string;
  amountOutMinimum: string;
  estimatedOut: string;
  estimateBasis: string;
  deadline: number;
  approveTo: string;
  swapTo: string;
  approveData: string;
  swapData: string;
  explorer: string;
  honesty: string;
  docs: string[];
  requiresChainSwitch: boolean;
} | { ok: false; error: string; honesty: string }> {
  const discovered = await discoverSparkDexPools(env);
  const { deployment } = discovered;
  if (deployment.network === "none") {
    return { ok: false, error: "SparkDEX unavailable", honesty: deployment.honesty };
  }

  const provider = new JsonRpcProvider(deployment.rpc);
  const inMeta = await resolveTokenMeta(provider, params.tokenIn);
  const outMeta = await resolveTokenMeta(provider, params.tokenOut);

  let fee = params.fee;
  let pool = "";
  const candidates = discovered.pools.filter(
    (p) =>
      (p.tokenA.toLowerCase() === params.tokenIn.toLowerCase() &&
        p.tokenB.toLowerCase() === params.tokenOut.toLowerCase()) ||
      (p.tokenB.toLowerCase() === params.tokenIn.toLowerCase() &&
        p.tokenA.toLowerCase() === params.tokenOut.toLowerCase()),
  );
  if (!candidates.length) {
    return {
      ok: false,
      error: "No liquid SparkDEX pool for this pair",
      honesty: deployment.honesty,
    };
  }
  const best = [...candidates].sort((a, b) => (BigInt(b.liquidity) > BigInt(a.liquidity) ? 1 : -1))[0]!;
  fee = fee ?? best.fee;
  const match = candidates.find((c) => c.fee === fee) ?? best;
  fee = match.fee;
  pool = match.pool;

  const estimate = await estimateSparkDexOut({
    tokenInSymbol: inMeta.symbol,
    tokenOutSymbol: outMeta.symbol,
    amountInUnits: params.amountInUnits,
    env,
  });
  const amountIn = parseUnits(params.amountInUnits, inMeta.decimals);
  const minOut =
    params.amountOutMinUnits ??
    (Math.max(0, parseFloat(estimate.estimatedOut) * 0.99) || 0).toFixed(6);
  const amountOutMinimum = parseUnits(minOut, outMeta.decimals);
  const deadline = Math.floor(Date.now() / 1000) + 20 * 60;

  const erc20 = new Interface(["function approve(address spender, uint256 amount) returns (bool)"]);
  const routerIf = new Interface([
    "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  ]);

  return {
    ok: true,
    chainId: deployment.chainId,
    network: "Flare Mainnet",
    tokenIn: params.tokenIn,
    tokenOut: params.tokenOut,
    symbolIn: inMeta.symbol,
    symbolOut: outMeta.symbol,
    router: deployment.router,
    factory: deployment.factory,
    pool,
    fee,
    amountIn: amountIn.toString(),
    amountInDisplay: params.amountInUnits,
    amountOutMinimum: amountOutMinimum.toString(),
    estimatedOut: estimate.estimatedOut,
    estimateBasis: estimate.basis,
    deadline,
    approveTo: params.tokenIn,
    swapTo: deployment.router,
    approveData: erc20.encodeFunctionData("approve", [deployment.router, amountIn]),
    swapData: routerIf.encodeFunctionData("exactInputSingle", [
      {
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        fee,
        recipient: params.recipient,
        deadline,
        amountIn,
        amountOutMinimum,
        sqrtPriceLimitX96: 0n,
      },
    ]),
    explorer: deployment.explorer,
    honesty: deployment.honesty,
    docs: [
      "https://dev.flare.network/fxrp/token-interactions/usdt0-fxrp-swap",
      "https://docs.sparkdex.ai/additional-information/smart-contract-overview/v2-v3.1-dex",
    ],
    requiresChainSwitch: env.CHAIN_ID !== deployment.chainId,
  };
}

/** Default USDT0 → FXRP on the network where SparkDEX actually exists. */
export async function prepareUsdt0ToFxrpSwap(
  params: { amountInUnits: string; recipient: string; amountOutMinUnits?: string },
  env: BeaconEnv = loadEnv(),
) {
  const dep = await resolveSparkDexDeployment(env);
  if (dep.network === "none") {
    throw new Error(dep.honesty);
  }
  const prep = await prepareSparkDexSwap(
    {
      tokenIn: dep.usdt0,
      tokenOut: dep.fxrp,
      fee: 500,
      amountInUnits: params.amountInUnits,
      recipient: params.recipient,
      amountOutMinUnits: params.amountOutMinUnits,
    },
    env,
  );
  if (!prep.ok) throw new Error(prep.error);
  return {
    tokenIn: prep.tokenIn,
    tokenOut: prep.tokenOut,
    router: prep.router,
    fee: prep.fee,
    amountIn: prep.amountIn,
    amountInDisplay: prep.amountInDisplay,
    amountOutMinimum: prep.amountOutMinimum,
    estimatedFxrp: prep.estimatedOut,
    xrpUsd: (await estimateSparkDexOut({ tokenInSymbol: "USDT0", tokenOutSymbol: "FXRP", amountInUnits: params.amountInUnits, env })).xrpUsd ?? 0,
    deadline: prep.deadline,
    approveTo: prep.approveTo,
    swapTo: prep.swapTo,
    approveData: prep.approveData,
    swapData: prep.swapData,
    explorerApproveHint: `${prep.explorer}/address/${prep.tokenIn}`,
    docs: prep.docs,
    chainId: prep.chainId,
    network: prep.network,
    pool: prep.pool,
    honesty: prep.honesty,
    requiresChainSwitch: prep.requiresChainSwitch,
    symbolIn: prep.symbolIn,
    symbolOut: prep.symbolOut,
    estimatedOut: prep.estimatedOut,
  };
}

/** Resolve FXRP on whichever registry RPC we pass — prefer Coston2 for desk, mainnet for SparkDEX. */
export async function resolveFxrpOnRpc(rpc: string, registry?: string): Promise<string> {
  const provider = new JsonRpcProvider(rpc);
  const reg = new Contract(
    registry || FLARE_CONTRACT_REGISTRY_DEFAULT,
    ["function getContractAddressByName(string) view returns (address)"],
    provider,
  );
  const am = await reg.getContractAddressByName("AssetManagerFXRP");
  const manager = new Contract(am, ["function fAsset() view returns (address)"], provider);
  return manager.fAsset() as Promise<string>;
}

export { resolveFxrpAddress };
