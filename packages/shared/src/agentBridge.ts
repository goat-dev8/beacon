/**
 * Beacon Agent OFT bridge — executor signs FXRP approve + LayerZero send on Coston2.
 *
 * Why MetaMask showed up before: Beacon Safe holds USDT0; OFT needs FXRP +
 * native C2FLR msg.value. Safe cannot pay LZ fees. This path uses the allowlisted
 * executor EOA (same key as Safe spend) when it holds FXRP + C2FLR — no MetaMask.
 *
 * Optional hop: spend USDT0 from Safe → desk FXRP to executor → then OFT send.
 */

import { Contract, JsonRpcProvider, Wallet, formatEther, formatUnits, parseUnits } from "ethers";
import { loadEnv, type BeaconEnv } from "./env.js";
import {
  COSTON2_FXRP_OFT_ADAPTER,
  prepareFxrpOftBridge,
  discoverFxrpOftRoutes,
  resolveOftRouteByChain,
} from "./oftBridge.js";
import { resolveFxrpAddress } from "./ftso.js";
import { executeBeaconSafeSwap, prepareBeaconSafeSwap, resolveSwapDeskAddress } from "./safeSwap.js";
import { resolveAgentVaultAddress, readAgentVaultStatus } from "./vaultClient.js";

const COSTON2_EXPLORER = "https://coston2-explorer.flare.network";

function executorKey(env: BeaconEnv): string | null {
  const k = (env.SETTLER_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY || env.DEPLOYMENT_PRIVATE_KEY || "").trim();
  return k.startsWith("0x") && k.length >= 66 ? k : k.length >= 64 ? `0x${k}` : null;
}

function executorAddress(env: BeaconEnv): string | null {
  const key = executorKey(env);
  if (!key) return null;
  return new Wallet(key).address;
}

export type AgentBridgeQuote =
  | {
      ok: true;
      mode: "beacon_agent";
      chainId: 114;
      network: "Flare Testnet Coston2";
      amountDisplay: string;
      destination: string;
      dstEid: number;
      peer: string;
      nativeFee: string;
      nativeFeeDisplay: string;
      approveTo: string;
      approveData: string;
      sendTo: string;
      sendData: string;
      fxrp: string;
      oftAdapter: string;
      executor: string;
      executorFxrpDisplay: string;
      executorC2FlrDisplay: string;
      fromSafe: boolean;
      safeSpendUsdt0?: string;
      requiresMetaMask: false;
      requiresChainSwitch: false;
      honesty: string;
      docs: string[];
      layerZeroScanBase: string;
      deliveryHint: string;
    }
  | { ok: false; error: string; honesty: string };

