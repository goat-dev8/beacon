# Coston2 Safe Swap Research — 2026-08-07

Living research notes for Beacon’s testnet swap path. No secrets. Product copy must not name third-party hackathon demos.

## Problem we hit

Flow Swap showed **COSTON2** in the UI badge but forced **Switch MetaMask to Flare Mainnet** + Approve+Swap. After funding Beacon Safe, the agent still could not spend without MetaMask.

## Official docs (Flare DevHub MCP + developer guides)

### SparkDEX USDT0 → FXRP

- Official EOA guide is **Flare Mainnet SparkDEX** (SwapRouter `0x8a1E…`, QuoterV2, fee 500).
- Docs: https://dev.flare.network/fxrp/token-interactions/usdt0-fxrp-swap
- Smart-accounts Coston2 guide (`control-usdt0-ts`) lists the **same** SwapRouter address while using Coston2 faucet USDT0 `0xC1A5…`. Live Coston2 RPC still has **empty bytecode** at that router — docs are ahead of / misaligned with Coston2 DEX deploy.
- Conclusion: **cannot** honestly execute SparkDEX on Coston2 today.

### MockUSDT0 vs faucet USDT0

- Beacon Safe holds **MockUSDT0** `0x6fd8…` (EIP-3009 deposit; **no** `approve` / `transferFrom` selectors on live bytecode).
- Faucet USDT0 `0xC1A5…` is separate; x402/escrow/Safe use MockUSDT0.
- Vault spend must use `vault.execute(token, transfer(desk, amount))` — pull patterns are impossible on live MockUSDT0.

### FAssets swap+redeem (Coston2)

- Guide uses **BlazeSwap** Uniswap V2 router `0x8D29…` for WC2FLR→FXRP then AssetManager redeem.
- Different pair/token than MockUSDT0 Safe budget — not a drop-in for funded Safe MockUSDT0→FXRP.

### LayerZero / OFT

- FXRP OFT adapter on Coston2 for bridge peers (Sepolia / Hyperliquid demos). Bridge stays Coston2-honest in Beacon; swap Mainnet push was the bug.

### Developer tools

- https://dev.flare.network/network/developer-tools?network=coston2 — Coston2 RPC/explorer/faucet for testnet desk.

## Product pattern (inspired by judge-loved prepaid agent spend)

Without naming external projects in product files:

1. Owner funds a non-custodial pool (Beacon Safe).
2. Owner sets spend policy (per-tx + rolling budget + allowlists).
3. Executor agent spends within policy — **user does not re-sign every trade**.
4. Honesty: policy is on-chain (Beacon), not private TEE policy; SIMULATED_TEE remains labeled when used elsewhere.

## Beacon fix shipped

| Piece | Detail |
| --- | --- |
| Contract | `BeaconCoston2SwapDesk` — FTSO-synced MockUSDT0→FXRP inventory desk |
| Address | `0x36c17ca6Aa2b61b13f7c4B5A59629320a8B4dF29` |
| Safe | `0xc7C6C06Dd59173dBAf8382627d6A483Ca53AAF33` |
| Flow | `execute(transfer → desk)` then `desk.fulfill(recipient)` |
| API | `POST /v1/vault/safe-swap/prepare` · `POST /v1/vault/safe-swap/execute` |
| Agent | Prefer Safe path on `CHAIN_ID=114` for USDT0→FXRP; no Mainnet switch CTA |
| UI | **Execute from Beacon Safe** (no MetaMask) |

### Smoke test (on-chain)

- Amount: **0.5 MockUSDT0 → ~0.48253 FXRP**
- Spend: https://coston2.testnet.flarescan.com/tx/0x07f3139f214f29cf2ffdda65b624f8c7db828222e7e3195498a5f36904913d3f
- Fulfill: https://coston2.testnet.flarescan.com/tx/0x2c906ed221bea788e639af578794383916b375dbe3e243c97292072ba84d2a2f
- Recipient: test wallet `0x3be5…c794`
- Policy after sync: maxSpendPerTx **10**, rolling **50**, token `transfer` allowlisted

## Honesty rules

- Never present FTSO mid as SparkDEX QuoterV2 fill.
- Never claim Coston2 SparkDEX when router bytecode is empty.
- SparkDEX Mainnet remains optional EOA path for non-Safe pairs (WFLR etc.).
- Desk rate is FTSO-synced + fee bps; inventory-limited — seed FXRP when empty.

## Follow-ups

- Render env must include `BEACON_SWAP_DESK_ADDRESS`.
- Re-seed desk FXRP when inventory low.
- Optional: BlazeSwap WC2FLR path as separate FAssets card (not MockUSDT0 Safe).
