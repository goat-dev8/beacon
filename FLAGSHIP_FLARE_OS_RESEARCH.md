# Beacon Flagship Architecture — Official Flare Re-Verification

**Date:** 2026-08-05  
**Mode:** Hackathon / production flagship (no invented APIs)  
**Sources:** Flare DevHub MCP (`docs_search` / `docs_fetch`), installed flare-* skills, flare-foundation docs links, LayerZero Flare testnet deployments, prior Coston2 probes.

---

## Hard truths (verified again)

| Claim | Official status | Beacon response |
|---|---|---|
| FCC TEE private policy in production | FCC **not yet a fully public production system** ([FCC overview](https://dev.flare.network/fcc/overview)) | Enforce spend policy **server-side + Redis** now; design for FCE later; never claim hardware TEE attestation in UI |
| MetaMask-free SparkDEX via Smart Accounts | Smart Accounts = **XRPL → PersonalAccount** via MasterAccountController + operator + FDC Payment proof | EOA users: MetaMask approve+swap; XRPL users: future custom instruction path |
| Agent gets budget not private key | Pattern exists in ecosystem demos; FCC public path still maturing | Beacon **Security Center + Authorization Receipt** UX; x402 for micropays |
| LayerZero bridge “one click” on Coston2 for any route | FXRP OFT + automint docs exist for specific routes (Sepolia / Hyperliquid) | Bridge agent = honest planner unless OFT send is fully wired for that route |
| SparkDEX USDT0→FXRP | Documented; Coston2 USDT0 `0xC1A5…`, router `0x8a1E…`, fee 500 | Real prepare + wait receipt |

---

## Five layers → Flare OS mapping

### Layer 1 — AI Workspace
**Protocols:** none on-chain for generation; settlement uses **Escrow + x402**.  
**Models:** Claude Opus 5 / GPT-5.6 via platform keys (never exposed). Media: Flux / Remotion / OpenMontage cascade.

### Layer 2 — Personal Beacon Wallet
**Closest official rails:**
1. **EOA + EIP-3009 x402** — one typed-data signature; settler pays gas ([x402 payments](https://dev.flare.network/fxrp/token-interactions/x402-payments)).
2. **SparkDEX** — approve once (optionally max) + swap; wait receipts.
3. **Smart Accounts (XRPL)** — PersonalAccount + Custom Instruction for XRPL-native users ([control USDT0](https://dev.flare.network/smart-accounts/guides/typescript-viem/control-usdt0-ts)).

**Not supported today for MetaMask EOAs:** session keys that silently sign Uniswap calls.

### Layer 3 — Private Spending Policy
**Target:** FCC FCE evaluating allowlists/budgets inside TEE.  
**Now (honest):** Redis-backed policy per wallet, enforced on desk approve + agent chat + x402 amounts. UI shows Authorization Receipt (settled spends, remaining budget).  
**Later:** migrate evaluation into FCE when FCC production is public.

### Layer 4 — Bound Offer
**Protocols:** Escrow (BeaconEscrow) + MockUSDT0 EIP-3009.  
Offer seals: price, rubric hash, brief hash, SLA estimate, provider route, policy compliance check.

### Layer 5 — Acceptance Engine
**Protocols:** Escrow release/refund; optional FDC later for external facts.  
L1 objective → L2 LLM judge (separate model) → L3 brand → human look if needed → receipt.

---

## Primitive → product surface

| User action | Primitive |
|---|---|
| Live prices / trade bias | **FTSO** |
| USDT0 → FXRP | **FAssets FXRP + SparkDEX** |
| Pay for agent / lock job | **x402 / EIP-3009 + Escrow** |
| Creative job settle | **Escrow + Acceptance + Receipt** |
| Bridge FXRP | **LayerZero OFT** (route-specific) |
| XRPL-controlled Flare actions | **Smart Accounts** |
| Private policy / secrets | **FCC** (build-ready, not public prod) |
| Attest external payment | **FDC** |

---

## Ship criteria for this upgrade

1. Policy enforced on desk approve + chat (not UI-only).
2. Authorization Receipt UX in Security Center.
3. Conversational creative brief (duration/aspect/voice…) before Bound Work.
4. Trade desk uses FTSO for swap / no-swap narrative.
5. Swap path remains real receipts (already).
6. Bridge remains honest about OFT route requirements.
7. Research file + history.md updated.
8. Pushed to GitHub; desk + API redeployed.

No mock hashes. No “coming soon” buttons. Limitations documented in-product where needed.
