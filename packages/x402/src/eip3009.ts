import { TypedDataDomain, TypedDataField, Wallet, Contract, Provider } from "ethers";

export interface TransferAuthorization {
  from: string;
  to: string;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: `0x${string}`;
}

/**
 * Historical Flare-guide label for mainnet-style USDT0.
 * CRITICAL: MockUSDT0 on Coston2 uses `name = "USD0"` — never assume this constant
 * matches the verifying contract. Always resolve via {@link resolveEip3009Domain}.
 */
export const EIP3009_DOMAIN_NAME_HINT = "USD₮0";
/** @deprecated Use resolveEip3009Domain — MockUSDT0 domain name is "USD0", not this hint. */
export const EIP3009_DOMAIN_NAME = EIP3009_DOMAIN_NAME_HINT;
export const EIP3009_DOMAIN_VERSION = "1";

/** Coston2 Beacon MockUSDT0 — testnet/demo EIP-3009 asset until production USDT0 supports EIP-3009. */
export const MOCK_USDT0_DEMO_LABEL = "MockUSDT0 (Coston2 testnet/demo — not SparkDEX USDT0)";

export const TRANSFER_WITH_AUTHORIZATION_TYPES: Record<string, TypedDataField[]> = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

export type Eip3009DomainFields = {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
  /** True when name/version came from token.name()/version(); false if caller supplied overrides only. */
  resolvedFromContract: boolean;
};

const domainCache = new Map<string, { at: number; fields: Eip3009DomainFields }>();
const DOMAIN_CACHE_TTL_MS = 10 * 60 * 1000;

function cacheKey(chainId: number, token: string): string {
  return `${chainId}:${token.toLowerCase()}`;
}

/**
 * Build an EIP-712 domain. Prefer {@link resolveEip3009Domain} so `name` matches token.name().
 * Passing an explicit `name` is required when not reading the contract.
 */
export function buildEip3009Domain(
  chainId: number,
  verifyingContract: string,
  opts?: { name?: string; version?: string },
): TypedDataDomain {
  const name = opts?.name?.trim();
  if (!name) {
    throw new Error(
      "EIP-712 domain name required — resolve via token.name() (MockUSDT0 may be \"USD0\", not \"USD₮0\").",
    );
  }
  return {
    name,
    version: opts?.version?.trim() || EIP3009_DOMAIN_VERSION,
    chainId,
    verifyingContract,
  };
}

/**
 * Resolve EIP-712 domain name/version FROM the token contract.
 * Fail closed if name() is empty — never silently substitute "USD₮0".
 */
