/**
 * SparkDEX (Uniswap V3) discovery + QuoterV2 quotes + swap prepare.
 *
 * Honesty (verified 2026-08-06):
 * - SparkDEX V3 Factory / SwapRouter / QuoterV2 bytecode exists on Flare Mainnet (chain 14).
 * - Same published addresses have NO code on Coston2 (chain 114).
 * - Executable quotes + minOut come from QuoterV2 only — NEVER FTSO mid.
 * - FTSO mid is for portfolio marking / narrative bias only (see estimateSparkDexOutFtso).
 *
 * Sources:
 * https://docs.sparkdex.ai/additional-information/smart-contract-overview/v2-v3.1-dex
 * https://dev.flare.network/fxrp/token-interactions/usdt0-fxrp-swap
 */

import { Contract, Interface, JsonRpcProvider, formatUnits, parseUnits } from "ethers";
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
/** Official SparkDEX QuoterV2 — Flare Mainnet only. */
export const SPARKDEX_QUOTER_V2 = "0x5B5513c55fd06e2658010c121c37b07fC8e8B705";
export const SPARKDEX_FEE_TIERS = [100, 500, 3000, 10000] as const;

export const FLARE_MAINNET_CHAIN_ID = 14;
export const FLARE_MAINNET_RPC_DEFAULT = "https://flare-api.flare.network/ext/C/rpc";
/** Official Flare Mainnet USDT0 (SparkDEX guide). */
export const FLARE_MAINNET_USDT0 = "0xe7cd86e13AC4309349F30B3435a9d337750fC82D";

/** Default slippage applied to QuoterV2 amountOut → amountOutMinimum (100 = 1%). */
export const SPARKDEX_DEFAULT_SLIPPAGE_BPS = 100;

const FACTORY_ABI = [
  "function getPool(address,address,uint24) view returns (address)",
  "event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)",
];
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
const QUOTER_V2_ABI = [
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
  "function quoteExactInput(bytes path,uint256 amountIn) returns (uint256 amountOut,uint160[] sqrtPriceX96AfterList,uint32[] initializedTicksCrossedList,uint256 gasEstimate)",
];

export type SparkDexNetwork = "flare" | "none";

