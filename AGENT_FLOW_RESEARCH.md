# Beacon Agent Flow — Flare Research Results

**Date:** 2026-08-04  
**Goal:** Anvita Flow–style multi-agent desk on Beacon, **100% Flare Coston2**, paid with **x402 / EIP-3009**, real on-chain tools (not mocks for settlement).  
**Sources:** installed `flare-ai-skills`, Flare DevHub MCP, [flare-foundation](https://github.com/flare-foundation), [Developer Tools (Coston2)](https://dev.flare.network/network/developer-tools?network=coston2), [LayerZero Flare Testnet](https://docs.layerzero.network/v2/deployments/chains/flare-testnet), [FAssets swap+redeem](https://dev.flare.network/fassets/developer-guides/fassets-swap-redeem), [Control USDT0 / swap USDT0→FXRP](https://dev.flare.network/smart-accounts/guides/typescript-viem/control-usdt0-ts#swap-usdt0-to-fxrp), [x402 payments](https://dev.flare.network/fxrp/token-interactions/x402-payments), UI reference [Anvita Flow](https://flow.anvita.xyz/agent/chat).

---

## 1. Product pattern (Anvita → Beacon)

| Anvita Flow | Beacon Flow (Flare) |
|---|---|
| Left icon rail + agent rooms | Beacon rail + Flare agent rooms |
| `@Agent` mentions + pills | `@signals` `@swap` `@bridge` `@pay` `@trade` `@desk` |
| Action cards (Top Up) | Action cards: Pay x402 · Confirm swap · Mint USDT0 · Open explorer |
| Built-in tools | **Real Coston2 tools** + AgentRouter narration |
| Credits | **USDT0 via x402** (Beacon MockUSDT0 escrow rails) + faucet mint |

Honesty rule from Flare skills: skills are **docs only** — Beacon must execute txs in **user wallet** or **server settler with deployer key** for x402 settle only.

---

## 2. What is already real on Beacon

| Rail | Status | Notes |
|---|---|---|
| Coston2 chain 114 | ✅ | Boot-gated `assertFlareRequired` |
| MockUSDT0 + X402Facilitator + BeaconEscrow | ✅ Live | Desk Bound Work pay-on-pass |
| EIP-3009 TransferWithAuthorization | ✅ | MetaMask typed data |
| AgentRouter (Claude / GPT-5.6 Sol) | ✅ | Chat / judge / quotes |
| Cloudflare Flux media | ✅ | Image + motion MP4 |
| Flare AI Skills installed | ✅ | `.cursor/skills/flare-*` |
| Flare DevHub MCP | ✅ | `docs_search` / `docs_fetch` |

---

## 3. Agent catalog — what “real” means on Coston2

### `@signals` — FTSO price / trade signals (REAL — live probe 2026-08-04)

- Registry: `0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019`
- `FtsoV2`: `0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d`
- `getFeedsById` (view) returned live:
  - FLR/USD ≈ **0.00610**
  - BTC/USD ≈ **64252**
  - XRP/USD ≈ **1.0806**
  - ETH/USD ≈ **1876.67**
- Docs: [FTSO feeds](https://dev.flare.network/ftso/feeds), feed consumer pattern in JS/Solidity guides.
- Agent UX: card with live prices + simple signal text (momentum vs prior sample in Redis). Premium pack can require x402.

### `@pay` — x402 agent micropay (REAL)

- Protocol: HTTP 402 + EIP-3009 + Facilitator `verifyPayment` / `settlePayment`
- Docs: [x402 Payment Protocol](https://dev.flare.network/fxrp/token-interactions/x402-payments)
- Beacon uses **MockUSDT0** `0x6fd8a72a…` + Facilitator `0x1f409a80…` (desk rails).
- Flow: chat resource returns 402 → wallet signs → `X-Payment` header → settle → unlock premium agent turn.
- Aligns with Flare Summer Signal / AgentVault narratives (x402 + agents).

### `@swap` — USDT0 → FXRP on SparkDEX (REAL calldata; user signs)

Addresses (Coston2, from [Control USDT0](https://dev.flare.network/smart-accounts/guides/typescript-viem/control-usdt0-ts) + registry probe):

| Asset | Address |
|---|---|
| USDT0 (Coston2 faucet / SparkDEX) | `0xC1A5B41512496B80903D1f32d6dEa3a73212E71F` |
| FXRP (`AssetManagerFXRP.fAsset()`) | `0x0b6A3645c240605887a5532109323A3E12273dc7` |
| SparkDEX Uniswap V3 SwapRouter | `0x8a1E35F5c98C4E85B36B7B253222eE17773b2781` |
| Pool fee | `500` (0.05%) |
| WNat / WC2FLR | `0xC67DCE33D7A8efA5FfEB961899C73fe01bCe9273` |

**Critical distinction:** Beacon **MockUSDT0** (escrow/x402) ≠ Coston2 **USDT0** used on SparkDEX. UI must label both. Swap agent uses **real USDT0**; Pay agent uses **MockUSDT0**.

Docs: [Swap USDT0 to FXRP](https://dev.flare.network/fxrp/token-interactions/usdt0-fxrp-swap), [Swap and Redeem FAssets](https://dev.flare.network/fassets/developer-guides/fassets-swap-redeem).

### `@bridge` — LayerZero / OFT (REAL infra; FXRP OFT mainly mainnet)

- LayerZero V2 listed for Flare in [Developer Tools](https://dev.flare.network/network/developer-tools?network=coston2) and [LZ Flare Testnet](https://docs.layerzero.network/v2/deployments/chains/flare-testnet).
- FXRP OFT adapter / Stargate paths documented for **mainnet** multi-chain ([FXRP OFT](https://dev.flare.network/fxrp/oft)).
- **Coston2 honesty:** agent ships **bridge intent card** (EID, docs, Stargate/LZ links, checklist). Full OFT `send` only when destination OFT + liquidity verified for that pair — do not fake success.

### `@trade` — signals + swap suggestion (COMPOSITE REAL)

1. Read FTSO feeds  
2. Heuristic bias (e.g. XRP vs FLR relative move)  
3. Offer `@swap` card if user wants size  
4. Optional x402 for “premium trade brief” (AgentRouter narrative)

### `@desk` — Bound Work jobs (EXISTING REAL)

- Deep-link to `/app` image/video/docs with escrow pay-on-pass.

### FCC / Smart Accounts (NEXT, not fake)

- FCC simulated TEE already flagged on `/health` (`simulatedTee: true`).
- Smart Accounts USDT0 control via XRPL `0xFE` instructions: documented; wire later as `@smart` room.
- Skills: `flare-fcc-skill`, `flare-smart-accounts-skill`.

---

## 4. Developer tools map (Coston2)

From DevHub + foundation org:

- **RPC:** `https://coston2-api.flare.network/ext/C/rpc`
- **Explorer:** https://coston2-explorer.flare.network
- **Faucet:** https://faucet.flare.network/coston2
- **Bridges (ecosystem):** LayerZero V2, Stargate V2, zkBridge
- **DEX pattern:** SparkDEX Uniswap V3
- **Oracles:** FTSO v2
- **Interop assets:** FAssets FXRP + OFT story
- **Repos:** wagmi / RainbowKit / MetaMask (Beacon already MetaMask + viem)

Repos: [flare-foundry-starter](https://github.com/flare-foundation/flare-foundry-starter), [flare-hardhat-starter](https://github.com/flare-foundation/flare-hardhat-starter), [fassets](https://github.com/flare-foundation/fassets), [flare-smart-accounts](https://github.com/flare-foundation/flare-smart-accounts), [tee-proxy](https://github.com/flare-foundation/tee-proxy), [developer-hub](https://github.com/flare-foundation/developer-hub).

---

## 5. Architecture freeze (Beacon Flow)

```
/flow  →  Anvita-like agent chrome (dark desk, mint signal)
   │
   ├─ GET  /v1/agents              catalog
   ├─ POST /v1/agents/chat         AgentRouter + tool routing (+ optional x402)
   ├─ GET  /v1/agents/signals      FTSO live
   ├─ POST /v1/agents/swap/prepare USDT0→FXRP calldata
   └─ GET  /v1/agents/pay/quote    x402 requirement for premium
```

**Payment policy**
- Free: general chat (rate-limited), FTSO signal peek  
- Paid (x402): premium trade brief, multi-feed signal pack, bridge planner deep report  

**Never**
- Auto-broadcast swap/bridge without MetaMask confirm  
- Pretend LayerZero bridge succeeded without tx hash  
- Mix MockUSDT0 balances into SparkDEX swap UI without labels  

---

## 6. UI/UX direction

Inspired by [Anvita Flow](https://flow.anvita.xyz/agent/chat):

1. Narrow icon rail (Beacon home, Desk, Flow, Explorer)  
2. Agent rooms list (General, Signals, Swap, Bridge, Pay, Trade, Desk)  
3. Main transcript + **action cards**  
4. Agent pills above composer  
5. `@` mentions  
6. Wallet chip + Coston2 + USDT0 balances (Mock + real)  

Beacon brand: mint `#39e08a`, dusk ink, Space Mono labels — dark shell for Flow only (`/flow`), keep Bound Work desk light.

---

## 7. Implementation checklist

- [x] Research file (this document)  
- [ ] Shared FTSO + swap prepare helpers  
- [ ] API agent routes + x402 gate  
- [ ] `/flow` UI  
- [ ] history.md update  
- [ ] Deploy + Chrome smoke  

---

## 8. Verdict

Building an Anvita-style **Flare agent OS** on Beacon is credible for the hackathon if we lead with:

1. **x402 pay** (already native)  
2. **FTSO signals** (proven live)  
3. **SparkDEX USDT0→FXRP** (user-signed, official addresses)  
4. **Bridge** as honest LZ/OFT planner until testnet OFT path is verified  
5. **Desk** for escrow creative jobs  

That matches Flare DevRel emphasis: **x402 + real Flare primitives + useful product**, not superficial chain badges.
