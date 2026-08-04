# Beacon — Product Gap Analysis

**Date:** 2026-08-05  
**Sources:** Flare DevHub MCP (re-verified), installed flare-* skills, LayerZero Flare testnet OFT peers, Summer Signal criteria (`telegram.md`), live desk screenshots, Coston2 probe evidence.  
**Story target:** Natural language → Flare intelligence → Payment → Execution → Receipt

---

## Judging lens (would mentors get it?)

| Criterion | Beacon today | Gap |
|---|---|---|
| Product usefulness | Swap + escrow desk work | Flow still feels like agent tabs, not one desk |
| Flare integration quality | Real FTSO, SparkDEX, x402, Escrow | Bridge/x402/image paths still demo-ish |
| Technical execution | Swap e2e proven on screenshots | Orphan “Pay $0.10”; creative always Bound Work |
| Clarity | Rails labeled in footer | Model badge / repeated clarify dilute story |

---

## Feature-by-feature

| Feature | Why it exists | Flare primitive | Real user problem? | Mentor-ready? | Status |
|---|---|---|---|---|---|
| FTSO Signals | Price truth for decisions | **FTSO** | Yes — traders need live bias | Yes if tied to trade action | **Working** |
| Swap USDT0→FXRP | Acquire FXRP on Coston2 | **FAssets FXRP + SparkDEX** | Yes | Yes (screenshots: approve→swap→explorer) | **Working** |
| Trade desk | Signal → act | **FTSO** (+ optional SparkDEX) | Yes | Partial | **Partial** |
| Bridge | Move FXRP cross-chain | **LayerZero OFT + FAssets** | Yes | No — asks clarify instead of listing peers | **Partial** |
| Pay x402 | Micropay for agent resources | **x402 / EIP-3009** | Yes | No — generic $0.10 with no resource | **Placeholder product** (rails real) |
| Bound Work | Escrowed creative jobs | **Escrow + EIP-3009** | Yes | Yes for large jobs | **Working** |
| Image / Video | Creative generation | Escrow / x402 for settle | Yes | No — every image forced to Bound Work | **Partial** |
| Research | Packs with citations | x402 or Escrow | Yes | Partial | **Partial** |
| Security Center | Budget not free rein | App policy (FCC later) | Yes | Yes if connected + receipt shown | **Partial** |
| Smart Accounts | XRPL-native control | **Smart Accounts** | XRPL users | Must not claim for MetaMask EOAs | **Honest stub** |
| FCC policy | Private spend rules | **FCC** (not public prod) | Yes | Label simulated / roadmap | **Honest / planned** |
| FDC | Attest external facts | **FDC** | Settlements / bridges | Not on critical path | **Scaffold** |

---

## Screenshot-driven defects

1. **Generic x402 $0.10** — payment without resource/provider/runtime → fails product story.
2. **Bridge “ask again”** — user asked for all bridges; should list Coston2 OFT peers (BSC, Sepolia, Hyperliquid) from docs.
3. **Image → only Bound Work** — logo-sized jobs should be instant x402 → generate.
4. **Tab farm** — agents look disconnected; need one intent pipeline with shared receipt language.
5. **Wallet reconnect** — Security Center shows Connect after reload.
6. **No persistent history** — refresh loses conversation / swaps / payments.

---

## Target architecture (one pipeline)

```
Intent → Classifier → Agent → Quote → Payment decision → Execution → Receipt
```

| Agent | Small / instant | Large / escrow |
|---|---|---|
| Swap / Trade | Quote → wallet approve+swap → explorer | — |
| Bridge | Route card (honest OFT peers) → plan | OFT send when wired |
| Image / Research (small) | Service quote → x402 → result | — |
| Video / multi-asset creative | — | Bound Offer → Escrow → Accept |
| Signals premium | x402 → richer pack | — |

---

## Explicit non-claims

- FCC is **not** fully public production — policy is Redis-enforced; do not claim TEE attestation in UI.
- Smart Accounts ≠ MetaMask session keys.
- MockUSDT0 (desk/x402) ≠ SparkDEX Coston2 USDT0.
- Bridge UI lists **documented** OFT peers; does not fake a completed bridge without a tx.

---

## Ship order (this pass)

1. Gap + audit docs  
2. Bridge route catalog (no endless clarify)  
3. x402 service quotes (provider/price/reason/ETA)  
4. Small image → x402 path vs large → Bound Work  
5. Wallet session + conversation memory  
6. Agent-specific system prompts + Flare badges  
7. Fix model badge to requested model family  
8. Push + verify
