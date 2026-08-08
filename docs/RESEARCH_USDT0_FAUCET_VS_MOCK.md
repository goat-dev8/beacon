# Research: Faucet USDT0 vs Beacon MockUSDT0 (Coston2)

Date: 2026-08-09  
Scope: Should Beacon Safe / Jobs / x402 switch from MockUSDT0 to faucet “real” USDT0?

## Sources

| Source | Finding |
|--------|---------|
| [Coston2 faucet](https://faucet.flare.network/coston2) | 100 C2FLR, 10 USDT0, 10 FXRP per address / 24h |
| [x402 payments (Flare DevHub)](https://dev.flare.network/fxrp/token-interactions/x402-payments) | **MockUSDT0** is the documented EIP-3009 payment asset; FXRP when it gains EIP-3009 |
| [Gasless USD₮0 (mainnet guide)](https://dev.flare.network/network/guides/gasless-usdt0-transfers) | Mainnet USD₮0 EIP-3009 — not the Coston2 faucet ERC-20 used for Smart Accounts / SparkDEX demos |
| [Smart Accounts control-usdt0](https://dev.flare.network/smart-accounts/guides/typescript-viem/control-usdt0-ts) | Faucet / SparkDEX path USDT0 `0xC1A5B41512496B80903D1f32d6dEa3a73212E71F` |
| [Developer tools Coston2](https://dev.flare.network/network/developer-tools?network=coston2) | RPC / explorer / faucet links |
| [LayerZero Flare testnet](https://docs.layerzero.network/v2/deployments/chains/flare-testnet) | Bridge tooling; orthogonal to Safe payment token |
| [FAssets swap/redeem](https://dev.flare.network/fassets/developer-guides/fassets-swap-redeem) | FXRP / FAssets flows; not x402 settle |

## Addresses (Coston2)

| Token | Address | Role on Beacon |
|-------|---------|----------------|
| **MockUSDT0** (Beacon + Flare x402 demo) | `0x6fd8a72a972040f3153894BBd0d829a58f1Fe86c` | Safe deposit/spend, Jobs escrow, x402 Facilitator |
| **Faucet / SparkDEX USDT0** | `0xC1A5B41512496B80903D1f32d6dEa3a73212E71F` | Flow / Smart Account / DEX demos — **not** wired to Escrow/Facilitator |
| Mainnet USD₮0 | `0xe7cd86e13AC4309349F30B3435a9d337750fC82D` | Mainnet gasless guide only |

## Decision

**Keep MockUSDT0 for Beacon Safe, Agent Jobs, and x402.**

Reasons:

1. Flare’s official x402 guide uses MockUSDT0 with `transferWithAuthorization` (EIP-3009). Beacon matches that judge-visible pattern.
2. Faucet USDT0 is the Smart Accounts / swap guide token. On-chain probes show it does **not** expose EIP-3009 domain helpers used by Beacon’s settle path.
3. Switching Safe/Jobs to faucet USDT0 would require redeploying Escrow, Facilitator, factory vaults, and SwapDesk onto a token that may still lack EIP-3009 — breaking deposit + gasless pay.
4. Product honesty: label MockUSDT0 as the **Beacon payment rail**; send users to the faucet for **C2FLR gas** (and optional FXRP/USDT0 for non-rail demos).

## Product UX (shipped with this research)

1. Safe page: faucet CTA **before** “Create your personal Safe”.
2. Mint / deposit copy clarifies MockUSDT0 vs faucet USDT0.
3. Jobs Safe pay: amount string normalization so UI `0.011` matches escrow `0.011000`.

## When to revisit

- Flare documents faucet Coston2 USDT0 with EIP-3009 for x402, **or**
- Mainnet launch with USD₮0 + Facilitator support, with a deliberate redeploy plan.
