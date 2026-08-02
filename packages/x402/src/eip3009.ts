import { TypedDataDomain, TypedDataField, Wallet, Contract, Provider } from "ethers";

export interface TransferAuthorization {
  from: string;
  to: string;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: `0x${string}`;
}

export const EIP3009_DOMAIN_NAME = "USD₮0";
export const EIP3009_DOMAIN_VERSION = "1";

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

export function buildEip3009Domain(chainId: number, verifyingContract: string): TypedDataDomain {
  return {
    name: EIP3009_DOMAIN_NAME,
    version: EIP3009_DOMAIN_VERSION,
    chainId,
    verifyingContract,
  };
}

export async function signTransferWithAuthorization(
  wallet: Wallet,
  tokenAddress: string,
  chainId: number,
  auth: TransferAuthorization,
): Promise<string> {
  const domain = buildEip3009Domain(chainId, tokenAddress);
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

  constructor(private readonly config: FacilitatorClientConfig) {
    this.contract = new Contract(config.facilitatorAddress, FACILITATOR_ABI, config.provider);
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
