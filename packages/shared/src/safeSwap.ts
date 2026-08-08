/**
 * Beacon Safe swap on Coston2 — MockUSDT0 → FXRP via BeaconCoston2SwapDesk.
 *
 * Why this exists: SparkDEX SwapRouter/QuoterV2 have bytecode on Flare Mainnet (14)
 * only. Coston2 published addresses are empty — forcing MetaMask to Mainnet breaks
 * the hackathon testnet desk. Live MockUSDT0 also has no approve/transferFrom, so
 * Safe spend is vault.execute(token.transfer(desk)) then desk.fulfill(...).
 */

import {
  Contract,
  Interface,
  JsonRpcProvider,
  Wallet,
  formatUnits,
  parseUnits,
  id,
} from "ethers";
import { loadEnv, type BeaconEnv } from "./env.js";
import { readFtsoFeeds, resolveFxrpAddress } from "./ftso.js";
import {
  COSTON2_CHAIN_ID_VAULT,
  COSTON2_EXPLORER_VAULT,
  readAgentVaultStatus,
  resolveAgentVaultAddress,
} from "./vaultClient.js";

export const ERC20_TRANSFER_SELECTOR = id("transfer(address,uint256)").slice(0, 10);

const DESK_ABI = [
  "function tokenIn() view returns (address)",
  "function tokenOut() view returns (address)",
  "function owner() view returns (address)",
  "function operator() view returns (address)",
  "function fxrpOutPerUsdt0X18() view returns (uint256)",
  "function feeBps() view returns (uint256)",
  "function accountedTokenIn() view returns (uint256)",
  "function availableTokenIn() view returns (uint256)",
  "function quote(uint256 amountIn) view returns (uint256)",
  "function setRate(uint256 fxrpOutPerUsdt0X18_, uint256 feeBps_)",
  "function fulfill(address recipient, uint256 amountIn, uint256 minAmountOut) returns (uint256)",
];

const VAULT_EXEC_ABI = [
  "function execute(address target, bytes data, uint256 maxSpend, uint256 nonce_) returns (bytes)",
  "function setPolicy(uint256,uint256,uint256,uint256)",
  "function setAllowedTarget(address,bool)",
  "function setAllowedSelector(bytes4,bool)",
  "function token() view returns (address)",
  "function maxSpendPerTx() view returns (uint256)",
  "function rollingWindowBudget() view returns (uint256)",
  "function allowedTargets(address) view returns (bool)",
  "function allowedSelectors(bytes4) view returns (bool)",
  "function balance() view returns (uint256)",
  "function paused() view returns (bool)",
  "function executeNonce() view returns (uint256)",
];

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

export function resolveSwapDeskAddress(env: BeaconEnv = loadEnv()): string | null {
  const a = (env.BEACON_SWAP_DESK_ADDRESS || "").trim();
  return /^0x[a-fA-F0-9]{40}$/.test(a) ? a : null;
}

function executorKey(env: BeaconEnv): string | null {
  const k = (env.SETTLER_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY || env.DEPLOYMENT_PRIVATE_KEY || "").trim();
  return k.startsWith("0x") && k.length >= 66 ? k : k.length >= 64 ? `0x${k}` : null;
}

function ownerKey(env: BeaconEnv): string | null {
  return executorKey(env); // same funded owner/executor on Coston2 desk
}

/** FTSO XRP/USD → FXRP raw per USDT0 raw (1e18). USDT0≈$1. */
export async function ftsoFxrpOutPerUsdt0X18(env: BeaconEnv = loadEnv()): Promise<{
  rateX18: bigint;
  xrpUsd: number;
  feeBps: number;
}> {
  const snap = await readFtsoFeeds(env);
  const xrp = snap.feeds.find((f) => f.symbol === "XRP/USD")?.value ?? 0;
  if (!(xrp > 0)) throw new Error("FTSO XRP/USD unavailable — cannot quote Safe swap");
  // 1 USDT0 → (1/xrp) FXRP; both 6 decimals → same ratio in raw units
  const rateX18 = BigInt(Math.floor((1 / xrp) * 1e18));
  return { rateX18, xrpUsd: xrp, feeBps: 30 };
}

