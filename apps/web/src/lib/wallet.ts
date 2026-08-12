import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  getAddress,
  http,
  parseAbi,
  sha256,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { CONTRACTS, NETWORK } from "./chain";

const coston2 = {
  id: NETWORK.chainId,
  name: NETWORK.name,
  nativeCurrency: { name: "C2FLR", symbol: "C2FLR", decimals: 18 },
  rpcUrls: { default: { http: [NETWORK.rpc] } },
} as const;

export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

function asEip1193(value: unknown): Eip1193Provider | undefined {
  if (
    value &&
    typeof value === "object" &&
    "request" in value &&
    typeof (value as Eip1193Provider).request === "function"
  ) {
    return value as Eip1193Provider;
  }
  return undefined;
}

/** Active provider from Reown / wagmi connector (injected or WalletConnect). */
let activeEip1193: Eip1193Provider | undefined;

export function setEip1193Provider(provider: Eip1193Provider | null | undefined): void {
  activeEip1193 = provider ?? undefined;
}

export function getEip1193Provider(): Eip1193Provider | undefined {
  if (activeEip1193) return activeEip1193;
  if (typeof window === "undefined") return undefined;
  return asEip1193((window as Window & { ethereum?: unknown }).ethereum);
}

/**
 * Reown AppKit is always available — users can pick MetaMask, Rabby, WC, etc.
 * Kept for call sites that previously gated on injected `window.ethereum`.
 */
export function hasEvmProvider(): boolean {
  return typeof window !== "undefined";
}

export async function ensureCoston2Network(): Promise<void> {
  await ensureChain({
    chainId: NETWORK.chainId,
    name: NETWORK.name,
    rpc: NETWORK.rpc,
    explorer: NETWORK.explorer,
    nativeName: "C2FLR",
    nativeSymbol: "C2FLR",
  });
}

/**
 * Intentionally disabled for Beacon Summer Signal.
 * Product stays on Flare Testnet Coston2 (114) only — never switch MetaMask to Mainnet.
 */
export async function ensureFlareMainnet(): Promise<void> {
  throw new Error(
    "Beacon stays on Flare Testnet Coston2 (chain 114). Mainnet switch is disabled.",
  );
}

async function ensureChain(params: {
  chainId: number;
  name: string;
  rpc: string;
  explorer: string;
  nativeName: string;
  nativeSymbol: string;
}): Promise<void> {
  const eth = getEip1193Provider();
  if (!eth) throw new Error("No wallet connected. Tap Connect and pick a wallet.");
  const targetHex = `0x${params.chainId.toString(16)}` as Hex;
  const chainIdHex = (await eth.request({ method: "eth_chainId" })) as Hex;
  if (parseInt(chainIdHex, 16) === params.chainId) return;

  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: targetHex }],
    });
    return;
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err ? Number((err as { code: number }).code) : undefined;
    if (code !== 4902 && code !== -32603) {
      throw new Error(`Switch your wallet to ${params.name} (chain ${params.chainId}).`);
    }
  }

  await eth.request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: targetHex,
        chainName: params.name,
        nativeCurrency: { name: params.nativeName, symbol: params.nativeSymbol, decimals: 18 },
        rpcUrls: [params.rpc],
        blockExplorerUrls: [params.explorer],
      },
    ],
  });
  await eth.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: targetHex }],
  });
}

/**
 * Connect via injected provider when already available.
 * Prefer `useProductWallet().connect()` (Reown modal) for multi-wallet UX.
 */
export async function connectEvmWallet(): Promise<Address> {
  const eth = getEip1193Provider();
  if (!eth) throw new Error("No wallet connected. Tap Connect and pick a wallet.");
  const accounts = (await eth.request({
    method: "eth_requestAccounts",
  })) as string[];
  if (!accounts[0]) throw new Error("Wallet returned no account.");
  await ensureCoston2Network();
  const addr = getAddress(accounts[0]);
  try {
    localStorage.setItem("beacon.wallet", addr);
  } catch {
    /* ignore */
  }
  return addr;
}

