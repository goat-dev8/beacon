import type { Hex } from "viem";
import { CONTRACTS, NETWORK } from "./chain";
import { ensureCoston2Network, getTokenMeta, walletClient } from "./wallet";

/** Sign EIP-3009 for Beacon MockUSDT0 x402 micropay (agent premium). */
export async function signX402Payment(params: {
  amountUsdt0: string;
  payTo: string;
  token: string;
}): Promise<{
  from: string;
  to: string;
  token: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
  signature: string;
  v: number;
  r: string;
  s: string;
}> {
  await ensureCoston2Network();
  const client = walletClient();
  const [account] = await client.getAddresses();
  if (!account) throw new Error("Connect wallet first.");

  const amount = BigInt(Math.round(parseFloat(params.amountUsdt0) * 1e6));
  const validAfter = BigInt(Math.floor(Date.now() / 1000) - 60);
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 600);
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = (`0x${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`) as Hex;
  const token = (params.token || CONTRACTS.token) as Hex;
  const to = (params.payTo || CONTRACTS.payee) as Hex;
  const { name, version } = await getTokenMeta();

  const signature = await client.signTypedData({
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
      to,
      value: amount,
      validAfter,
      validBefore,
      nonce,
    },
  });

  const sig = signature.slice(2);
  const r = `0x${sig.slice(0, 64)}`;
  const s = `0x${sig.slice(64, 128)}`;
  const v = parseInt(sig.slice(128, 130), 16);

  return {
    from: account,
    to,
    token,
    value: amount.toString(),
    validAfter: validAfter.toString(),
    validBefore: validBefore.toString(),
    nonce,
    signature,
    v,
    r,
    s,
  };
}
