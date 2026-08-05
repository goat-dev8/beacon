import { JsonRpcProvider, Contract } from "ethers";
import { loadEnv, type BeaconEnv } from "./env.js";

export const FLARE_CONTRACT_REGISTRY_DEFAULT =
  "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";

/** Official Coston2 USDT0 (SparkDEX / faucet), not Beacon MockUSDT0. */
export const COSTON2_USDT0 = "0xC1A5B41512496B80903D1f32d6dEa3a73212E71F";
export const SPARKDEX_SWAP_ROUTER = "0x8a1E35F5c98C4E85B36B7B253222eE17773b2781";
export const SPARKDEX_POOL_FEE = 500;

export const FTSO_FEEDS = [
  { symbol: "FLR/USD", id: "0x01464c522f55534400000000000000000000000000" },
  { symbol: "BTC/USD", id: "0x014254432f55534400000000000000000000000000" },
  { symbol: "XRP/USD", id: "0x015852502f55534400000000000000000000000000" },
  { symbol: "ETH/USD", id: "0x014554482f55534400000000000000000000000000" },
] as const;

export interface FtsoQuote {
  symbol: string;
  feedId: string;
  value: number;
  decimals: number;
  raw: string;
  timestamp: number;
}

export async function resolveFtsoV2Address(env: BeaconEnv = loadEnv()): Promise<string> {
  const rpc = env.COSTON2_RPC_URL;
  const registry = env.FLARE_CONTRACT_REGISTRY || FLARE_CONTRACT_REGISTRY_DEFAULT;
  const provider = new JsonRpcProvider(rpc);
  const reg = new Contract(
    registry,
    ["function getContractAddressByName(string) view returns (address)"],
    provider,
  );
  return reg.getContractAddressByName("FtsoV2") as Promise<string>;
}

export async function readFtsoFeeds(env: BeaconEnv = loadEnv()): Promise<{
  ftsoV2: string;
  timestamp: number;
  feeds: FtsoQuote[];
}> {
  const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
  const ftsoV2 = await resolveFtsoV2Address(env);
  const ftso = new Contract(
    ftsoV2,
    [
      "function getFeedsById(bytes21[]) view returns (uint256[] values, int8[] decimals, uint64 timestamp)",
    ],
    provider,
  );
  const ids = FTSO_FEEDS.map((f) => f.id);
  const result = await ftso.getFeedsById(ids);
  const values = result[0] as bigint[];
  const decimals = result[1] as number[];
  const timestamp = Number(result[2]);
  const feeds: FtsoQuote[] = FTSO_FEEDS.map((f, i) => {
    const d = Number(decimals[i]);
    const raw = values[i]!.toString();
    const value = Number(values[i]) / 10 ** d;
    return { symbol: f.symbol, feedId: f.id, value, decimals: d, raw, timestamp };
  });
  return { ftsoV2, timestamp, feeds };
}

export function buildTradeSignal(feeds: FtsoQuote[]): {
  bias: "risk-on" | "risk-off" | "neutral";
  summary: string;
  highlights: string[];
} {
  const flr = feeds.find((f) => f.symbol === "FLR/USD")?.value ?? 0;
  const xrp = feeds.find((f) => f.symbol === "XRP/USD")?.value ?? 0;
  const btc = feeds.find((f) => f.symbol === "BTC/USD")?.value ?? 0;
  const highlights = feeds.map((f) => `${f.symbol} ${f.value.toPrecision(6)}`);
  // Simple transparent heuristic, not financial advice.
  let bias: "risk-on" | "risk-off" | "neutral" = "neutral";
  if (btc > 60_000 && xrp > 1) bias = "risk-on";
  if (btc < 50_000 || flr < 0.005) bias = "risk-off";
  const summary =
    bias === "risk-on"
      ? "FTSO snapshot leans risk-on (BTC>60k, XRP>1). Consider sized USDT0→FXRP only after your own risk checks."
      : bias === "risk-off"
        ? "FTSO snapshot leans cautious. Prefer smaller size or wait; do not chase."
        : "FTSO snapshot is mixed. No strong bias, wait for clearer structure.";
  return { bias, summary, highlights };
}

export async function resolveFxrpAddress(env: BeaconEnv = loadEnv()): Promise<string> {
  const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
  const registry = env.FLARE_CONTRACT_REGISTRY || FLARE_CONTRACT_REGISTRY_DEFAULT;
  const reg = new Contract(
    registry,
    ["function getContractAddressByName(string) view returns (address)"],
    provider,
  );
  const am = await reg.getContractAddressByName("AssetManagerFXRP");
  const manager = new Contract(am, ["function fAsset() view returns (address)"], provider);
  return manager.fAsset() as Promise<string>;
}

