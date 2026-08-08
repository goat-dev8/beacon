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

/** EIP-3009 deposit into Beacon Safe (MockUSDT0 has no approve/transferFrom on Coston2). */
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

  // Coston2 MockUSDT0 has no approve/transferFrom — always EIP-3009 for deposits.
  if (
    params.mode === "eip3009" ||
    params.action === "deposit" ||
    (params.token && params.amount)
  ) {
    const token = (params.token || params.approveTo || CONTRACTS.token) as Address;
    const amount = params.amount
      ? BigInt(params.amount)
      : params.approveData
        ? // decode amount from approve(spender, amount) last 32 bytes if present
          BigInt(`0x${params.approveData.slice(-64)}`)
        : 0n;
    if (!token || amount <= 0n) throw new Error("Invalid Safe deposit amount.");

    const balance = await getUsdt0Balance(account);
    if (balance < amount) {
      throw new Error(
        `Not enough USDT0. Balance ${Number(balance) / 1e6}. Mint test USDT0 on the Safe page, then try again.`,
      );
    }

    const { name, version } = await getTokenMeta();
    const validAfter = BigInt(Math.floor(Date.now() / 1000) - 60);
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const nonce = (`0x${crypto.getRandomValues(new Uint8Array(32)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "")}`) as Hex;

    const signature = await wallet.signTypedData({
      account,
      domain: {
        name,
        version,
        chainId: NETWORK.chainId,
        verifyingContract: token,
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
        to: params.to,
        value: amount,
        validAfter,
        validBefore,
        nonce,
      },
    });

    const data = encodeFunctionData({
      abi: parseAbi([
        "function depositWithAuthorization(address from,uint256 amount,uint256 validAfter,uint256 validBefore,bytes32 nonce,bytes signature)",
      ]),
      functionName: "depositWithAuthorization",
      args: [account, amount, validAfter, validBefore, nonce, signature],
    });

    const txHash = await wallet.sendTransaction({
      account,
      to: params.to,
      data,
      chain: coston2,
    });
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status === "reverted") {
      throw new Error("Safe deposit reverted on Coston2. Check USDT0 balance and try again.");
    }
    return { txHash };
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

/** Mint MockUSDT0 test credit to the connected wallet (public mint on Coston2). */
export async function mintTestUsdt0(amountDisplay = "100"): Promise<Hex> {
  await ensureCoston2Network();
  const wallet = walletClient();
  const pub = publicClient();
  const [account] = await wallet.getAddresses();
  if (!account) throw new Error("Connect a wallet first.");
  const amount = parsePriceDisplay(amountDisplay);
  const data = encodeFunctionData({
    abi: parseAbi(["function mint(address to,uint256 amount)"]),
    functionName: "mint",
    args: [account, amount],
  });
  const txHash = await wallet.sendTransaction({
    account,
    to: CONTRACTS.token,
    data,
    chain: coston2,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status === "reverted") throw new Error("Mint reverted on Coston2.");
  return txHash;
}

export function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