export async function prepareBeaconAgentBridge(
  params: {
    amountFxrpUnits: string;
    recipient: string;
    destination: string;
    /** If true (default when Safe funded), spend USDT0→FXRP to executor first. */
    preferSafeFunding?: boolean;
  },
  env: BeaconEnv = loadEnv(),
): Promise<AgentBridgeQuote> {
  const honesty =
    "Beacon Agent OFT: executor signs on Coston2 (FXRP + C2FLR fee). Beacon Safe holds USDT0 — LZ msg.value cannot come from the Safe token vault. No MetaMask when executor is funded.";

  const key = executorKey(env);
  const exec = executorAddress(env);
  if (!key || !exec) {
    return { ok: false, error: "Executor key not configured on API.", honesty };
  }
  if (!/^0x[a-fA-F0-9]{40}$/i.test(params.recipient)) {
    return { ok: false, error: "recipient required", honesty };
  }

  const discovered = await discoverFxrpOftRoutes(env);
  const route = resolveOftRouteByChain(params.destination, discovered.routes);
  if (!route?.live) {
    return {
      ok: false,
      error: `No live OFT peer for ${params.destination}.`,
      honesty,
    };
  }

  const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
  const fxrpAddr = await resolveFxrpAddress(env);
  const fxrp = new Contract(fxrpAddr, ["function balanceOf(address) view returns (uint256)"], provider);
  const amount = parseUnits(params.amountFxrpUnits, 6);
  let execFxrp = (await fxrp.balanceOf(exec)) as bigint;
  const c2 = await provider.getBalance(exec);

  let fromSafe = false;
  let safeSpendUsdt0: string | undefined;

  const vaultAddr = resolveAgentVaultAddress(env);
  const deskAddr = resolveSwapDeskAddress(env);
  const preferSafe = params.preferSafeFunding !== false && Boolean(vaultAddr && deskAddr);

  if (execFxrp < amount && preferSafe) {
    // Rough 1:1 USDT0→FXRP sizing with buffer for fee/slippage
    const needUsdt0 = (Number(params.amountFxrpUnits) * 1.05).toFixed(4);
    const safeQ = await prepareBeaconSafeSwap(
      { amountInUnits: needUsdt0, recipient: exec },
      env,
    );
    if (safeQ.ok) {
      fromSafe = true;
      safeSpendUsdt0 = needUsdt0;
    } else if (execFxrp < amount) {
      return {
        ok: false,
        error: `Agent FXRP ${formatUnits(execFxrp, 6)} < ${params.amountFxrpUnits}. Safe funding also unavailable: ${safeQ.error}`,
        honesty,
      };
    }
  } else if (execFxrp < amount) {
    return {
      ok: false,
      error: `Agent executor FXRP ${formatUnits(execFxrp, 6)} < ${params.amountFxrpUnits}. Fund executor or deposit Safe for auto top-up.`,
      honesty,
    };
  }

  // Quote OFT (recipient on dest = user wallet)
  const prep = await prepareFxrpOftBridge(
    { amountFxrpUnits: params.amountFxrpUnits, recipient: params.recipient, dstEid: route.eid },
    env,
  );

  const fee = BigInt(prep.nativeFee);
  if (c2 < fee + parseUnits("0.5", 18)) {
    return {
      ok: false,
      error: `Executor C2FLR ${formatEther(c2)} too low for fee ${prep.nativeFeeDisplay}.`,
      honesty,
    };
  }

  return {
    ok: true,
    mode: "beacon_agent",
    chainId: 114,
    network: "Flare Testnet Coston2",
    amountDisplay: params.amountFxrpUnits,
    destination: route.chain,
    dstEid: route.eid,
    peer: route.peer,
    nativeFee: prep.nativeFee,
    nativeFeeDisplay: prep.nativeFeeDisplay,
    approveTo: prep.approveTo,
    approveData: prep.approveData,
    sendTo: prep.sendTo,
    sendData: prep.sendData,
    fxrp: prep.fxrp,
    oftAdapter: prep.oftAdapter,
    executor: exec,
    executorFxrpDisplay: formatUnits(execFxrp, 6),
    executorC2FlrDisplay: Number(formatEther(c2)).toFixed(4),
    fromSafe,
    safeSpendUsdt0,
    requiresMetaMask: false,
    requiresChainSwitch: false,
    honesty,
    docs: prep.docs,
    layerZeroScanBase: prep.layerZeroScanBase,
    deliveryHint: prep.deliveryHint,
  };
}

export type AgentBridgeExecuteResult =
  | {
      ok: true;
      approveHash: string | null;
      sendHash: string;
      safeSwapSpendHash?: string;
      safeSwapFulfillHash?: string;
      explorerSend: string;
      layerZeroScanUrl: string;
      amountDisplay: string;
      destination: string;
      dstEid: number;
      peer: string;
      honesty: string;
    }
  | { ok: false; error: string; honesty: string };

