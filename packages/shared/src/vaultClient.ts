/**
 * BeaconAgentVault — prepaid agent spend under owner policy (Coston2).
 *
 * Distinct from Bound Work per-job escrow (`BeaconEscrow`): vault funds are a
 * pooled prepaid budget; escrow locks are outcome-priced job holds.
 */

import { Contract, Interface, JsonRpcProvider, formatUnits, parseUnits, ZeroAddress } from "ethers";
import { loadEnv, type BeaconEnv } from "./env.js";

export const COSTON2_CHAIN_ID_VAULT = 114;
export const COSTON2_EXPLORER_VAULT = "https://coston2.testnet.flarescan.com";

const VAULT_ABI = [
  "function token() view returns (address)",
  "function owner() view returns (address)",
  "function executor() view returns (address)",
  "function paused() view returns (bool)",
  "function balance() view returns (uint256)",
  "function maxSpendPerTx() view returns (uint256)",
  "function rollingWindowBudget() view returns (uint256)",
  "function rollingWindowSeconds() view returns (uint256)",
  "function sessionExpiresAt() view returns (uint256)",
  "function windowStart() view returns (uint256)",
  "function windowSpent() view returns (uint256)",
  "function executeNonce() view returns (uint256)",
  "function allowedTargets(address) view returns (bool)",
  "function allowedSelectors(bytes4) view returns (bool)",
  "function deposit(uint256 amount)",
  "function depositWithAuthorization(address from,uint256 amount,uint256 validAfter,uint256 validBefore,bytes32 nonce,bytes signature)",
  "function withdraw(uint256 amount)",
  "function setPolicy(uint256 maxSpendPerTx_,uint256 rollingWindowBudget_,uint256 rollingWindowSeconds_,uint256 sessionExpiresAt_)",
  "function setExecutor(address newExecutor)",
  "function setPaused(bool paused_)",
  "function setAllowedTarget(address target,bool allowed)",
  "function setAllowedSelector(bytes4 selector,bool allowed)",
  "event TargetAllowlistUpdated(address indexed target, bool allowed)",
  "event SelectorAllowlistUpdated(bytes4 indexed selector, bool allowed)",
];

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function approve(address spender,uint256 amount) returns (bool)",
];

/** User-facing product name; on-chain contract remains BeaconAgentVault. */
export const BEACON_SAFE_LABEL = "Beacon Safe";

const FACTORY_ABI = [
  "function safeOf(address owner) view returns (address)",
  "function hasSafe(address owner) view returns (bool)",
  "function predictSafe(address owner) view returns (address)",
  "function createSafe() returns (address)",
  "function token() view returns (address)",
  "function defaultExecutor() view returns (address)",
];

const DISTINCTION =
  "Beacon Safe is your personal prepaid budget under your policy. Agent Jobs lock from your Safe via vault.execute + BeaconEscrow.lockPrepaid (wallet EIP-3009 remains fallback).";

const NOT_CONFIGURED_NOTE =
  "Create your Beacon Safe (or set BEACON_SAFE_FACTORY_ADDRESS). No fake balances are shown.";

const SAFE_NOT_CREATED_NOTE =
  "Your Beacon Safe is not created yet. Create it to fund a personal prepaid budget under your policy.";

export type AgentVaultPrepAction =
  | "deposit"
  | "withdraw"
  | "setPolicy"
  | "setPaused"
  | "setExecutor"
  | "createSafe";

export interface AgentVaultPrep {
  action: AgentVaultPrepAction;
  chainId: number;
  network: string;
  to: string;
  data: string;
  approveTo?: string;
  approveData?: string;
  /** EIP-3009 deposit fields (MockUSDT0 has no approve/transferFrom on Coston2). */
  token?: string;
  amount?: string;
  mode?: "eip3009" | "approve";
  value: "0";
  ownerOnly: boolean;
  note: string;
  honesty: string;
}