/** Soft restore — eth_accounts (no popup) if previously connected. */
export async function tryRestoreWallet(): Promise<Address | null> {
  const eth = getEip1193Provider();
  if (!eth) {
    try {
      const cached = localStorage.getItem("beacon.wallet");
      return cached && /^0x[a-fA-F0-9]{40}$/.test(cached) ? getAddress(cached) : null;
    } catch {
      return null;
    }
  }
  try {
    const accounts = (await eth.request({ method: "eth_accounts" })) as string[];
    if (!accounts[0]) {
      const cached = localStorage.getItem("beacon.wallet");
      return cached && /^0x[a-fA-F0-9]{40}$/.test(cached) ? getAddress(cached) : null;
    }
    await ensureCoston2Network();
    const addr = getAddress(accounts[0]);
    localStorage.setItem("beacon.wallet", addr);
    return addr;
  } catch {
    return null;
  }
}

export function walletClient() {
  const eth = getEip1193Provider();
  if (!eth) throw new Error("No wallet connected. Tap Connect and pick a wallet.");
  return createWalletClient({ chain: coston2, transport: custom(eth) });
}

export function publicClient() {
  const eth = getEip1193Provider();
  return createPublicClient({
    chain: coston2,
    transport: eth ? custom(eth) : http(NETWORK.rpc),
  });
}

export type SwapExecutionStep =
  | { step: "approve"; status: "pending" | "confirmed" | "skipped"; hash?: Hex }
  | { step: "swap"; status: "pending" | "confirmed" | "failed"; hash?: Hex; error?: string };

export type OftBridgeExecutionStep =
  | { step: "approve"; status: "pending" | "confirmed" | "skipped"; hash?: Hex }
  | { step: "send"; status: "pending" | "confirmed" | "failed"; hash?: Hex; error?: string };

/** SparkDEX Mainnet path is disabled — Beacon stays on Coston2 (114). */
export async function executeSparkDexSwap(params: {
  approveTo: Address;
  approveData: Hex;
  swapTo: Address;
  swapData: Hex;
  chainId?: number;
  onStep?: (s: SwapExecutionStep) => void;
}): Promise<{ approveHash?: Hex; swapHash: Hex }> {
  const chainId = params.chainId ?? 14;
  if (chainId === 14) {
    throw new Error(
      "SparkDEX Mainnet swaps are disabled. Use Beacon Safe on Coston2 (chain 114).",
    );
  }
  await ensureCoston2Network();

  const chain = coston2;
  const wallet = walletClient();
  const pub = publicClient();
  const [account] = await wallet.getAddresses();
  if (!account) throw new Error("Connect a wallet first.");

  let approveHash: Hex | undefined;
  params.onStep?.({ step: "approve", status: "pending" });
  try {
    approveHash = await wallet.sendTransaction({
      account,
      to: params.approveTo,
      data: params.approveData,
      chain,
    });
    params.onStep?.({ step: "approve", status: "pending", hash: approveHash });
    await pub.waitForTransactionReceipt({ hash: approveHash });
    params.onStep?.({ step: "approve", status: "confirmed", hash: approveHash });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/user rejected|denied|reject/i.test(msg)) {
      params.onStep?.({ step: "approve", status: "skipped" });
    } else {
      throw e;
    }
  }

  params.onStep?.({ step: "swap", status: "pending" });
  const swapHash = await wallet.sendTransaction({
    account,
    to: params.swapTo,
    data: params.swapData,
    chain,
  });
  params.onStep?.({ step: "swap", status: "pending", hash: swapHash });
  const receipt = await pub.waitForTransactionReceipt({ hash: swapHash });
  if (receipt.status === "reverted") {
    params.onStep?.({ step: "swap", status: "failed", hash: swapHash, error: "Swap reverted on-chain" });
    throw new Error("Swap transaction reverted. Check token balance, allowance, and pool liquidity on Flare Mainnet.");
  }
  params.onStep?.({ step: "swap", status: "confirmed", hash: swapHash });
  return { approveHash, swapHash };
}

