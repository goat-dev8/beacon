/**
 * Portfolio desk — live Coston2 balances valued with FTSO.
 */

import { loadEnv, type BeaconEnv } from "./env.js";
import {
  COSTON2_USDT0,
  readErc20Balance,
  readFtsoFeeds,
  resolveFxrpAddress,
  FLARE_CONTRACT_REGISTRY_DEFAULT,
} from "./ftso.js";
import { Contract, JsonRpcProvider } from "ethers";

export interface PortfolioPosition {
  symbol: string;
  address: string;
  balance: string;
  decimals: number;
  usdValue: number | null;
  source: "Coston2";
}

export interface PortfolioDesk {
  flarePrimitive: "FTSO + FAssets FXRP + Coston2 ERC-20";
  wallet: string;
  network: string;
  chainId: number;
  positions: PortfolioPosition[];
  totalUsd: number;
  ftso: Array<{ symbol: string; value: number }>;
  honesty: string;
  recommended: string[];
}

export async function readPortfolioDesk(
  wallet: string,
  env: BeaconEnv = loadEnv(),
): Promise<PortfolioDesk> {
  const snap = await readFtsoFeeds(env);
  const xrp = snap.feeds.find((f) => f.symbol === "XRP/USD")?.value ?? 0;
  const flr = snap.feeds.find((f) => f.symbol === "FLR/USD")?.value ?? 0;

  const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
  const registry = env.FLARE_CONTRACT_REGISTRY || FLARE_CONTRACT_REGISTRY_DEFAULT;
  const reg = new Contract(
    registry,
    ["function getContractAddressByName(string) view returns (address)"],
    provider,
  );
  const wnat = (await reg.getContractAddressByName("WNat")) as string;
  const fxrp = await resolveFxrpAddress(env);

  const tokens: Array<{ address: string; usdPerUnit: (sym: string) => number | null }> = [
    { address: COSTON2_USDT0, usdPerUnit: () => 1 },
    { address: fxrp, usdPerUnit: () => (xrp > 0 ? xrp : null) },
    { address: wnat, usdPerUnit: () => (flr > 0 ? flr : null) },
  ];
  if (env.X402_TOKEN_ADDRESS) {
    tokens.push({ address: env.X402_TOKEN_ADDRESS, usdPerUnit: () => 1 });
  }

  const positions: PortfolioPosition[] = [];
  let totalUsd = 0;
  for (const t of tokens) {
    try {
      const bal = await readErc20Balance(t.address, wallet, env);
      const unit = t.usdPerUnit(bal.symbol);
      const qty = parseFloat(bal.formatted) || 0;
      const usdValue = unit == null ? null : qty * unit;
      if (usdValue != null) totalUsd += usdValue;
      positions.push({
        symbol: bal.symbol,
        address: t.address,
        balance: bal.formatted,
        decimals: bal.decimals,
        usdValue,
        source: "Coston2",
      });
    } catch {
      /* skip broken token */
    }
  }

  const recommended: string[] = [];
  const usdt = positions.find((p) => /usdt/i.test(p.symbol) && !/mock/i.test(p.symbol));
  const fx = positions.find((p) => /fxrp|xrp/i.test(p.symbol));
  if (usdt && parseFloat(usdt.balance) > 0) {
    recommended.push("You hold Coston2 USDT0 — SparkDEX swap execute is on Flare Mainnet (@swap).");
  }
  if (fx && parseFloat(fx.balance) > 0) {
    recommended.push("FXRP on Coston2 can bridge via LayerZero OFT (@bridge) or check FAssets status (@fassets).");
  }
  if (!recommended.length) {
    recommended.push("Fund Coston2 USDT0 from the faucet, then use @signals / @intel before sizing risk.");
  }

  return {
    flarePrimitive: "FTSO + FAssets FXRP + Coston2 ERC-20",
    wallet,
    network: "coston2",
    chainId: 114,
    positions,
    totalUsd: Number(totalUsd.toFixed(4)),
    ftso: snap.feeds.map((f) => ({ symbol: f.symbol, value: f.value })),
    honesty:
      "Balances are live Coston2 reads. USD marks use FTSO (FXRP≈XRP, WNat≈FLR). MockUSDT0 is for x402/escrow only.",
    recommended,
  };
}
