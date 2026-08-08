# Agent Jobs “Not charged” — research & fix plan

**Date:** 2026-08-08  
**Symptom:** Documents job (“docs for math school”) → Pay from Safe → result **Not charged** / escrow refunded.

## 1. Reproduction (production)

Job `0540206f-aa8b-4565-9735-2f453f6099d4`:

| Step | Result |
|------|--------|
| Quote | FIT · $0.006 · gpt-5.6-sol |
| `approve-safe` | AUTHORIZED · spend + `lockPrepaid` on Coston2 |
| Pipeline | `GENERATING` → **`generation_failed` → FAILED** |
| Acceptance | **null** (never ran) |
| Escrow | refund via refuse path |

User UI “Not charged” is correct for refund, but the **root cause is generation abort**, not quality FAIL.

## 2. Code root cause

`packages/pipeline/src/index.ts` `generateContent`:

- With `AI_REQUIRE_REAL=true`, AgentRouter / proxy errors on **documents** (non-media) **rethrow**.
- Worker maps that to `generation_failed` → `refuse:` → escrow refund.
- `chatForRole("generator")` only soft-retries HTTP 405/429/502/503/504; other failures abort immediately.
- Generator fallbacks lacked **gpt-5.6-sol** (quote model that works in production).

## 3. Flare protocol notes (official)

| Topic | Source | Beacon implication |
|-------|--------|-------------------|
| x402 + EIP-3009 MockUSDT0 | [x402 payments](https://dev.flare.network/fxrp/token-interactions/x402-payments) | Wallet fund / wallet job path stays EIP-3009 |
| Gasless auth | [EIP-3009 guide](https://dev.flare.network/network/guides/gasless-usdt0-transfers) | Signer must equal `from` — Safe jobs use prepaid transfer + `lockPrepaid` |
| Coston2 tools / faucet | [Developer tools](https://dev.flare.network/network/developer-tools?network=coston2) | Chain 114 · C2FLR gas · test USDT0 |
| Smart Accounts | [Overview](https://dev.flare.network/smart-accounts/overview) | XRPL personal accounts ≠ MetaMask Beacon Safe |
| FAssets / LZ | FAssets + LayerZero docs | Flow rails only; Jobs use MockUSDT0 escrow |

## 4. Product inspiration (external, not named in product)

Judge-loved prepaid Safe / policy spend patterns: fund once, agent spends in caps, escrow/receipt honesty. Beacon maps that to Agent Jobs Safe prepaid + Coston2 BeaconEscrow.

## 5. Fixes to ship

1. **Generator resilience:** fallbacks include `gpt-5.6-sol`; retry more transient errors; text services never hard-fail — expand brief into real markdown deliverable.
2. **Documents prompt:** short briefs (“docs for math school”) expand into syllabus / lesson / worksheet / parent note pack.
3. **Workers:** on generation soft-success still run acceptance; refuse path writes **refund receipt** so timeline seals.
4. **UX:** FlareRails Safe steps (`vault.execute` + `lockPrepaid`); failure copy shows **why** (generation vs quality); show acceptance notes; receipt links.
5. **E2E:** documents Safe job → CLOSED/PASS or NEEDS_LOOK with deliverable visible.

## 6. Success criteria

- Documents brief completes without spurious “Not charged” from AI blips.
- Safe pay remains MetaMask-free per job.
- Refund/pass both seal a receipt with explorer tx.
- History + this file updated; push when green.