/** Approve FXRP (if needed) + LayerZero OFT send with native messaging fee. */
export async function executeOftBridge(params: {
  approveTo: Address;
  approveData: Hex;
  sendTo: Address;
  sendData: Hex;
  nativeFee: bigint;
  onStep?: (s: OftBridgeExecutionStep) => void;
}): Promise<{ approveHash?: Hex; sendHash: Hex }> {
  await ensureCoston2Network();
  const wallet = walletClient();
  const pub = publicClient();
  const [account] = await wallet.getAddresses();
  if (!account) throw new Error("Connect a wallet first.");

  let approveHash: Hex | undefined;
  params.onStep?.({ step: "approve", status: "pending" });
  try {
    approveHash = await wallet.sendTransaction({
      account,
      to: params.approveTo,
      data: params.approveData,
      chain: coston2,
    });
    params.onStep?.({ step: "approve", status: "pending", hash: approveHash });
    await pub.waitForTransactionReceipt({ hash: approveHash });
    params.onStep?.({ step: "approve", status: "confirmed", hash: approveHash });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/user rejected|denied|reject/i.test(msg)) {
      params.onStep?.({ step: "approve", status: "skipped" });
    } else {
      throw e;
    }
  }

  params.onStep?.({ step: "send", status: "pending" });
  const sendHash = await wallet.sendTransaction({
    account,
    to: params.sendTo,
    data: params.sendData,
    value: params.nativeFee,
    chain: coston2,
  });
  params.onStep?.({ step: "send", status: "pending", hash: sendHash });
  const receipt = await pub.waitForTransactionReceipt({ hash: sendHash });
  if (receipt.status === "reverted") {
    params.onStep?.({ step: "send", status: "failed", hash: sendHash, error: "OFT send reverted on-chain" });
    throw new Error("OFT send transaction reverted. Check FXRP balance, allowance, and C2FLR for messaging fee.");
  }
  params.onStep?.({ step: "send", status: "confirmed", hash: sendHash });
  return { approveHash, sendHash };
}

export function jobIdToBytes32(jobId: string): Hex {
  // Match backend e2e / settler: sha256(utf8 jobId) → bytes32
  return sha256(toBytes(jobId));
}

/** Parse "$10.63" → USDT0 6-decimal integer. */
export function parsePriceDisplay(priceDisplay: string): bigint {
  const cleaned = priceDisplay.replace(/[^0-9.]/g, "");
  const [whole = "0", frac = ""] = cleaned.split(".");
  return BigInt(whole) * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
}

export async function getTokenMeta(): Promise<{ name: string; version: string }> {
  const client = publicClient();
  const nameAbi = parseAbi(["function name() view returns (string)"]);
  const versionAbi = parseAbi(["function version() view returns (string)"]);
  const name = await client.readContract({
    address: CONTRACTS.token,
    abi: nameAbi,
    functionName: "name",
  });
  let version = "1";
  try {
    version = await client.readContract({
      address: CONTRACTS.token,
      abi: versionAbi,
      functionName: "version",
    });
  } catch {
    // Official Coston2 faucet USDT0 has no version().
  }
  return { name, version };
}

export function openCoston2Faucet(): void {
  if (typeof window !== "undefined") {
    window.open(NETWORK.faucet, "_blank", "noopener,noreferrer");
  }
}

/** LIVE path no longer mints MockUSDT0. Opens the official Coston2 faucet. */
export async function mintMockUsdt0(): Promise<Hex> {
  openCoston2Faucet();
  throw new Error(
    "Beacon uses official Coston2 USDT0. Claim C2FLR + USDT0 from https://faucet.flare.network/coston2 — in-app mint is disabled.",
  );
}

export async function getUsdt0Balance(owner: Address): Promise<bigint> {
  const client = publicClient();
  return client.readContract({
    address: CONTRACTS.token,
    abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
    functionName: "balanceOf",
    args: [owner],
  });
}

export type AuthorizationPayload = {
  payer: string;
  payee: string;
  amount: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
  signature: string;
  jobHash: string;
  lockTxHash?: string;
  mode?: string;
};

