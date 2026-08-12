import type { Hex } from "viem";
import { encodeFunctionData, parseAbi } from "viem";
import { CONTRACTS, NETWORK } from "./chain";
import { ensureCoston2Network, publicClient, walletClient } from "./wallet";

const coston2 = {
  id: NETWORK.chainId,
  name: NETWORK.name,
  nativeCurrency: { name: "C2FLR", symbol: "C2FLR", decimals: 18 },
  rpcUrls: { default: { http: [NETWORK.rpc] } },
} as const;

/** Approve Coston2 faucet USDT0 for the x402 facilitator, then return an ERC-20 pull payload. */
export async function payX402Erc20(params: {
  amountUsdt0: string;
  payTo: string;
  token: string;
}): Promise<{
  mode: "erc20-pull";
  from: string;
  to: string;
  token: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
  chainId: number;
  network: string;
  approveTxHash: Hex;
}> {
  await ensureCoston2Network();
  const client = walletClient();
  const pub = publicClient();
  const [account] = await client.getAddresses();
  if (!account) throw new Error("Connect wallet first.");

  const amount = BigInt(Math.round(parseFloat(params.amountUsdt0) * 1e6));
  const token = (params.token || CONTRACTS.token) as Hex;
  const to = (params.payTo || CONTRACTS.payee) as Hex;
  const now = Math.floor(Date.now() / 1000);
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = `0x${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;

  const data = encodeFunctionData({
    abi: parseAbi(["function approve(address spender,uint256 amount) returns (bool)"]),
    functionName: "approve",
    args: [CONTRACTS.facilitator, amount],
  });
  const approveTxHash = await client.sendTransaction({
    account,
    to: token,
    data,
    chain: coston2,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash: approveTxHash });
  if (receipt.status === "reverted") {
    throw new Error("USDT0 approve for x402 facilitator reverted.");
  }

  return {
    mode: "erc20-pull",
    from: account,
    to,
    token,
    value: amount.toString(),
    validAfter: String(now - 60),
    validBefore: String(now + 600),
    nonce,
    chainId: NETWORK.chainId,
    network: "flare-coston2",
    approveTxHash,
  };
}

/** @deprecated Use payX402Erc20 — faucet USDT0 has no EIP-3009. */
export const signX402Payment = payX402Erc20;