export type SafeSwapQuote =
  | {
      ok: true;
      mode: "beacon_safe";
      chainId: number;
      network: string;
      vault: string;
      desk: string;
      tokenIn: string;
      tokenOut: string;
      symbolIn: "MockUSDT0";
      symbolOut: "FXRP";
      amountIn: string;
      amountInDisplay: string;
      estimatedOut: string;
      amountOutMinimum: string;
      slippageBps: number;
      xrpUsd: number;
      feeBps: number;
      estimateBasis: string;
      quoteSource: "FTSO+SwapDesk";
      vaultBalanceDisplay: string;
      maxSpendPerTxDisplay: string;
      requiresChainSwitch: false;
      requiresMetaMask: false;
      honesty: string;
      docs: string[];
    }
  | { ok: false; error: string; honesty: string };

export async function prepareBeaconSafeSwap(
  params: {
    amountInUnits: string;
    recipient: string;
    slippageBps?: number;
    address?: string | null;
  },
  env: BeaconEnv = loadEnv(),
): Promise<SafeSwapQuote> {
  const deskAddr = resolveSwapDeskAddress(env);
  const vaultAddr = resolveAgentVaultAddress(env, params.address);
  const honesty =
    "Coston2 Safe swap via BeaconCoston2SwapDesk (FTSO-synced rate). SparkDEX bytecode is Mainnet-only — no MetaMask Mainnet switch for this path.";

  if (!deskAddr) {
    return {
      ok: false,
      error: "Beacon swap desk not configured (BEACON_SWAP_DESK_ADDRESS).",
      honesty,
    };
  }
  if (!vaultAddr) {
    return {
      ok: false,
      error: "Beacon Safe not configured. Deposit MockUSDT0 to the Safe first.",
      honesty,
    };
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(params.recipient)) {
    return { ok: false, error: "recipient wallet required", honesty };
  }

  const status = await readAgentVaultStatus({ address: vaultAddr, env });
  if (!status.configured) {
    return { ok: false, error: status.note, honesty };
  }

  const amountIn = parseUnits(params.amountInUnits, status.tokenDecimals);
  if (amountIn <= 0n) return { ok: false, error: "amount must be > 0", honesty };
  if (BigInt(status.balance) < amountIn) {
    return {
      ok: false,
      error: `Safe balance ${status.balanceDisplay} MockUSDT0 < ${params.amountInUnits}. Deposit more or reduce size.`,
      honesty,
    };
  }
  if (BigInt(status.maxSpendPerTx) === 0n || BigInt(status.rollingWindowBudget) === 0n) {
    return {
      ok: false,
      error:
        "Safe spend caps are 0. Owner must setPolicy (per-tx + rolling budget) before the agent can spend.",
      honesty,
    };
  }
  if (BigInt(status.maxSpendPerTx) < amountIn) {
    return {
      ok: false,
      error: `Amount exceeds maxSpendPerTx (${status.maxSpendPerTxDisplay}).`,
      honesty,
    };
  }
  if (status.paused) {
    return { ok: false, error: "Beacon Safe is paused.", honesty };
  }
  if (!status.sessionActive) {
    return { ok: false, error: "Beacon Safe session expired.", honesty };
  }

  const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
  const desk = new Contract(deskAddr, DESK_ABI, provider);
  const { rateX18, xrpUsd, feeBps } = await ftsoFxrpOutPerUsdt0X18(env);
  // Quote using live FTSO even if on-chain rate lags (execute will sync rate first).
  const gross = (amountIn * rateX18) / 10n ** 18n;
  const fee = (gross * BigInt(feeBps)) / 10_000n;
  const estimated = gross - fee;
  const slip = BigInt(params.slippageBps ?? 100);
  const minOut = estimated - (estimated * slip) / 10_000n;

  const fxrpBal = (await new Contract(await desk.tokenOut(), ERC20_ABI, provider).balanceOf(
    deskAddr,
  )) as bigint;
  if (fxrpBal < minOut) {
    return {
      ok: false,
      error: `Swap desk FXRP inventory too low (${formatUnits(fxrpBal, 6)}). Seed the desk.`,
      honesty,
    };
  }

  return {
    ok: true,
    mode: "beacon_safe",
    chainId: COSTON2_CHAIN_ID_VAULT,
    network: "Flare Testnet Coston2",
    vault: vaultAddr,
    desk: deskAddr,
    tokenIn: status.token,
    tokenOut: await resolveFxrpAddress(env),
    symbolIn: "MockUSDT0",
    symbolOut: "FXRP",
    amountIn: amountIn.toString(),
    amountInDisplay: params.amountInUnits,
    estimatedOut: formatUnits(estimated, 6),
    amountOutMinimum: minOut.toString(),
    slippageBps: Number(slip),
    xrpUsd,
    feeBps,
    estimateBasis: `FTSO XRP/USD ${xrpUsd.toPrecision(6)} → desk quote (fee ${feeBps} bps)`,
    quoteSource: "FTSO+SwapDesk",
    vaultBalanceDisplay: status.balanceDisplay,
    maxSpendPerTxDisplay: status.maxSpendPerTxDisplay,
    requiresChainSwitch: false,
    requiresMetaMask: false,
    honesty,
    docs: [
      "https://dev.flare.network/network/developer-tools?network=coston2",
      "https://dev.flare.network/fxrp/token-interactions/usdt0-fxrp-swap",
    ],
  };
}