export async function resolveEip3009Domain(
  provider: Provider,
  tokenAddress: string,
  chainId: number,
  opts?: { force?: boolean },
): Promise<Eip3009DomainFields> {
  const key = cacheKey(chainId, tokenAddress);
  const now = Date.now();
  if (!opts?.force) {
    const hit = domainCache.get(key);
    if (hit && now - hit.at < DOMAIN_CACHE_TTL_MS) return hit.fields;
  }

  const token = new Contract(tokenAddress, TOKEN_ABI, provider);
  let name: string;
  let version = EIP3009_DOMAIN_VERSION;
  try {
    name = String(await token.name());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read token.name() for EIP-712 domain at ${tokenAddress}: ${msg}`);
  }
  if (!name.trim()) {
    throw new Error(`token.name() empty at ${tokenAddress} — refuse EIP-712 domain (fail closed).`);
  }
  try {
    const v = await token.version();
    if (v != null && String(v).trim()) version = String(v);
  } catch {
    // Some EIP-3009 tokens omit version(); contract separator may still use "1".
  }

  const fields: Eip3009DomainFields = {
    name: name.trim(),
    version: version.trim() || EIP3009_DOMAIN_VERSION,
    chainId,
    verifyingContract: tokenAddress,
    resolvedFromContract: true,
  };
  domainCache.set(key, { at: now, fields });
  return fields;
}

export function clearEip3009DomainCache(): void {
  domainCache.clear();
}

export async function signTransferWithAuthorization(
  wallet: Wallet,
  tokenAddress: string,
  chainId: number,
  auth: TransferAuthorization,
  provider?: Provider,
): Promise<string> {
  const resolvedProvider = provider ?? wallet.provider;
  if (!resolvedProvider) {
    throw new Error("Provider required to resolve EIP-712 domain from token.name().");
  }
  const resolved = await resolveEip3009Domain(resolvedProvider, tokenAddress, chainId);
  const domain = buildEip3009Domain(chainId, tokenAddress, {
    name: resolved.name,
    version: resolved.version,
  });
  return wallet.signTypedData(domain, TRANSFER_WITH_AUTHORIZATION_TYPES, auth);
}

export function parseUsdtAmount(amount: number): bigint {
  return BigInt(Math.round(amount * 1_000_000));
}

export function formatUsdtAmount(value: bigint): string {
  const whole = value / 1_000_000n;
  const frac = value % 1_000_000n;
  return `${whole}.${frac.toString().padStart(6, "0")}`;
}

export const FACILITATOR_ABI = [
  "function verifyPayment(address token, address payer, address payee, uint256 amount, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature) view returns (bool)",
  "function settlePayment(address token, address payer, address payee, uint256 amount, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature) returns (bool)",
] as const;

export const TOKEN_ABI = [
  "function name() view returns (string)",
  "function version() view returns (string)",
  "function symbol() view returns (string)",
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature) returns (bool)",
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
] as const;

export interface FacilitatorClientConfig {
  facilitatorAddress: string;
  tokenAddress: string;
  provider: Provider;
}

export class FacilitatorClient {
  private readonly contract: Contract;
  private readonly token: Contract;

  constructor(private readonly config: FacilitatorClientConfig) {
    this.contract = new Contract(config.facilitatorAddress, FACILITATOR_ABI, config.provider);
    this.token = new Contract(config.tokenAddress, TOKEN_ABI, config.provider);
  }

  async isAuthorizationUsed(authorizer: string, nonce: `0x${string}`): Promise<boolean> {
    return this.token.authorizationState(authorizer, nonce) as Promise<boolean>;
  }

  async verifyPayment(
    payer: string,
    payee: string,
    amount: bigint,
    validAfter: bigint,
    validBefore: bigint,
    nonce: `0x${string}`,
    signature: string,
  ): Promise<boolean> {
    return this.contract.verifyPayment(
      this.config.tokenAddress,
      payer,
      payee,
      amount,
      validAfter,
      validBefore,
      nonce,
      signature,
    ) as Promise<boolean>;
  }

  async settlePayment(
    signer: Wallet,
    payer: string,
    payee: string,
    amount: bigint,
    validAfter: bigint,
    validBefore: bigint,
    nonce: `0x${string}`,
    signature: string,
  ): Promise<{ success: boolean; txHash?: string }> {
    const connected = this.contract.connect(signer) as Contract;
    const tx = await connected.settlePayment(
      this.config.tokenAddress,
      payer,
      payee,
      amount,
      validAfter,
      validBefore,
      nonce,
      signature,
    );
    const receipt = await tx.wait();
    return { success: receipt?.status === 1, txHash: receipt?.hash };
  }
}

export function randomAuthNonce(): `0x${string}` {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Buffer.from(bytes).toString("hex")}` as `0x${string}`;
}

export function normalizeAddress(addr: string): string {
  return addr.trim().toLowerCase();
}

export function addressesEqual(a: string, b: string): boolean {
  return normalizeAddress(a) === normalizeAddress(b);
}

/** Fail-closed field checks shared by resource settle + agent chat settle. */
export type X402SettleExpectation = {
  chainId: number;
  network: string;
  tokenAddress: string;
  payeeAddress: string;
  /** Exact amount required (6-decimal integer units). */
  exactAmount: bigint;
  /** Max validity window length in seconds (default 600). */
  maxValiditySeconds?: number;
  /** Allow a small clock skew for validAfter in the past (default 120). */
  clockSkewSeconds?: number;
};

export type X402PaymentFields = {
  from: string;
  to: string;
  token?: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
};

export function assertX402PaymentFields(
  payment: X402PaymentFields,
  expect: X402SettleExpectation,
  nowSec = Math.floor(Date.now() / 1000),
): { value: bigint; validAfter: bigint; validBefore: bigint; nonce: `0x${string}` } {
  if (!/^0x[a-fA-F0-9]{40}$/.test(payment.from)) {
    throw new Error("Invalid payment.from address.");
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(payment.to)) {
    throw new Error("Invalid payment.to address.");
  }
  if (!addressesEqual(payment.to, expect.payeeAddress)) {
    throw new Error(`Payment payee mismatch — expected ${expect.payeeAddress}.`);
  }
  if (payment.token && !addressesEqual(payment.token, expect.tokenAddress)) {
    throw new Error(`Payment token mismatch — expected ${expect.tokenAddress} (MockUSDT0 demo on Coston2).`);
  }

  let value: bigint;
  let validAfter: bigint;
  let validBefore: bigint;
  try {
    value = BigInt(payment.value);
    validAfter = BigInt(payment.validAfter);
    validBefore = BigInt(payment.validBefore);
  } catch {
    throw new Error("Payment value/validity fields must be integer strings.");
  }

  if (value !== expect.exactAmount) {
    throw new Error(
      `Exact amount required: ${expect.exactAmount.toString()} (got ${value.toString()}).`,
    );
  }

  const skew = expect.clockSkewSeconds ?? 120;
  const maxWindow = expect.maxValiditySeconds ?? 600;
  if (validBefore <= validAfter) {
    throw new Error("Payment validBefore must be after validAfter.");
  }
  if (validBefore - validAfter > BigInt(maxWindow + skew)) {
    throw new Error(`Payment validity window exceeds ${maxWindow}s.`);
  }
  if (nowSec < Number(validAfter) - skew) {
    throw new Error("Payment authorization is not yet valid.");
  }
  if (nowSec >= Number(validBefore)) {
    throw new Error("Payment authorization expired.");
  }

  const nonce = payment.nonce as `0x${string}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(nonce)) {
    throw new Error("Payment nonce must be bytes32 hex.");
  }

  return { value, validAfter, validBefore, nonce };
}
