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

const flareMainnet = {
  id: 14,
  name: "Flare Mainnet",
  nativeCurrency: { name: "FLR", symbol: "FLR", decimals: 18 },
  rpcUrls: { default: { http: ["https://flare-api.flare.network/ext/C/rpc"] } },
} as const;

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}

export function hasEvmProvider(): boolean {
  return typeof window !== "undefined" && Boolean(window.ethereum);
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

export async function ensureFlareMainnet(): Promise<void> {
  await ensureChain({
    chainId: 14,
    name: "Flare Mainnet",
    rpc: "https://flare-api.flare.network/ext/C/rpc",
    explorer: "https://flarescan.com",
    nativeName: "FLR",
    nativeSymbol: "FLR",
  });
}

async function ensureChain(params: {
  chainId: number;
  name: string;
  rpc: string;
  explorer: string;
  nativeName: string;
  nativeSymbol: string;
}): Promise<void> {
  if (!window.ethereum) throw new Error("No EVM wallet found. Install MetaMask or Rabby.");
  const targetHex = `0x${params.chainId.toString(16)}` as Hex;
  const chainIdHex = (await window.ethereum.request({ method: "eth_chainId" })) as Hex;
  if (parseInt(chainIdHex, 16) === params.chainId) return;

  try {
    await window.ethereum.request({
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

  await window.ethereum.request({
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
  await window.ethereum.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: targetHex }],
  });
}

export async function connectEvmWallet(): Promise<Address> {
  if (!window.ethereum) throw new Error("No EVM wallet found. Install MetaMask or Rabby.");
  const accounts = (await window.ethereum.request({
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
  if (!window.ethereum) return null;
  try {
    const accounts = (await window.ethereum.request({ method: "eth_accounts" })) as string[];
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
  if (!window.ethereum) throw new Error("No EVM provider");
  return createWalletClient({ chain: coston2, transport: custom(window.ethereum) });
}

export function publicClient() {
  return createPublicClient({
    chain: coston2,
    transport: window.ethereum ? custom(window.ethereum) : http(NETWORK.rpc),
  });
}

export type SwapExecutionStep =
  | { step: "approve"; status: "pending" | "confirmed" | "skipped"; hash?: Hex }
  | { step: "swap"; status: "pending" | "confirmed" | "failed"; hash?: Hex; error?: string };

export type OftBridgeExecutionStep =
  | { step: "approve"; status: "pending" | "confirmed" | "skipped"; hash?: Hex }
  | { step: "send"; status: "pending" | "confirmed" | "failed"; hash?: Hex; error?: string };

/** Approve (if needed) + SparkDEX exactInputSingle; wait for receipts. Default chain = Flare Mainnet. */
export async function executeSparkDexSwap(params: {
  approveTo: Address;
  approveData: Hex;
  swapTo: Address;
  swapData: Hex;
  chainId?: number;
  onStep?: (s: SwapExecutionStep) => void;
}): Promise<{ approveHash?: Hex; swapHash: Hex }> {
  const chainId = params.chainId ?? 14;
  if (chainId === 14) await ensureFlareMainnet();
  else await ensureCoston2Network();

  const chain = chainId === 14 ? flareMainnet : coston2;
  const wallet = walletClient();
  const pub =
    chainId === 14
      ? createPublicClient({
          chain: flareMainnet,
          transport: http("https://flare-api.flare.network/ext/C/rpc"),
        })
      : publicClient();
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
  const abi = parseAbi([
    "function name() view returns (string)",
    "function version() view returns (string)",
  ]);
  const [name, version] = await Promise.all([
    client.readContract({ address: CONTRACTS.token, abi, functionName: "name" }),
    client.readContract({ address: CONTRACTS.token, abi, functionName: "version" }),
  ]);
  return { name, version };
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

export async function mintMockUsdt0(amount = 1_000_000_000n): Promise<Hex> {
  await ensureCoston2Network();
  const client = walletClient();
  const [account] = await client.getAddresses();
  if (!account) throw new Error("Connect a wallet first.");
  const data = encodeFunctionData({
    abi: parseAbi(["function mint(address to, uint256 amount)"]),
    functionName: "mint",
    args: [account, amount],
  });
  return client.sendTransaction({ account, to: CONTRACTS.token, data, chain: coston2 });
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
};

/** Sign EIP-3009 + lock funds in BeaconEscrow on Coston2, then return API authorize payload. */
export async function approveJobOnChain(params: {
  jobId: string;
  priceDisplay: string;
}): Promise<AuthorizationPayload> {
  await ensureCoston2Network();
  const client = walletClient();
  const [account] = await client.getAddresses();
  if (!account) throw new Error("Connect a wallet first.");

  const amount = parsePriceDisplay(params.priceDisplay);
  const balance = await getUsdt0Balance(account);
  if (balance < amount) {
    throw new Error(
      `Need ${params.priceDisplay} credit. Balance too low — mint test USD₮0 from the desk, then try again.`,
    );
  }

  const { name, version } = await getTokenMeta();
  const validAfter = BigInt(Math.floor(Date.now() / 1000) - 60);
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const nonce = (`0x${crypto.getRandomValues(new Uint8Array(32)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "")}`) as Hex;
  const jobHash = jobIdToBytes32(params.jobId);

  const signature = await client.signTypedData({
    account,
    domain: {
      name,
      version,
      chainId: NETWORK.chainId,
      verifyingContract: CONTRACTS.token,
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from: account,
      to: CONTRACTS.escrow,
      value: amount,
      validAfter,
      validBefore,
      nonce,
    },
  });

  const data = encodeFunctionData({
    abi: parseAbi([
      "function lockWithAuthorization(bytes32 jobId,address payer,uint256 amount,uint256 validAfter,uint256 validBefore,bytes32 nonce,bytes signature)",
    ]),
    functionName: "lockWithAuthorization",
    args: [jobHash, account, amount, validAfter, validBefore, nonce, signature],
  });

  const lockTxHash = await client.sendTransaction({
    account,
    to: CONTRACTS.escrow,
    data,
    chain: coston2,
  });

  return {
    payer: account,
    payee: CONTRACTS.escrow,
    amount: amount.toString(),
    validAfter: validAfter.toString(),
    validBefore: validBefore.toString(),
    nonce,
    signature,
    jobHash,
    lockTxHash,
  };
}

export function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