export type SafeSwapExecuteResult =
  | {
      ok: true;
      spendHash: string;
      fulfillHash: string;
      amountIn: string;
      amountOut: string;
      recipient: string;
      explorerSpend: string;
      explorerFulfill: string;
      chainId: number;
      honesty: string;
    }
  | { ok: false; error: string; honesty: string };

/**
 * Ensure policy + allowlists so executor can transfer token from vault.
 * Uses owner key when caps are zero or transfer target/selector missing.
 */
export async function ensureSafeSwapPolicy(
  env: BeaconEnv = loadEnv(),
  addressOverride?: string | null,
): Promise<{ ready: boolean; note: string; txs: string[] }> {
  const vaultAddr = resolveAgentVaultAddress(env, addressOverride);
  const deskAddr = resolveSwapDeskAddress(env);
  const key = ownerKey(env);
  const txs: string[] = [];
  if (!vaultAddr || !deskAddr) {
    return { ready: false, note: "vault or desk address missing", txs };
  }
  if (!key) {
    return { ready: false, note: "owner/executor private key missing on API", txs };
  }

  const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
  const wallet = new Wallet(key, provider);
  const vault = new Contract(vaultAddr, VAULT_EXEC_ABI, wallet);
  const token = (await vault.token()) as string;

  const [maxTx, window] = await Promise.all([
    vault.maxSpendPerTx() as Promise<bigint>,
    vault.rollingWindowBudget() as Promise<bigint>,
  ]);

  if (maxTx === 0n || window === 0n) {
    // 10 per tx / 50 rolling / 7d window / no session expiry
    const tx = await vault.setPolicy(parseUnits("10", 6), parseUnits("50", 6), 7 * 24 * 3600, 0);
    await tx.wait();
    txs.push(tx.hash);
  }

  const targetOk = (await vault.allowedTargets(token)) as boolean;
  if (!targetOk) {
    const tx = await vault.setAllowedTarget(token, true);
    await tx.wait();
    txs.push(tx.hash);
  }

  const selOk = (await vault.allowedSelectors(ERC20_TRANSFER_SELECTOR)) as boolean;
  if (!selOk) {
    const tx = await vault.setAllowedSelector(ERC20_TRANSFER_SELECTOR, true);
    await tx.wait();
    txs.push(tx.hash);
  }

  // Sync desk rate from FTSO
  const desk = new Contract(deskAddr, DESK_ABI, wallet);
  const { rateX18, feeBps } = await ftsoFxrpOutPerUsdt0X18(env);
  const rateTx = await desk.setRate(rateX18, feeBps);
  await rateTx.wait();
  txs.push(rateTx.hash);

  return {
    ready: true,
    note: txs.length
      ? `Policy/allowlist/rate synced (${txs.length} tx).`
      : "Policy already ready; rate refreshed.",
    txs,
  };
}

