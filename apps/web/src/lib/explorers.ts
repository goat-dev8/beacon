import { NETWORK } from "@/lib/chain";

/** Flare Mainnet (chain 14) — SparkDEX execute path. */
export const FLARE_MAINNET = {
  chainId: 14,
  name: "Flare Mainnet",
  explorer: "https://flarescan.com",
} as const;

/** Coston2 (chain 114) — x402, OFT bridge source, FTSO, FAssets status. */
export const COSTON2 = {
  chainId: NETWORK.chainId,
  name: NETWORK.name,
  explorer: NETWORK.explorer,
} as const;

export function explorerForChain(chainId: number | string | null | undefined): string {
  const id = Number(chainId);
  if (id === FLARE_MAINNET.chainId) return FLARE_MAINNET.explorer;
  return COSTON2.explorer;
}

export function explorerTx(
  hash: string,
  chainId?: number | string | null,
): string {
  const base = explorerForChain(chainId);
  return `${base}/tx/${hash}`;
}

export function explorerAddress(
  address: string,
  chainId?: number | string | null,
): string {
  const base = explorerForChain(chainId);
  return `${base}/address/${address}`;
}

export function explorerLabel(chainId?: number | string | null): string {
  const id = Number(chainId);
  if (id === FLARE_MAINNET.chainId) return "Flare Mainnet";
  return "Coston2";
}