export type AgentVaultStatus =
  | {
      configured: false;
      readiness: "Deploy Beacon Safe on Coston2" | "Create your Beacon Safe";
      address: null;
      network: "coston2";
      chainId: number;
      note: string;
      honesty: string;
      distinction: string;
      code?: "SAFE_NOT_CREATED" | "SAFE_FACTORY_MISSING" | "SAFE_NOT_CONFIGURED";
      factory?: string | null;
      wallet?: string | null;
      source?: "none" | "legacy" | "personal" | "override";
    }
  | {
      configured: true;
      address: string;
      network: "coston2";
      chainId: number;
      token: string;
      tokenSymbol: string;
      tokenDecimals: number;
      balance: string;
      balanceDisplay: string;
      owner: string;
      executor: string;
      paused: boolean;
      maxSpendPerTx: string;
      maxSpendPerTxDisplay: string;
      rollingWindowBudget: string;
      rollingWindowBudgetDisplay: string;
      rollingWindowSeconds: string;
      windowStart: string;
      windowSpent: string;
      windowSpentDisplay: string;
      windowRemainingDisplay: string;
      windowResetsAt: number;
      windowResetsAtIso: string | null;
      sessionExpiresAt: number;
      sessionExpiresAtIso: string | null;
      sessionActive: boolean;
      executeNonce: string;
      allowlists: {
        targets: Array<{ address: string; allowed: boolean }>;
        selectors: Array<{ selector: string; allowed: boolean }>;
        note: string;
      };
      explorer: string;
      honesty: string;
      distinction: string;
      factory?: string | null;
      wallet?: string | null;
      source?: "none" | "legacy" | "personal" | "override";
      isOwner?: boolean;
    };

/** Internal type aliases — UI copy uses Beacon Safe; contract stays BeaconAgentVault. */
export type BeaconSafeStatus = AgentVaultStatus;
export type BeaconSafePrep = AgentVaultPrep;

function isAddress(value: string | undefined | null): value is string {
  return Boolean(value && /^0x[a-fA-F0-9]{40}$/.test(value));
}

export function resolveSafeFactoryAddress(env: BeaconEnv = loadEnv()): string | null {
  const candidate = (env.BEACON_SAFE_FACTORY_ADDRESS || "").trim();
  return isAddress(candidate) ? candidate : null;
}

/** Legacy shared vault only — prefer resolveVaultForWallet for product paths. */
export function resolveAgentVaultAddress(
  env: BeaconEnv = loadEnv(),
  override?: string | null,
): string | null {
  const candidate = (override || env.BEACON_AGENT_VAULT_ADDRESS || "").trim();
  return isAddress(candidate) ? candidate : null;
}

/** On-chain lookup: wallet → personal Safe (address(0) if none). */
export async function lookupPersonalSafe(
  ownerWallet: string,
  env: BeaconEnv = loadEnv(),
): Promise<string | null> {
  if (!isAddress(ownerWallet)) return null;
  const factoryAddr = resolveSafeFactoryAddress(env);
  if (!factoryAddr) return null;
  const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
  const factory = new Contract(factoryAddr, FACTORY_ABI, provider);
  const safe = (await factory.safeOf(ownerWallet)) as string;
  if (!isAddress(safe) || safe.toLowerCase() === ZeroAddress.toLowerCase()) return null;
  return safe;
}

/**
 * Resolve which vault to use for a request.
 * Priority: explicit address override → personal Safe for wallet → legacy shared env vault.
 */
export async function resolveVaultForWallet(opts: {
  wallet?: string | null;
  address?: string | null;
  env?: BeaconEnv;
  /** If true, never fall back to legacy shared vault. */
  personalOnly?: boolean;
}): Promise<{
  address: string | null;
  source: "override" | "personal" | "legacy" | "none";
  factory: string | null;
  wallet: string | null;
}> {
  const env = opts.env ?? loadEnv();
  const factory = resolveSafeFactoryAddress(env);
  const wallet = isAddress(opts.wallet) ? opts.wallet : null;

  if (isAddress(opts.address)) {
    return { address: opts.address, source: "override", factory, wallet };
  }

  if (wallet) {
    const personal = await lookupPersonalSafe(wallet, env);
    if (personal) return { address: personal, source: "personal", factory, wallet };
    if (opts.personalOnly) return { address: null, source: "none", factory, wallet };
  }

  const legacy = resolveAgentVaultAddress(env);
  if (legacy && !opts.personalOnly) {
    return { address: legacy, source: "legacy", factory, wallet };
  }

  return { address: null, source: "none", factory, wallet };
}

