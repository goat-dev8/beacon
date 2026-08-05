# Beacon Productization Research — 2026-08-05

Living evidence baseline for Summer Signal **Bounty 1: Interoperable Asset Products**.

## Decision

**Primary track:** Bounty 1 — Interoperable Asset Products.  
**Target user:** XRPL / Flare user who wants multi-step asset + paid-service workflows without juggling protocols.  
**Product:** Beacon is the AI execution layer for Flare — not a bridge app, not a chatbot catalog.  
**FCC:** Security Center / policy capability only. Simulated TEE must stay labeled simulated. Settlement must work when FCC is unavailable.

## Official sources consulted

| Source | Finding used |
|---|---|
| [DevHub · developer tools Coston2](https://dev.flare.network/network/developer-tools?network=coston2) | RPC, explorer, faucet for Coston2 |
| [DevHub · x402 payments](https://dev.flare.network/fxrp/token-interactions/x402-payments) | MockUSDT0 + EIP-3009; 402 → X-Payment → settle → resource; FXRP EIP-3009 not ready |
| [DevHub · FXRP automint + OFT](https://dev.flare.network/fxrp/oft/fxrp-automint) | Adapter `0xCd3d2127935Ae82Af54Fc31cCD9D3440dbF46639`; Smart Account batch approve+send |
| [DevHub · OFT peers](https://dev.flare.network/fxrp/oft/fxrp-autoredeem#discovering-available-bridge-routes) | BSC 40102, Sepolia 40161, Hyperliquid 40362 |
| [LayerZero · Flare testnet](https://docs.layerzero.network/v2/deployments/chains/flare-testnet) | Flare testnet EID `40294` |
| [DevHub · USDT0→FXRP swap](https://dev.flare.network/fxrp/token-interactions/usdt0-fxrp-swap) | SparkDEX router + FTSO estimate pattern |
| [DevHub · control USDT0 / swap](https://dev.flare.network/smart-accounts/guides/typescript-viem/control-usdt0-ts#swap-usdt0-to-fxrp) | Official SA `0xFE` fee-only path; EOA SparkDEX remains beachhead |
| [DevHub · FAssets swap/redeem](https://dev.flare.network/fassets/developer-guides/fassets-swap-redeem) | Direct mint / redeem honesty |
| [flare-foundation/flare-viem-starter](https://github.com/flare-foundation/flare-viem-starter) | `quoteSend` + executor `extraOptions`; LayerZero Scan tracking |
| Installed Beacon skills | `flare-general`, `flare-fassets`, `flare-ftso`, `flare-smart-accounts`, `flare-fcc`, `flare-fdc` |
| Flare DevHub MCP | `docs_search` / `docs_fetch` for OFT, x402, Smart Accounts |

## Verified Coston2 addresses (Beacon deployment)

| Asset / contract | Address |
|---|---|
| MockUSDT0 (x402) | `0x6fd8a72a972040f3153894BBd0d829a58f1Fe86c` |
| X402Facilitator | `0x1f409a809cE6e8A4467C1fD40943aC40169f4779` |
| BeaconEscrow | `0x68E29567a9eC60D6ADb71901CE187C22Cc087138` |
| FXRP OFT Adapter | `0xCd3d2127935Ae82Af54Fc31cCD9D3440dbF46639` |
| SparkDEX SwapRouter | `0x8a1E35F5c98C4E85B36B7B253222eE17773b2781` |
| Coston2 USDT0 (SparkDEX) | `0xC1A5B41512496B80903D1f32d6dEa3a73212E71F` |

**Token honesty:** MockUSDT0 ≠ Coston2 USDT0. x402 uses MockUSDT0 until FXRP implements EIP-3009.

## New-work boundary

- **Before June 29, 2026:** earlier Beacon Bound Work / escrow scaffolding.  
- **Summer Signal window:** Flow OS, FTSO/SparkDEX live path, x402 agent pay, OFT bridge prepare/execute, execution engine package, wallet-keyed Postgres history, Security policy receipts.

Exact commit cutoff is established from `git log` at submission time.

## Repository contradictions this refactor removes

1. Chat payment resend can omit service identity and re-open the pay catalog after settlement.  
2. Bridge agent planned routes without `quoteSend` / OFT `send` (now prepare+execute).  
3. `IMPLEMENTATION.md` still read as pre-code while production Flow diverged.  
4. Audits marked partial paths Working without settle/DB/explorer proof.  
5. Smart Accounts package used legacy memo assumptions vs current direct-mint + `0xFE`/`0xFF`.

## Non-claims (honesty)

- Do not claim destination OFT fill without LayerZero Scan + destination receipt.  
- Do not claim hardware TEE / FCC production while mode is simulated.  
- Do not invent LayerZero fees — only `quoteSend`.  
- Do not claim Smart Account mint+bridge end-to-end until XRPL → Coston2 → LZ → Sepolia evidence exists. EOA OFT is the hero beachhead.  
- Do not treat localStorage as authenticated wallet history — Postgres is source of truth.

## Judge story (3 minutes)

1. Intent → immutable job → live quote → risk → wallet auth → OFT send → observe → receipt.  
2. Paid image/research: one x402 settle → artifact, no second catalog.  
3. Refresh restores both runs from history.  
4. Security Center shows one blocked over-budget Authorization Receipt.  
5. Close with addresses, explorers, new-work delta, honest limitations.

## Product themes judges reward (applied without naming private projects)

- Private spend/policy gates with verifiable on-chain settlement.  
- Machine-native paid APIs with receipts (x402).  
- One-signature XRPL → Flare asset journeys when Smart Accounts are fully proven.  
- Useful Flare primitives: FXRP, FAssets, SparkDEX, FTSO, LayerZero — not protocol tourism.

## UX productization pass (same day)

| Issue | Root cause | Fix |
|---|---|---|
| Bound Work leaves chat | Links to `/app` / standalone AppPage | `ProductShell` routes: `/flow`, `/flow/desk`, `/flow/security`; `/app` → `/flow/desk` |
| All x402 items say Paid | `inferSettledServiceIds` marked every quote after any media_result | Only settle matching `media_result.serviceId`; UI Unpaid vs Settled |
| Ugly bridge quote text | Raw 18dp fee + markdown narrate | `toFixed(4)` fee display + structured quote card + strip `**` in chat |
| Dark-only product look | Hardcoded white/black | `--p-*` tokens + theme toggle (landing emerald `#39e08a`) |

**Design read:** Flare AI OS product UI for hackathon judges - preserve Beacon brand (Anybody/DM Sans/Space Mono family already in app), emerald accent, dual theme - not a marketing landing redesign inside Flow.
