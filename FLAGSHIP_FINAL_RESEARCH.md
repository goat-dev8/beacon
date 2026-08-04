# Beacon Flagship — Flare Research Dossier (2026-08-05)

Grounded only in official Flare Developer Hub, LayerZero docs, and Coston2 tooling. No invented APIs.

## Sources consulted

| Source | What we took |
|---|---|
| [Developer tools · Coston2](https://dev.flare.network/network/developer-tools?network=coston2) | LayerZero V2 / Stargate / RPCs / explorers / OFTs |
| [FTSO getting started](https://dev.flare.network/ftso/getting-started) | FTSOv2 feed consumption via ContractRegistry / TestFtsoV2Interface on Coston2 |
| [USDT0 → FXRP swap](https://dev.flare.network/fxrp/token-interactions/usdt0-fxrp-swap) | SparkDEX Uniswap V3 router `0x8a1E35F5…`, fee tier 500, approve + `exactInputSingle` |
| [FAssets swap/redeem](https://dev.flare.network/fassets/developer-guides/fassets-swap-redeem) | FXRP as FAsset; mint/redeem paths separate from DEX swap |
| [Smart Accounts · control USDT0](https://dev.flare.network/smart-accounts/guides/typescript-viem/control-usdt0-ts#swap-usdt0-to-fxrp) | XRPL → PersonalAccount pattern — **not** MetaMask session keys |
| [FXRP OFT peers](https://dev.flare.network/fxrp/oft/fxrp-autoredeem#discovering-available-bridge-routes) | Adapter `0xCd3d2127…`; peers BSC 40102, Sepolia 40161, Hyperliquid 40362 |
| [FXRP automint + bridge](https://dev.flare.network/fxrp/oft/fxrp-automint) | Custom instruction approve+send; fee via on-chain quote |
| [LayerZero Flare Testnet](https://docs.layerzero.network/v2/deployments/chains/flare-testnet) | Endpoint IDs / messaging |
| [x402 payments](https://dev.flare.network/fxrp/token-interactions/x402-payments) | HTTP 402 → EIP-3009 auth → facilitator verify/settle → resource |
| Flare AI Skills (FTSO / FAssets / Smart Accounts / FDC) | Workflow vocabulary for agents — never invent contract addresses |

## Primitive → Beacon feature map

| Flare primitive | Beacon surface | Honesty rule |
|---|---|---|
| **FTSOv2** | Signals / Trade bias | Live feeds only; narrate bias + confidence, never raw numbers alone |
| **SparkDEX V3** | Swap USDT0→FXRP | Real approve + swap txs; explorer receipt; Coston2 USDT0 ≠ MockUSDT0 |
| **FAssets FXRP** | Swap destination / bridge asset | FXRP from AssetManager; no fake mint |
| **LayerZero OFT** | Bridge planner | Only documented peers; fees via quoteSend; no fake fill |
| **x402 + EIP-3009** | Pay / Image / Research / FTSO pack | Protected resource → 402 → sign → settle → execute → receipt |
| **BeaconEscrow** | Bound Work | Large creative jobs only |
| **Authorization receipt** | Security Center | Daily budget / pause / allowlist (Redis policy) |

## Coston2 addresses we use (verified against docs / prior deploy)

| Role | Address |
|---|---|
| MockUSDT0 (x402 desk) | `0x6fd8a72a972040f3153894BBd0d829a58f1Fe86c` |
| X402Facilitator | `0x1f409a809cE6e8A4467C1fD40943aC40169f4779` |
| BeaconEscrow | `0x68E29567a9eC60D6ADb71901CE187C22Cc087138` |
| SparkDEX USDT0 | `0xC1A5B41512496B80903D1f32d6dEa3a73212E71F` |
| SparkDEX router | `0x8a1E35F5c98C4E85B36B7B253222eE17773b2781` |
| FXRP (AssetManager) | `0x0b6A3645c240605887a5532109323A3E12273dc7` |
| FXRP OFT Adapter | `0xCd3d2127935Ae82Af54Fc31cCD9D3440dbF46639` |

## Unified lifecycle (product contract)

```
Intent → Detect → Agent → Clarify → Quote → Pay? → Execute → Receipt → Persist → Resume
```

Every agent must follow this. Manual agent pills are shortcuts only.

## What judges should see in 3 minutes

1. Natural language (“swap 1 USDT0”, “logo for Beacon”, “bridge FXRP to Sepolia”)
2. Auto-route to specialized agent
3. Clarification when needed (image brief / bridge amount)
4. Quote with Flare primitive named
5. Real wallet action (SparkDEX txs or EIP-3009 sign)
6. Deliverable + explorer
7. Refresh → conversation restored from Postgres by wallet

## Explicit non-claims

- No Flare Confidential Compute as public production
- No MetaMask “session keys” via Smart Accounts
- No invented OFT destinations
- No fee amounts without on-chain quote
- No payment without immediate resource execution

## Persistence model

Wallet address = user identity.

Tables: `flow_conversations`, `flow_messages`, `flow_activity` (+ existing jobs/receipts/escrow).

LocalStorage is not the source of truth.