export async function readErc20Balance(
  token: string,
  owner: string,
  env: BeaconEnv = loadEnv(),
): Promise<{ raw: bigint; formatted: string; decimals: number; symbol: string }> {
  const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
  const erc = new Contract(
    token,
    [
      "function balanceOf(address) view returns (uint256)",
      "function decimals() view returns (uint8)",
      "function symbol() view returns (string)",
    ],
    provider,
  );
  const [raw, decimals, symbol] = await Promise.all([
    erc.balanceOf(owner) as Promise<bigint>,
    erc.decimals() as Promise<number>,
    erc.symbol() as Promise<string>,
  ]);
  const d = Number(decimals);
  const formatted = (Number(raw) / 10 ** d).toFixed(Math.min(6, d));
  return { raw, formatted, decimals: d, symbol };
}

/** Estimate FXRP out from USDT0 in using FTSO XRP/USD (FXRP ≈ XRP). */
export async function estimateUsdt0ToFxrp(
  amountInUnits: string,
  env: BeaconEnv = loadEnv(),
): Promise<{ amountIn: string; estimatedFxrp: string; xrpUsd: number; slippageBps: number }> {
  const snap = await readFtsoFeeds(env);
  const xrp = snap.feeds.find((f) => f.symbol === "XRP/USD")?.value ?? 1;
  const amountIn = parseFloat(amountInUnits);
  const estimated = xrp > 0 ? amountIn / xrp : 0;
  return {
    amountIn: amountInUnits,
    estimatedFxrp: estimated.toFixed(6),
    xrpUsd: xrp,
    slippageBps: 100,
  };
}

/**
 * Prepare Uniswap V3 exactInputSingle calldata for SparkDEX USDT0 → FXRP.
 * User must approve router then send this tx from MetaMask, we never auto-broadcast.
 */
export async function prepareUsdt0ToFxrpSwap(
  params: { amountInUnits: string; recipient: string; amountOutMinUnits?: string },
  env: BeaconEnv = loadEnv(),
): Promise<{
  tokenIn: string;
  tokenOut: string;
  router: string;
  fee: number;
  amountIn: string;
  amountInDisplay: string;
  amountOutMinimum: string;
  estimatedFxrp: string;
  xrpUsd: number;
  deadline: number;
  approveTo: string;
  swapTo: string;
  approveData: string;
  swapData: string;
  explorerApproveHint: string;
  docs: string[];
}> {
  const { Interface, parseUnits } = await import("ethers");
  const fxrp = await resolveFxrpAddress(env);
  const estimate = await estimateUsdt0ToFxrp(params.amountInUnits, env);
  const amountIn = parseUnits(params.amountInUnits, 6);
  const minOut =
    params.amountOutMinUnits ??
    (Math.max(0, parseFloat(estimate.estimatedFxrp) * 0.99) || 0).toFixed(6);
  const amountOutMinimum = parseUnits(minOut, 6);
  const deadline = Math.floor(Date.now() / 1000) + 20 * 60;
  const erc20 = new Interface([
    "function approve(address spender, uint256 amount) returns (bool)",
  ]);
  const routerIf = new Interface([
    "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  ]);
  const approveData = erc20.encodeFunctionData("approve", [SPARKDEX_SWAP_ROUTER, amountIn]);
  const swapData = routerIf.encodeFunctionData("exactInputSingle", [
    {
      tokenIn: COSTON2_USDT0,
      tokenOut: fxrp,
      fee: SPARKDEX_POOL_FEE,
      recipient: params.recipient,
      deadline,
      amountIn,
      amountOutMinimum,
      sqrtPriceLimitX96: 0n,
    },
  ]);
  return {
    tokenIn: COSTON2_USDT0,
    tokenOut: fxrp,
    router: SPARKDEX_SWAP_ROUTER,
    fee: SPARKDEX_POOL_FEE,
    amountIn: amountIn.toString(),
    amountInDisplay: params.amountInUnits,
    amountOutMinimum: amountOutMinimum.toString(),
    estimatedFxrp: estimate.estimatedFxrp,
    xrpUsd: estimate.xrpUsd,
    deadline,
    approveTo: COSTON2_USDT0,
    swapTo: SPARKDEX_SWAP_ROUTER,
    approveData,
    swapData,
    explorerApproveHint: `https://coston2-explorer.flare.network/address/${COSTON2_USDT0}`,
    docs: [
      "https://dev.flare.network/fxrp/token-interactions/usdt0-fxrp-swap",
      "https://dev.flare.network/smart-accounts/guides/typescript-viem/control-usdt0-ts#swap-usdt0-to-fxrp",
    ],
  };
}