export interface SparkDexDeployment {
  network: SparkDexNetwork;
  chainId: number;
  rpc: string;
  explorer: string;
  factory: string;
  router: string;
  quoter: string;
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
  discovery: "pool_created" | "get_pool";
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

export interface SparkDexQuote {
  amountOut: bigint;
  amountOutDisplay: string;
  fee: number;
  pool: string;
  basis: "QuoterV2 quoteExactInputSingle";
  gasEstimate?: string;
  /** FTSO mid expected out — narrative only, never used as minOut. */
  ftsoMidOutDisplay?: string;
  /** |quote - FTSO mid| / FTSO mid in bps (null if FTSO unavailable). */
  priceImpactVsFtsoBps: number | null;
  slippageBps: number;
  amountOutMinimum: bigint;
  amountOutMinimumDisplay: string;
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

function pairKey(a: string, b: string): string {
  return [a.toLowerCase(), b.toLowerCase()].sort().join("-");
}

function addrKey(a: string, b: string, fee: number): string {
  return `${[a.toLowerCase(), b.toLowerCase()].sort().join("-")}:${fee}`;
}

export async function resolveSparkDexDeployment(
  env: BeaconEnv = loadEnv(),
): Promise<SparkDexDeployment> {
  const mainRpc = process.env.FLARE_MAINNET_RPC_URL || FLARE_MAINNET_RPC_DEFAULT;
  const coston2Rpc = env.COSTON2_RPC_URL;

  const [mainRouter, mainQuoter, c2Router, c2Quoter] = await Promise.all([
    codeLen(mainRpc, SPARKDEX_SWAP_ROUTER),
    codeLen(mainRpc, SPARKDEX_QUOTER_V2),
    codeLen(coston2Rpc, SPARKDEX_SWAP_ROUTER),
    codeLen(coston2Rpc, SPARKDEX_QUOTER_V2),
  ]);

  if (mainRouter > 2 && mainQuoter > 2) {
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
    const c2Empty = c2Router <= 2 && c2Quoter <= 2;
    return {
      network: "flare",
      chainId: FLARE_MAINNET_CHAIN_ID,
      rpc: mainRpc,
      explorer: "https://flarescan.com",
      factory: SPARKDEX_V3_FACTORY,
      router: SPARKDEX_SWAP_ROUTER,
      quoter: SPARKDEX_QUOTER_V2,
      usdt0: FLARE_MAINNET_USDT0,
      fxrp,
      wnat,
      honesty: c2Empty
        ? "SparkDEX SwapRouter + QuoterV2 have bytecode on Flare Mainnet only. Coston2 has empty bytecode at published addresses — no fake swaps; execute on chain 14."
        : "SparkDEX SwapRouter + QuoterV2 verified on Flare Mainnet.",
    };
  }

  return {
    network: "none",
    chainId: 0,
    rpc: "",
    explorer: "",
    factory: SPARKDEX_V3_FACTORY,
    router: SPARKDEX_SWAP_ROUTER,
    quoter: SPARKDEX_QUOTER_V2,
    usdt0: FLARE_MAINNET_USDT0,
    fxrp: "",
    wnat: "",
    honesty:
      "SparkDEX contracts not reachable (router/quoter). Cannot prepare executable swaps until Flare Mainnet RPC is available.",
  };
}

/** FTSO mid conversion — portfolio / narrative only. NEVER use as SparkDEX minOut. */
export async function estimateSparkDexOutFtso(params: {
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
    const s = sym.toUpperCase().replace(/₮/g, "T");
    if (s.includes("USDT")) return qty;
    if (s.includes("FXRP") || s === "XRP") return qty * xrp;
    if (s.includes("WFLR") || s.includes("FLR") || s.includes("WNAT")) return qty * flr;
    return 0;
  };

  const inUsd = usdOf(a, amount);
  let out = 0;
  const bNorm = b.replace(/₮/g, "T");
  if (bNorm.includes("USDT")) out = inUsd;
  else if (bNorm.includes("FXRP") || bNorm === "XRP") out = xrp > 0 ? inUsd / xrp : 0;
  else if (bNorm.includes("WFLR") || bNorm.includes("FLR") || bNorm.includes("WNAT"))
    out = flr > 0 ? inUsd / flr : 0;

  return {
    estimatedOut: out.toFixed(6),
    basis: "FTSO mid (narrative / portfolio only — not an executable SparkDEX quote)",
    xrpUsd: xrp,
    flrUsd: flr,
  };
}

/**
 * @deprecated Prefer quoteSparkDexExactInput for executable quotes.
 * Kept for callers that only need FTSO narrative mid — does NOT power minOut.
 */
export async function estimateSparkDexOut(params: {
  tokenInSymbol: string;
  tokenOutSymbol: string;
  amountInUnits: string;
  env?: BeaconEnv;
}): Promise<{ estimatedOut: string; basis: string; xrpUsd?: number; flrUsd?: number }> {
  return estimateSparkDexOutFtso(params);
}

async function discoverPoolsFromLogs(
  provider: JsonRpcProvider,
  factoryAddr: string,
  tokenSet: Set<string>,
): Promise<Array<{ token0: string; token1: string; fee: number; pool: string }>> {
  const factory = new Contract(factoryAddr, FACTORY_ABI, provider);
  const latest = await provider.getBlockNumber();
  // SparkDEX mainnet history is manageable; cap lookback for RPC friendliness.
  const fromBlock = Math.max(0, latest - 2_500_000);
  const found: Array<{ token0: string; token1: string; fee: number; pool: string }> = [];
  try {
    const filter = factory.filters.PoolCreated();
    const logs = await factory.queryFilter(filter, fromBlock, latest);
    for (const log of logs) {
      const args = (log as { args?: { token0?: string; token1?: string; fee?: bigint; pool?: string } }).args;
      if (!args?.token0 || !args?.token1 || args.fee === undefined || !args.pool) continue;
      const t0 = args.token0.toLowerCase();
      const t1 = args.token1.toLowerCase();
      if (!tokenSet.has(t0) || !tokenSet.has(t1)) continue;
      found.push({
        token0: args.token0,
        token1: args.token1,
        fee: Number(args.fee),
        pool: args.pool,
      });
    }
  } catch {
    /* RPC may reject large ranges — getPool fallback still runs */
  }
  return found;
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
    return { deployment, pools: [], pairs: [], discoveredAt: Date.now() };
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
  const metaByAddr = new Map(metas.map((m) => [m.address.toLowerCase(), m]));
  const tokenSet = new Set(metas.map((m) => m.address.toLowerCase()));

  const poolsByKey = new Map<string, SparkDexPool>();

  const fromLogs = await discoverPoolsFromLogs(provider, deployment.factory, tokenSet);
  for (const row of fromLogs) {
    const A = metaByAddr.get(row.token0.toLowerCase());
    const B = metaByAddr.get(row.token1.toLowerCase());
    if (!A || !B) continue;
    try {
      const pool = new Contract(row.pool, POOL_ABI, provider);
      const liquidity = (await pool.liquidity()) as bigint;
      if (liquidity <= 0n) continue;
      const key = addrKey(A.address, B.address, row.fee);
      poolsByKey.set(key, {
        pairKey: pairKey(A.symbol, B.symbol),
        symbolA: A.symbol,
        symbolB: B.symbol,
        tokenA: A.address,
        tokenB: B.address,
        fee: row.fee,
        pool: row.pool,
        liquidity: liquidity.toString(),
        executable: true,
        discovery: "pool_created",
      });
    } catch {
      /* skip */
    }
  }

  // Harden: fill gaps with factory.getPool for known fee tiers.
  for (let i = 0; i < metas.length; i++) {
    for (let j = i + 1; j < metas.length; j++) {
      const A = metas[i]!;
      const B = metas[j]!;
      for (const fee of SPARKDEX_FEE_TIERS) {
        const key = addrKey(A.address, B.address, fee);
        if (poolsByKey.has(key)) continue;
        try {
          const poolAddr = (await factory.getPool(A.address, B.address, fee)) as string;
          if (!poolAddr || poolAddr === "0x0000000000000000000000000000000000000000") continue;
          const pool = new Contract(poolAddr, POOL_ABI, provider);
          const liquidity = (await pool.liquidity()) as bigint;
          if (liquidity <= 0n) continue;
          poolsByKey.set(key, {
            pairKey: pairKey(A.symbol, B.symbol),
            symbolA: A.symbol,
            symbolB: B.symbol,
            tokenA: A.address,
            tokenB: B.address,
            fee,
            pool: poolAddr,
            liquidity: liquidity.toString(),
            executable: true,
            discovery: "get_pool",
          });
        } catch {
          /* skip missing fee tier */
        }
      }
    }
  }

  const pools = [...poolsByKey.values()];
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

function applySlippage(amountOut: bigint, slippageBps: number): bigint {
  const bps = BigInt(Math.max(0, Math.min(5_000, Math.floor(slippageBps))));
  return (amountOut * (10_000n - bps)) / 10_000n;
}

function priceImpactBps(quoteOut: number, ftsoOut: number): number | null {
  if (!(ftsoOut > 0) || !(quoteOut >= 0)) return null;
  return Math.round((Math.abs(quoteOut - ftsoOut) / ftsoOut) * 10_000);
}

/** QuoterV2 executable quote for a single-hop pool. */
export async function quoteSparkDexExactInput(
  params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
    fee: number;
    outDecimals: number;
    symbolIn: string;
    symbolOut: string;
    amountInDisplay: string;
    pool: string;
    slippageBps?: number;
    env?: BeaconEnv;
  },
  deployment: SparkDexDeployment,
): Promise<SparkDexQuote> {
  if (deployment.network !== "flare") {
    throw new Error("QuoterV2 only on Flare Mainnet (chain 14)");
  }
  const provider = new JsonRpcProvider(deployment.rpc);
  const quoter = new Contract(deployment.quoter, QUOTER_V2_ABI, provider);
  const slippageBps = params.slippageBps ?? SPARKDEX_DEFAULT_SLIPPAGE_BPS;

  const quoted = await quoter.quoteExactInputSingle.staticCall({
    tokenIn: params.tokenIn,
    tokenOut: params.tokenOut,
    amountIn: params.amountIn,
    fee: params.fee,
    sqrtPriceLimitX96: 0n,
  });
  const amountOut = BigInt(quoted.amountOut ?? quoted[0]);
  const gasEstimate = quoted.gasEstimate ?? quoted[3];
  const amountOutMinimum = applySlippage(amountOut, slippageBps);
  const amountOutDisplay = formatUnits(amountOut, params.outDecimals);
  const amountOutMinimumDisplay = formatUnits(amountOutMinimum, params.outDecimals);

  let ftsoMidOutDisplay: string | undefined;
  let impact: number | null = null;
  try {
    const ftso = await estimateSparkDexOutFtso({
      tokenInSymbol: params.symbolIn,
      tokenOutSymbol: params.symbolOut,
      amountInUnits: params.amountInDisplay,
      env: params.env,
    });
    ftsoMidOutDisplay = ftso.estimatedOut;
    impact = priceImpactBps(parseFloat(amountOutDisplay), parseFloat(ftso.estimatedOut));
  } catch {
    /* FTSO optional for impact display */
  }

  return {
    amountOut,
    amountOutDisplay,
    fee: params.fee,
    pool: params.pool,
    basis: "QuoterV2 quoteExactInputSingle",
    gasEstimate: gasEstimate != null ? String(gasEstimate) : undefined,
    ftsoMidOutDisplay,
    priceImpactVsFtsoBps: impact,
    slippageBps,
    amountOutMinimum,
    amountOutMinimumDisplay,
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
    slippageBps?: number;
  },
  env: BeaconEnv = loadEnv(),
): Promise<
  | {
      ok: true;
      chainId: number;
      network: string;
      tokenIn: string;
      tokenOut: string;
      symbolIn: string;
      symbolOut: string;
      router: string;
      factory: string;
      quoter: string;
      pool: string;
      fee: number;
      amountIn: string;
      amountInDisplay: string;
      amountOutMinimum: string;
      estimatedOut: string;
      estimateBasis: string;
      quoteSource: "QuoterV2";
      slippageBps: number;
      priceImpactVsFtsoBps: number | null;
      ftsoMidOut?: string;
      deadline: number;
      approveTo: string;
      swapTo: string;
      approveData: string;
      swapData: string;
      explorer: string;
      honesty: string;
      docs: string[];
      requiresChainSwitch: boolean;
    }
  | { ok: false; error: string; honesty: string }
> {
  const discovered = await discoverSparkDexPools(env);
  const { deployment } = discovered;
  if (deployment.network === "none") {
    return { ok: false, error: "SparkDEX unavailable", honesty: deployment.honesty };
  }

  const provider = new JsonRpcProvider(deployment.rpc);
  const quoterCode = await provider.getCode(deployment.quoter);
  if (quoterCode.length <= 2) {
    return {
      ok: false,
      error: "QuoterV2 has no bytecode on this RPC — refusing FTSO-as-quote fallback",
      honesty: deployment.honesty,
    };
  }

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

  const amountIn = parseUnits(params.amountInUnits, inMeta.decimals);
  const slippageBps = params.slippageBps ?? SPARKDEX_DEFAULT_SLIPPAGE_BPS;

  let quote: SparkDexQuote;
  try {
    quote = await quoteSparkDexExactInput(
      {
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn,
        fee,
        outDecimals: outMeta.decimals,
        symbolIn: inMeta.symbol,
        symbolOut: outMeta.symbol,
        amountInDisplay: params.amountInUnits,
        pool,
        slippageBps,
        env,
      },
      deployment,
    );
  } catch (e) {
    return {
      ok: false,
      error: `QuoterV2 failed: ${e instanceof Error ? e.message : String(e)}`,
      honesty: deployment.honesty,
    };
  }

  // Explicit override only — still never derived from FTSO.
  const amountOutMinimum = params.amountOutMinUnits
    ? parseUnits(params.amountOutMinUnits, outMeta.decimals)
    : quote.amountOutMinimum;

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
    quoter: deployment.quoter,
    pool,
    fee,
    amountIn: amountIn.toString(),
    amountInDisplay: params.amountInUnits,
    amountOutMinimum: amountOutMinimum.toString(),
    estimatedOut: quote.amountOutDisplay,
    estimateBasis: quote.basis,
    quoteSource: "QuoterV2",
    slippageBps: quote.slippageBps,
    priceImpactVsFtsoBps: quote.priceImpactVsFtsoBps,
    ftsoMidOut: quote.ftsoMidOutDisplay,
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
  params: { amountInUnits: string; recipient: string; amountOutMinUnits?: string; slippageBps?: number },
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
      slippageBps: params.slippageBps,
    },
    env,
  );
  if (!prep.ok) throw new Error(prep.error);
  const ftsoNarr = await estimateSparkDexOutFtso({
    tokenInSymbol: "USDT0",
    tokenOutSymbol: "FXRP",
    amountInUnits: params.amountInUnits,
    env,
  });
  return {
    tokenIn: prep.tokenIn,
    tokenOut: prep.tokenOut,
    router: prep.router,
    quoter: prep.quoter,
    fee: prep.fee,
    amountIn: prep.amountIn,
    amountInDisplay: prep.amountInDisplay,
    amountOutMinimum: prep.amountOutMinimum,
    estimatedFxrp: prep.estimatedOut,
    xrpUsd: ftsoNarr.xrpUsd ?? 0,
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
    estimateBasis: prep.estimateBasis,
    quoteSource: prep.quoteSource,
    slippageBps: prep.slippageBps,
    priceImpactVsFtsoBps: prep.priceImpactVsFtsoBps,
    ftsoMidOut: prep.ftsoMidOut,
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
