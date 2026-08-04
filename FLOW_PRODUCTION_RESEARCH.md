# Beacon Flow — Production Conversation & Execution Research

**Date:** 2026-08-05  
**Trigger:** Chat dumps HTML/405, `amountIn=0`, MetaMask signs with no receipt UX, constant wallet popups.

---

## 1. Chat defects (root causes)

| Bug | Cause | Fix |
|---|---|---|
| `amountIn=0` | Regex `(\d+)` matched trailing **`0` in `USDT0`** | Amount parser must not match digits inside token tickers |
| HTML in chat | AgentRouter **405** body (`<!doctype html>`) concatenated into assistant text | Sanitize provider errors; never surface HTML/JSON |
| Instant calldata | One-shot tool runner | Multi-turn phases: clarify → quote → confirm → execute |
| `local-heuristic` | AI narrate failed silently | Route GPT/Claude with clean fallback copy; show model badge |

---

## 2. Official Flare rails (no invented APIs)

### Payments (minimize popups) — **EIP-3009 / x402** ✅ documented
- [x402 on Flare](https://dev.flare.network/fxrp/token-interactions/x402-payments)
- [Gasless USDT0](https://dev.flare.network/network/guides/gasless-usdt0-transfers)
- User signs **once** off-chain; Beacon settler pays gas and settles.
- **Best production popup reduction for Beacon MockUSDT0 / desk pay.**

### Swaps — **SparkDEX Uniswap V3** ✅ documented
- [USDT0→FXRP swap](https://dev.flare.network/fxrp/token-interactions/usdt0-fxrp-swap)
- [Control USDT0 (Smart Accounts TS)](https://dev.flare.network/smart-accounts/guides/typescript-viem/control-usdt0-ts#swap-usdt0-to-fxrp)
- [FAssets swap/redeem](https://dev.flare.network/fassets/developer-guides/fassets-swap-redeem)
- Coston2: USDT0 `0xC1A5…`, router `0x8a1E…`, fee `500`, FXRP from `AssetManagerFXRP.fAsset()`.
- EOA flow still needs **approve + exactInputSingle** (1–2 MetaMask confirms) unless allowance already infinite.
- **Production UX:** conversational quote → single Confirm card → wait receipts → show explorer links + refresh balances.

### Flare Smart Accounts — **XRPL-origin AA** ⚠️ not MetaMask session keys
- Docs: [Smart Accounts overview](https://dev.flare.network/smart-accounts/overview), [Custom Instruction](https://dev.flare.network/smart-accounts/custom-instruction)
- Each **XRPL address** maps to a Flare personal account; instructions via XRPL Payment + FDC + operator.
- **Does NOT** provide EVM “session keys” or “budget without private key” for MetaMask EOAs out of the box.
- AgentVault-style “budget not private key” (FCC) is a **separate** FCC/TEE pattern ([fce-weather-insurance](https://github.com/flare-foundation/fce-weather-insurance), Summer Signal narrative) — requires TEE extension, not a drop-in for SparkDEX EOA swaps today.
- [Developer tools Coston2](https://dev.flare.network/network/developer-tools?network=coston2)
- [LayerZero Flare Testnet](https://docs.layerzero.network/v2/deployments/chains/flare-testnet)

### Honest architecture for Beacon (EVM users)

| Goal | Official path | Popup count |
|---|---|---|
| Pay for agent/API | x402 + EIP-3009 | **1 signature** (typed data), settler txs |
| Swap USDT0→FXRP | SparkDEX V3 | **1–2** MetaMask txs (approve if needed + swap) |
| XRPL-native users | Smart Accounts custom instruction registering SparkDEX calls | XRPL payment (no MetaMask) — future room |
| Policy budget / revoke | App-level Security Center + optional FCC later | Off-chain policy now; FCC when extension live |

**Cannot claim:** unlimited automatic MetaMask-free SparkDEX swaps with only Flare Smart Accounts for EOA wallets — that is not what the docs provide.

### Why automatic MetaMask-free SparkDEX is not possible today (EOA)
1. SparkDEX router calls require an EVM signature from the token owner (or a contract the owner controls).
2. Flare Smart Accounts docs bind **XRPL → Flare personal account**, not “MetaMask session key for arbitrary Uniswap routers.”
3. EIP-3009 covers **token transferWithAuthorization**, not Uniswap `exactInputSingle`.
4. Closest production path: (a) x402 for Beacon services, (b) one approve with high allowance + subsequent swap-only popups, (c) future XRPL Smart Account custom instructions for XRPL-origin users.

---

## 3. Conversation engine contract

Phases per intent: `idle → clarify → quote → await_confirm → executing → settled | failed`

Intents: `swap`, `bridge`, `signals`, `pay`, `image`, `video`, `research`, `desk`, `general`

Rules:
- Never emit raw calldata / HTML / stack traces in `text`
- Cards carry structured UI only
- Model display: `Claude Opus 5` / `GPT-5.6` — never “AgentRouter”
- Finance intents prefer GPT-5.6; writing/research prefer Claude Opus 5

---

## 4. Security Center (first-class)

Persisted per wallet (API + Redis):
- dailySpendUsdt0, perJobLimitUsdt0
- allowedAgents[], allowedChains `[114]`
- maxImageCost, maxVideoSeconds
- emergencyPause, sessionExpiryHours
- revokeAll (clears session + approvals guidance)

Enforced before chat when Redis policy exists (pause + allowed agents).

UI: `/flow/security`

---

## 5. Implementation order

1. ✅ Research file (this doc)
2. ✅ Multi-turn conversation engine + sanitize
3. ✅ Swap quote → confirm → wait receipt + balances
4. ✅ Security Center API + UI
5. Deploy / verify Coston2 + `/flow`

---

## 6. User-agent roadmap (official primitives only)

**Phase A (now):** EOA + Security Center policies + x402 for Beacon pays + SparkDEX with receipt UX.  
**Phase B:** Optional infinite/router-scoped allowance with clear revoke UX (still 1 swap popup).  
**Phase C (XRPL users):** Flare Smart Account personal account + Custom Instruction registering SparkDEX paths.  
**Phase D (FCC):** TEE AgentVault budget envelopes when confidential compute track is production-ready — do not fake this in UI today.