export async function executeBeaconSafeSwap(
  params: {
    amountInUnits: string;
    recipient: string;
    slippageBps?: number;
    address?: string | null;
  },
  env: BeaconEnv = loadEnv(),
): Promise<SafeSwapExecuteResult> {
  const honesty =
    "Executed on Coston2 from Beacon Safe by the allowlisted executor — no MetaMask, no Mainnet switch.";

  const prep = await prepareBeaconSafeSwap(params, env);
  if (!prep.ok) return { ok: false, error: prep.error, honesty: prep.honesty };

  const key = executorKey(env);
  if (!key) {
    return { ok: false, error: "Executor key not configured on API (SETTLER/DEPLOYER).", honesty };
  }

  const ensured = await ensureSafeSwapPolicy(env);
  if (!ensured.ready) {
    return { ok: false, error: ensured.note, honesty };
  }

  // Re-quote after policy (caps may have changed)
  const quote = await prepareBeaconSafeSwap(params, env);
  if (!quote.ok) return { ok: false, error: quote.error, honesty: quote.honesty };

  const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
  const wallet = new Wallet(key, provider);
  const vault = new Contract(quote.vault, VAULT_EXEC_ABI, wallet);
  const desk = new Contract(quote.desk, DESK_ABI, wallet);
  const erc20 = new Interface(ERC20_ABI);

  const amountIn = BigInt(quote.amountIn);
  const transferData = erc20.encodeFunctionData("transfer", [quote.desk, amountIn]);
  const nonce = BigInt(Date.now());

  const spendTx = await vault.execute(quote.tokenIn, transferData, amountIn, nonce);
  const spendReceipt = await spendTx.wait();
  if (!spendReceipt || spendReceipt.status !== 1) {
    return { ok: false, error: "Safe execute(transfer) failed", honesty };
  }

  const fulfillTx = await desk.fulfill(params.recipient, amountIn, BigInt(quote.amountOutMinimum));
  const fulfillReceipt = await fulfillTx.wait();
  if (!fulfillReceipt || fulfillReceipt.status !== 1) {
    return {
      ok: false,
      error: `Desk fulfill failed after Safe spend ${spendTx.hash}. Manual recovery may be needed.`,
      honesty,
    };
  }

  // Parse amountOut from quote estimate (event parse optional)
  return {
    ok: true,
    spendHash: spendTx.hash,
    fulfillHash: fulfillTx.hash,
    amountIn: quote.amountInDisplay,
    amountOut: quote.estimatedOut,
    recipient: params.recipient,
    explorerSpend: `${COSTON2_EXPLORER_VAULT}/tx/${spendTx.hash}`,
    explorerFulfill: `${COSTON2_EXPLORER_VAULT}/tx/${fulfillTx.hash}`,
    chainId: COSTON2_CHAIN_ID_VAULT,
    honesty,
  };
}

export async function readSwapDeskStatus(env: BeaconEnv = loadEnv()): Promise<{
  configured: boolean;
  address: string | null;
  tokenIn?: string;
  tokenOut?: string;
  fxrpInventory?: string;
  availableTokenIn?: string;
  fxrpOutPerUsdt0X18?: string;
  feeBps?: number;
  operator?: string;
  honesty: string;
}> {
  const address = resolveSwapDeskAddress(env);
  const honesty =
    "Coston2 Beacon swap desk — FTSO-synced MockUSDT0→FXRP for Safe executor spends. Not SparkDEX.";
  if (!address) return { configured: false, address: null, honesty };
  const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
  const desk = new Contract(address, DESK_ABI, provider);
  const [tokenIn, tokenOut, rate, feeBps, available, operator] = await Promise.all([
    desk.tokenIn() as Promise<string>,
    desk.tokenOut() as Promise<string>,
    desk.fxrpOutPerUsdt0X18() as Promise<bigint>,
    desk.feeBps() as Promise<bigint>,
    desk.availableTokenIn() as Promise<bigint>,
    desk.operator() as Promise<string>,
  ]);
  const fxrpBal = (await new Contract(tokenOut, ERC20_ABI, provider).balanceOf(address)) as bigint;
  return {
    configured: true,
    address,
    tokenIn,
    tokenOut,
    fxrpInventory: formatUnits(fxrpBal, 6),
    availableTokenIn: formatUnits(available, 6),
    fxrpOutPerUsdt0X18: rate.toString(),
    feeBps: Number(feeBps),
    operator,
    honesty,
  };
}