export async function executeBeaconAgentBridge(
  params: {
    amountFxrpUnits: string;
    recipient: string;
    destination: string;
    preferSafeFunding?: boolean;
  },
  env: BeaconEnv = loadEnv(),
): Promise<AgentBridgeExecuteResult> {
  const honesty =
    "Executed by Beacon agent executor on Coston2 — no MetaMask. LayerZero delivery is tracked separately.";

  const quote = await prepareBeaconAgentBridge(params, env);
  if (!quote.ok) return { ok: false, error: quote.error, honesty: quote.honesty };

  const key = executorKey(env);
  if (!key) return { ok: false, error: "Executor key missing", honesty };

  let safeSwapSpendHash: string | undefined;
  let safeSwapFulfillHash: string | undefined;

  if (quote.fromSafe && quote.safeSpendUsdt0) {
    const swap = await executeBeaconSafeSwap(
      { amountInUnits: quote.safeSpendUsdt0, recipient: quote.executor },
      env,
    );
    if (!swap.ok) {
      return { ok: false, error: `Safe→FXRP top-up failed: ${swap.error}`, honesty };
    }
    safeSwapSpendHash = swap.spendHash;
    safeSwapFulfillHash = swap.fulfillHash;
  }

  const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
  const wallet = new Wallet(key, provider);

  // Fresh prepare after possible Safe top-up (nonce/fee may change)
  const prep = await prepareFxrpOftBridge(
    {
      amountFxrpUnits: params.amountFxrpUnits,
      recipient: params.recipient,
      dstEid: quote.dstEid,
    },
    env,
  );

  const fxrp = new Contract(
    prep.fxrp,
    [
      "function allowance(address owner, address spender) view returns (uint256)",
      "function approve(address spender, uint256 amount) returns (bool)",
      "function balanceOf(address) view returns (uint256)",
    ],
    wallet,
  );

  const amountLD = BigInt(prep.amountLD);
  const bal = (await fxrp.balanceOf(wallet.address)) as bigint;
  if (bal < amountLD) {
    return {
      ok: false,
      error: `Executor FXRP ${formatUnits(bal, 6)} < ${params.amountFxrpUnits} after top-up.`,
      honesty,
    };
  }

  let approveHash: string | null = null;
  const allowance = (await fxrp.allowance(wallet.address, COSTON2_FXRP_OFT_ADAPTER)) as bigint;
  if (allowance < amountLD) {
    const txA = await fxrp.approve(COSTON2_FXRP_OFT_ADAPTER, amountLD);
    await txA.wait();
    approveHash = txA.hash;
  }

  const sendTx = await wallet.sendTransaction({
    to: prep.sendTo,
    data: prep.sendData,
    value: BigInt(prep.nativeFee),
  });
  const receipt = await sendTx.wait();
  if (!receipt || receipt.status !== 1) {
    return { ok: false, error: "OFT send failed", honesty };
  }

  return {
    ok: true,
    approveHash,
    sendHash: sendTx.hash,
    safeSwapSpendHash,
    safeSwapFulfillHash,
    explorerSend: `${COSTON2_EXPLORER}/tx/${sendTx.hash}`,
    layerZeroScanUrl: `${prep.layerZeroScanBase}${sendTx.hash}`,
    amountDisplay: params.amountFxrpUnits,
    destination: quote.destination,
    dstEid: quote.dstEid,
    peer: quote.peer,
    honesty,
  };
}

export async function agentBridgeReadiness(env: BeaconEnv = loadEnv()): Promise<{
  executor: string | null;
  fxrp: string;
  c2flr: string;
  safeConfigured: boolean;
  safeBalance: string;
  honesty: string;
}> {
  const exec = executorAddress(env);
  const honesty =
    "Agent bridge readiness: executor FXRP + C2FLR for OFT; Safe USDT0 can top up FXRP via desk.";
  if (!exec) {
    return { executor: null, fxrp: "0", c2flr: "0", safeConfigured: false, safeBalance: "0", honesty };
  }
  const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
  const fxrpAddr = await resolveFxrpAddress(env);
  const fxrpBal = await new Contract(fxrpAddr, ["function balanceOf(address) view returns (uint256)"], provider).balanceOf(
    exec,
  );
  const vault = await readAgentVaultStatus({ env }).catch(() => null);
  return {
    executor: exec,
    fxrp: formatUnits(fxrpBal as bigint, 6),
    c2flr: formatEther(await provider.getBalance(exec)),
    safeConfigured: Boolean(vault && vault.configured),
    safeBalance: vault && vault.configured ? vault.balanceDisplay : "0",
    honesty,
  };
}