/** Approve Coston2 USDT0 + lockFrom BeaconEscrow, then return API authorize payload. */
export async function approveJobOnChain(params: {
  jobId: string;
  priceDisplay: string;
}): Promise<AuthorizationPayload> {
  await ensureCoston2Network();
  const client = walletClient();
  const pub = publicClient();
  const [account] = await client.getAddresses();
  if (!account) throw new Error("Connect a wallet first.");

  const amount = parsePriceDisplay(params.priceDisplay);
  const balance = await getUsdt0Balance(account);
  if (balance < amount) {
    throw new Error(
      `Need ${params.priceDisplay} Coston2 USDT0. Claim from https://faucet.flare.network/coston2 then try again.`,
    );
  }

  const jobHash = jobIdToBytes32(params.jobId);
  const approveData = encodeFunctionData({
    abi: parseAbi(["function approve(address spender,uint256 amount) returns (bool)"]),
    functionName: "approve",
    args: [CONTRACTS.escrow, amount],
  });
  const approveHash = await client.sendTransaction({
    account,
    to: CONTRACTS.token,
    data: approveData,
    chain: coston2,
  });
  const approveReceipt = await pub.waitForTransactionReceipt({ hash: approveHash });
  if (approveReceipt.status === "reverted") {
    throw new Error("USDT0 approve reverted. Check the token contract and try again.");
  }

  const lockData = encodeFunctionData({
    abi: parseAbi(["function lockFrom(bytes32 jobId,address payer,uint256 amount)"]),
    functionName: "lockFrom",
    args: [jobHash, account, amount],
  });
  const lockTxHash = await client.sendTransaction({
    account,
    to: CONTRACTS.escrow,
    data: lockData,
    chain: coston2,
  });
  const lockReceipt = await pub.waitForTransactionReceipt({ hash: lockTxHash });
  if (lockReceipt.status === "reverted") {
    throw new Error("Escrow lockFrom reverted. Approve USDT0 for the escrow, then retry.");
  }

  const now = Math.floor(Date.now() / 1000);
  return {
    payer: account,
    payee: CONTRACTS.escrow,
    amount: amount.toString(),
    validAfter: String(now - 60),
    validBefore: String(now + 3600),
    nonce: jobHash,
    signature: "0x",
    jobHash,
    lockTxHash,
    mode: "erc20-lock",
  };
}

/** Approve + deposit into Beacon Safe (official Coston2 USDT0 ERC-20). */
export async function executeAgentVaultPrep(params: {
  to: Address;
  data: Hex;
  approveTo?: Address;
  approveData?: Hex;
  mode?: "eip3009" | "approve";
  token?: Address;
  amount?: string;
  action?: string;
}): Promise<{ approveHash?: Hex; txHash: Hex }> {
  await ensureCoston2Network();
  const wallet = walletClient();
  const pub = publicClient();
  const [account] = await wallet.getAddresses();
  if (!account) throw new Error("Connect a wallet first.");

  if (params.mode === "eip3009") {
    throw new Error(
      "EIP-3009 deposit is disabled. Official Coston2 USDT0 uses approve + deposit. Claim tokens at https://faucet.flare.network/coston2",
    );
  }

  if (params.action === "deposit" && params.amount) {
    const amount = BigInt(params.amount);
    const balance = await getUsdt0Balance(account);
    if (balance < amount) {
      throw new Error(
        `Not enough Coston2 USDT0. Balance ${Number(balance) / 1e6}. Claim from https://faucet.flare.network/coston2`,
      );
    }
  }

  let approveHash: Hex | undefined;
  if (params.approveTo && params.approveData) {
    approveHash = await wallet.sendTransaction({
      account,
      to: params.approveTo,
      data: params.approveData,
      chain: coston2,
    });
    await pub.waitForTransactionReceipt({ hash: approveHash });
  }

  if (!params.data || params.data === "0x") {
    throw new Error("Missing Safe transaction data.");
  }

  const txHash = await wallet.sendTransaction({
    account,
    to: params.to,
    data: params.data,
    chain: coston2,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status === "reverted") {
    throw new Error("Safe transaction reverted on Coston2.");
  }
  return { approveHash, txHash };
}

/** Opens the official Coston2 faucet (C2FLR + USDT0 + FXRP). Does not mint MockUSDT0. */
export async function mintTestUsdt0(): Promise<Hex> {
  openCoston2Faucet();
  throw new Error(
    "Get Coston2 USDT0 from the official faucet: https://faucet.flare.network/coston2",
  );
}

export function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** personal_sign helper for Beacon Safe pay challenges. */
export async function signPersonalMessage(message: string): Promise<string> {
  const wallet = walletClient();
  const [account] = await wallet.getAddresses();
  if (!account) throw new Error("Connect a wallet first.");
  return wallet.signMessage({ account, message });
}

/** Send a prepared createSafe / vault tx (non-EIP-3009). */
export async function sendPreparedVaultTx(params: {
  to: Address;
  data: Hex;
}): Promise<Hex> {
  await ensureCoston2Network();
  const wallet = walletClient();
  const pub = publicClient();
  const [account] = await wallet.getAddresses();
  if (!account) throw new Error("Connect a wallet first.");
  const txHash = await wallet.sendTransaction({
    account,
    to: params.to,
    data: params.data,
    chain: coston2,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status === "reverted") {
    throw new Error("Safe transaction reverted on Coston2.");
  }
  return txHash;
}