export async function prepareCreateSafe(
  params: { wallet: string },
  env: BeaconEnv = loadEnv(),
): Promise<AgentVaultPrep & { predictedSafe?: string; code?: string }> {
  const factory = resolveSafeFactoryAddress(env);
  if (!factory) {
    throw new Error("SAFE_FACTORY_MISSING: Deploy BeaconSafeFactory and set BEACON_SAFE_FACTORY_ADDRESS.");
  }
  if (!isAddress(params.wallet)) throw new Error("wallet required");

  const existing = await lookupPersonalSafe(params.wallet, env);
  if (existing) {
    throw Object.assign(new Error(`SAFE_EXISTS: You already have a Beacon Safe at ${existing}.`), {
      code: "SAFE_EXISTS",
      safe: existing,
    });
  }

  const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
  const factoryContract = new Contract(factory, FACTORY_ABI, provider);
  const predicted = (await factoryContract.predictSafe(params.wallet).catch(() => null)) as string | null;
  const iface = new Interface(FACTORY_ABI);

  return {
    action: "createSafe",
    chainId: COSTON2_CHAIN_ID_VAULT,
    network: "Flare Testnet Coston2",
    to: factory,
    data: iface.encodeFunctionData("createSafe", []),
    value: "0",
    ownerOnly: false,
    note: "Create your personal Beacon Safe. You become owner; Beacon executor can spend only under your policy.",
    honesty: DISTINCTION,
    predictedSafe: isAddress(predicted) ? predicted : undefined,
    code: "CREATE_SAFE",
  };
}

async function readAllowlistSummary(
  vault: Contract,
  provider: JsonRpcProvider,
): Promise<{
  targets: Array<{ address: string; allowed: boolean }>;
  selectors: Array<{ selector: string; allowed: boolean }>;
  note: string;
}> {
  try {
    const latest = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latest - 80_000);
    const [targetLogs, selectorLogs] = await Promise.all([
      vault.queryFilter(vault.filters.TargetAllowlistUpdated(), fromBlock, latest),
      vault.queryFilter(vault.filters.SelectorAllowlistUpdated(), fromBlock, latest),
    ]);

    const targets = new Map<string, boolean>();
    for (const log of targetLogs) {
      const args = (log as { args?: { target?: string; allowed?: boolean } }).args;
      if (args?.target) targets.set(String(args.target).toLowerCase(), Boolean(args.allowed));
    }
    const selectors = new Map<string, boolean>();
    for (const log of selectorLogs) {
      const args = (log as { args?: { selector?: string; allowed?: boolean } }).args;
      if (args?.selector != null) {
        const sel = String(args.selector);
        selectors.set(sel.startsWith("0x") ? sel.slice(0, 10).toLowerCase() : `0x${sel}`.slice(0, 10), Boolean(args.allowed));
      }
    }

    return {
      targets: [...targets.entries()]
        .filter(([, allowed]) => allowed)
        .map(([address, allowed]) => ({ address, allowed })),
      selectors: [...selectors.entries()]
        .filter(([, allowed]) => allowed)
        .map(([selector, allowed]) => ({ selector, allowed })),
      note:
        "Allowlists reconstructed from recent TargetAllowlistUpdated / SelectorAllowlistUpdated events (not a full on-chain enumeration).",
    };
  } catch {
    return {
      targets: [],
      selectors: [],
      note: "Allowlist summary unavailable (RPC event query failed). Owner sets targets/selectors on-chain.",
    };
  }
}

