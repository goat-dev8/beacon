# Flare Final Implementation Plan — Beacon

**Date:** 2026-08-10  
**Network:** Coston2 (chain 114)  
**Commit baseline:** `1e62a74`  
**Honesty labels:** REAL | VERIFIED | PARTIAL | SIMULATED | STUB | BLOCKED | NOT_AVAILABLE

---

## Scoring note

Priority = judge-visible Flare depth × feasibility × low regression risk to Jobs/Chat/Safe/x402.

---

## 1. FCC

| Field | Value |
| --- | --- |
| Current state | SIMULATED_TEE + on-chain PRODUCTION (status 2); ALLOW/DENY signed results captured |
| Official architecture | InstructionSender → TeeExtensionRegistry → providers → ext-proxy → TEE → signed ActionResult |
| Beacon implementation | `packages/fdc/src/fcc.ts`, InstructionSender `0x11bFc67F…`, TEE `0x6516cE58…`, Manager `0x1a9C4A0f…` |
| Gap | EXT_PROXY is trycloudflare (ephemeral). Render lacks live EXT_PROXY. Result poll not on production API. |
| Required | Keep tunnel alive for demo; document named/reserved tunnel as permanent; re-register on URL change (`rRap`); optional Render env for TEE_ID/FLARE_TEE_MANAGER only |
| Contracts | FlareTeeManager, InstructionSender (deployed) |
| Backend | `/v1/fcc/lifecycle`, `/v1/fcc/policy/evaluate` (opt-in submit) |
| Frontend | Safe badge: CONFIDENTIAL POLICY (SIMULATED TEE) |
| Tests | Unit + live scripts `fcc-e2e-sayhello.ts` |
| Evidence | `docs/evidence/fcc-tee-production.json`, `fcc-instruction-result.json`, `fcc-deny-path.json` |
| Deploy | Do **not** pin trycloudflare on Render |
| Risk | Dead hostname → stuck INITIALIZED / 404 results |
| DoD | Status 2 on-chain; ALLOW+DENY signed results; honest SIMULATED label |

---

## 2. FDC

| Field | Value |
| --- | --- |
| Current state | REAL lifecycle + AddressValidity on-chain VERIFIED (staticCall) |
| Official | prepare → FdcHub → Relay finalize → DA proof → FdcVerification.verify* |
| Gap | Wire verify result into a Beacon policy decision surface more visibly; optional state-changing consumer contract |
| Required | Evidence + API exposure already; ensure Flow/policy can show VERIFIED |
| Evidence | `docs/evidence/fdc-address-validity-verify.json` |
| DoD | onChainVerified true with explorer round link |

---

## 3. FTSO

| Field | Value |
| --- | --- |
| Current state | REAL reads + Safe swap execution guard |
| Gap | Chrome E2E of ALLOW/BLOCK paths; evidence file |
| Required | Capture live `/v1/ftso/guard` evidence; verify UI quotes use FTSO |
| DoD | Guard BLOCK on stale/deviation; ALLOW on fresh |

---

## 4. FAssets

| Field | Value |
| --- | --- |
| Current state | PARTIAL — status + redeemAmount/lots/tag prepare + honest track; mint docs_handoff |
| Official | Direct mint → Core Vault; redeemAmount/redeemWithTag; FIFO queue; async agent XRPL pay |
| Gap | Full COMPLETE blocked without funded FXRP signer + agent XRPL payment evidence |
| Required | Runtime AssetManagerFXRP; queue read; redeem prepare; track request IDs |
| Risk | Incomplete XRPL agent pay → must not claim COMPLETE |
| DoD | Maximum real path + evidence OR exact blocker documented — see `docs/evidence/fassets-*.json` |

---

## 5. Smart Accounts

| Field | Value |
| --- | --- |
| Current state | STUB — separate from Beacon Safe |
| Decision | Keep STUB this pass (priority FCC/FDC/FTSO/FAssets/E2E) |
| DoD | Honest STUB in README/MASTER; no Safe rename |

---

## 6. LayerZero / OFT

| Field | Value |
| --- | --- |
| Current state | REAL source OFT + tracking |
| Gap | Chrome verify quote/execute/explorer; dest proof honesty |
| DoD | Production Flow shows prior OFT txs; no fake dest complete |

---

## 7. Contract Registry

| Field | Value |
| --- | --- |
| Current state | REAL — `0xaD67FE66…6019` |
| DoD | FDC/FTSO/FAssets resolve via registry where possible |

---

## 8–10. Agent Jobs / Safe / x402 + Flare

| Integration | State | Gap | DoD |
| --- | --- | --- | --- |
| Jobs | REAL escrow | Regression only | Create/approve/history still work |
| Safe | REAL per-wallet | FCC badge honesty | Deposit/policy/pause work |
| x402 | REAL EIP-3009 | Evidence envelope | Unpaid→pay→receipt |

---

## Implementation order (this pass)

1. Write this plan ✓  
2. Re-verify FCC ALLOW/DENY while proxy up  
3. FTSO evidence + Chrome  
4. FAssets max real (subagent)  
5. Full Chrome production matrix  
6. Deploy/docs/push  
7. Production re-verify  

## Explicit non-goals this pass

- Hardware Confidential Space  
- Renaming Safe as Smart Account  
- Fake FAssets COMPLETE without XRPL pay  
- Pinning trycloudflare on Render as permanent FCC architecture  