export async function readAgentVaultStatus(opts?: {
  address?: string | null;
  wallet?: string | null;
  /** Prefer personal Safe only — do not show legacy shared vault balances. */
  personalOnly?: boolean;
  env?: BeaconEnv;
}): Promise<AgentVaultStatus> {
  const env = opts?.env ?? loadEnv();
  const factory = resolveSafeFactoryAddress(env);
  const wallet = isAddress(opts?.wallet) ? opts!.wallet! : null;

  const resolved = await resolveVaultForWallet({
    wallet,
    address: opts?.address,
    env,
    personalOnly: opts?.personalOnly ?? Boolean(factory && wallet),
  });

  if (!resolved.address) {
    if (factory && wallet) {
      return {
        configured: false,
        readiness: "Create your Beacon Safe",
        address: null,
        network: "coston2",
        chainId: COSTON2_CHAIN_ID_VAULT,
        note: SAFE_NOT_CREATED_NOTE,
        honesty: "No personal Safe for this wallet. Balances are not invented.",
        distinction: DISTINCTION,
        code: "SAFE_NOT_CREATED",
        factory,
        wallet,
        source: "none",
      };
    }
    return {
      configured: false,
      readiness: "Deploy Beacon Safe on Coston2",
      address: null,
      network: "coston2",
      chainId: COSTON2_CHAIN_ID_VAULT,
      note: factory ? NOT_CONFIGURED_NOTE : "Set BEACON_SAFE_FACTORY_ADDRESS after deploying BeaconSafeFactory.",
      honesty: "Beacon Safe address unset: readiness only, no invented balances.",
      distinction: DISTINCTION,
      code: factory ? "SAFE_NOT_CONFIGURED" : "SAFE_FACTORY_MISSING",
      factory,
      wallet,
      source: "none",
    };
  }

  const address = resolved.address;
  const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
  const vault = new Contract(address, VAULT_ABI, provider);
  const tokenAddr = (await vault.token()) as string;
  const token = new Contract(tokenAddr, ERC20_ABI, provider);

  const [
    symbol,
    decimals,
    balance,
    owner,
    executor,
    paused,
    maxSpendPerTx,
    rollingWindowBudget,
    rollingWindowSeconds,
    sessionExpiresAt,
    windowStart,
    windowSpent,
    executeNonce,
  ] = await Promise.all([
    token.symbol().then(String).catch(() => "USDT0"),
    token.decimals().then(Number).catch(() => 6),
    vault.balance() as Promise<bigint>,
    vault.owner() as Promise<string>,
    vault.executor() as Promise<string>,
    vault.paused() as Promise<boolean>,
    vault.maxSpendPerTx() as Promise<bigint>,
    vault.rollingWindowBudget() as Promise<bigint>,
    vault.rollingWindowSeconds() as Promise<bigint>,
    vault.sessionExpiresAt() as Promise<bigint>,
    vault.windowStart() as Promise<bigint>,
    vault.windowSpent() as Promise<bigint>,
    vault.executeNonce() as Promise<bigint>,
  ]);

  const expires = Number(sessionExpiresAt);
  const nowSec = Math.floor(Date.now() / 1000);
  const sessionActive = expires === 0 || nowSec < expires;
  const allowlists = await readAllowlistSummary(vault, provider);
  const windowSecs = Number(rollingWindowSeconds);
  const startSec = Number(windowStart);
  const resetsAtSec =
    windowSecs > 0 && startSec > 0 ? startSec + windowSecs : 0;
  const remainingRaw =
    rollingWindowBudget > windowSpent ? rollingWindowBudget - windowSpent : 0n;

  return {
    configured: true,
    address,
    network: "coston2",
    chainId: COSTON2_CHAIN_ID_VAULT,
    token: tokenAddr,
    tokenSymbol: symbol,
    tokenDecimals: decimals,
    balance: balance.toString(),
    balanceDisplay: formatUnits(balance, decimals),
    owner,
    executor,
    paused: Boolean(paused),
    maxSpendPerTx: maxSpendPerTx.toString(),
    maxSpendPerTxDisplay: formatUnits(maxSpendPerTx, decimals),
    rollingWindowBudget: rollingWindowBudget.toString(),
    rollingWindowBudgetDisplay: formatUnits(rollingWindowBudget, decimals),
    rollingWindowSeconds: rollingWindowSeconds.toString(),
    windowStart: windowStart.toString(),
    windowRemainingDisplay: formatUnits(remainingRaw, decimals),
    windowResetsAt: resetsAtSec,
    windowResetsAtIso: resetsAtSec > 0 ? new Date(resetsAtSec * 1000).toISOString() : null,
    windowSpent: windowSpent.toString(),
    windowSpentDisplay: formatUnits(windowSpent, decimals),
    sessionExpiresAt: expires,
    sessionExpiresAtIso: expires > 0 ? new Date(expires * 1000).toISOString() : null,
    sessionActive,
    executeNonce: executeNonce.toString(),
    allowlists,
    explorer: `${COSTON2_EXPLORER_VAULT}/address/${address}`,
    honesty: "On-chain BeaconAgentVault reads only. No invented balances or APY.",
    distinction: DISTINCTION,
    factory,
    wallet,
    source: resolved.source,
    isOwner: wallet ? wallet.toLowerCase() === String(owner).toLowerCase() : undefined,
  };
}

async function resolveVaultAndDecimals(
  env: BeaconEnv,
  addressOverride?: string | null,
): Promise<{ address: string; token: string; decimals: number; iface: Interface }> {
  const address = resolveAgentVaultAddress(env, addressOverride);
  if (!address) {
    throw new Error("BeaconAgentVault not configured. Deploy on Coston2 and set BEACON_AGENT_VAULT_ADDRESS.");
  }
  const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
  const vault = new Contract(address, VAULT_ABI, provider);
  const token = (await vault.token()) as string;
  const decimals = Number(await new Contract(token, ERC20_ABI, provider).decimals().catch(() => 6));
  return { address, token, decimals, iface: new Interface(VAULT_ABI) };
}

export async function prepareAgentVaultDeposit(
  params: { amountUsdt0: string; address?: string | null },
  env: BeaconEnv = loadEnv(),
): Promise<AgentVaultPrep> {
  const { address, token, decimals } = await resolveVaultAndDecimals(env, params.address);
  const amount = parseUnits(params.amountUsdt0, decimals);
  if (amount <= 0n) throw new Error("amount must be > 0");
  // Coston2 MockUSDT0 is EIP-3009 only (no approve/transferFrom). Deposit uses authorization.
  return {
    action: "deposit",
    chainId: COSTON2_CHAIN_ID_VAULT,
    network: "Flare Testnet Coston2",
    to: address,
    data: "0x",
    token,
    amount: amount.toString(),
    mode: "eip3009",
    value: "0",
    ownerOnly: false,
    note: "Any wallet: sign EIP-3009 TransferWithAuthorization, then Beacon Safe pulls USDT0.",
    honesty: DISTINCTION,
  };
}

export async function prepareAgentVaultWithdraw(
  params: { amountUsdt0: string; address?: string | null },
  env: BeaconEnv = loadEnv(),
): Promise<AgentVaultPrep> {
  const { address, decimals, iface } = await resolveVaultAndDecimals(env, params.address);
  const amount = parseUnits(params.amountUsdt0, decimals);
  if (amount <= 0n) throw new Error("amount must be > 0");
  return {
    action: "withdraw",
    chainId: COSTON2_CHAIN_ID_VAULT,
    network: "Flare Testnet Coston2",
    to: address,
    data: iface.encodeFunctionData("withdraw", [amount]),
    value: "0",
    ownerOnly: true,
    note: "Owner: withdraw pooled tokens (allowed while paused).",
    honesty: DISTINCTION,
  };
}

export async function prepareAgentVaultSetPolicy(
  params: {
    maxSpendPerTxUsdt0: string;
    rollingWindowBudgetUsdt0: string;
    rollingWindowSeconds: number;
    sessionExpiresAt: number;
    address?: string | null;
  },
  env: BeaconEnv = loadEnv(),
): Promise<AgentVaultPrep> {
  const { address, decimals, iface } = await resolveVaultAndDecimals(env, params.address);
  if (!(params.rollingWindowSeconds > 0)) throw new Error("rollingWindowSeconds must be > 0");
  const maxSpend = parseUnits(params.maxSpendPerTxUsdt0, decimals);
  const windowBudget = parseUnits(params.rollingWindowBudgetUsdt0, decimals);
  return {
    action: "setPolicy",
    chainId: COSTON2_CHAIN_ID_VAULT,
    network: "Flare Testnet Coston2",
    to: address,
    data: iface.encodeFunctionData("setPolicy", [
      maxSpend,
      windowBudget,
      BigInt(params.rollingWindowSeconds),
      BigInt(params.sessionExpiresAt),
    ]),
    value: "0",
    ownerOnly: true,
    note: "Owner: update per-tx / rolling window budgets and session expiry. Resets rolling window.",
    honesty: DISTINCTION,
  };
}

export async function prepareAgentVaultSetPaused(
  params: { paused: boolean; address?: string | null },
  env: BeaconEnv = loadEnv(),
): Promise<AgentVaultPrep> {
  const { address, iface } = await resolveVaultAndDecimals(env, params.address);
  return {
    action: "setPaused",
    chainId: COSTON2_CHAIN_ID_VAULT,
    network: "Flare Testnet Coston2",
    to: address,
    data: iface.encodeFunctionData("setPaused", [params.paused]),
    value: "0",
    ownerOnly: true,
    note: params.paused ? "Owner: pause executor spend." : "Owner: unpause executor spend.",
    honesty: DISTINCTION,
  };
}

export async function prepareAgentVaultSetExecutor(
  params: { executor?: string | null; revoke?: boolean; address?: string | null },
  env: BeaconEnv = loadEnv(),
): Promise<AgentVaultPrep> {
  const { address, iface } = await resolveVaultAndDecimals(env, params.address);
  const next = params.revoke ? ZeroAddress : (params.executor || "").trim();
  if (!params.revoke && !isAddress(next)) throw new Error("executor must be a valid address (or revoke)");
  return {
    action: "setExecutor",
    chainId: COSTON2_CHAIN_ID_VAULT,
    network: "Flare Testnet Coston2",
    to: address,
    data: iface.encodeFunctionData("setExecutor", [next]),
    value: "0",
    ownerOnly: true,
    note: params.revoke
      ? "Owner: revoke executor (set to address(0))."
      : "Owner: rotate vault executor.",
    honesty: DISTINCTION,
  };
}
