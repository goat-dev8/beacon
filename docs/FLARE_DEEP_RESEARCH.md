# Flare Deep Research — Beacon (Coston2)

**Status:** Phase 0 research artifact (docs only; no protocol changes in this file)  
**Honesty labels:** `REAL` | `SIMULATED` | `STUB` | `NOT AVAILABLE`  
**Rule:** Do not invent contracts, APIs, or transaction hashes. Cite official sources and repo-validated paths only.

---

## 1. Purpose

This document audits what Beacon **actually runs today** on Coston2 against what Flare’s official stack offers, what is stubbed or simulated, and which architectures are recommended vs rejected for a Flare-native evolution of Beacon.

Companion artifacts:

| Document | Role |
| --- | --- |
| [`FLARE_INTEGRATION_GAP_MATRIX.md`](./FLARE_INTEGRATION_GAP_MATRIX.md) | Weighted P0–P3 scoring and gap table |
| [`FLARE_NATIVE_BEACON_ARCHITECTURE.md`](./FLARE_NATIVE_BEACON_ARCHITECTURE.md) | Current vs target architecture + trust boundaries |
| [`FLARE_IMPLEMENTATION_PLAN.md`](./FLARE_IMPLEMENTATION_PLAN.md) | Phased work, acceptance gates, rollbacks |

---

## 2. Official sources (cite these)

| Topic | URL | Honesty note |
| --- | --- | --- |
| FTSOv2 overview | https://dev.flare.network/ftso/overview | Official price / feed consumption |
| FDC overview | https://dev.flare.network/fdc/overview | Attestation + verification lifecycle |
| FCC overview | https://dev.flare.network/fcc/overview | **FCC is not yet a fully public production system** (official warning) |
| Smart Accounts overview | https://dev.flare.network/smart-accounts/overview | XRPL → Flare personal accounts |
| Smart Accounts custom instruction | https://dev.flare.network/smart-accounts/custom-instruction | Official `0xFE` / `0xFF` semantics |
| FXRP / x402 payments | https://dev.flare.network/fxrp/token-interactions/x402-payments | EIP-3009 / x402 pattern |
| FAssets direct minting | https://dev.flare.network/fassets/direct-minting | XRPL payment → mint path |
| Flare AI Skills | https://dev.flare.network/network/guides/flare-ai-skills | Listed skills: `flare-general`, `flare-ftso`, `flare-fassets`, `flare-fdc`, `flare-smart-accounts` — **no official `flare-fcc` skill listed** |

**MasterAccountController (env-validated expected address):** `0x434936d47503353f06750Db1A444DBDC5F0AD37c`  
(`EXPECTED_MASTER_ACCOUNT_CONTROLLER` in Beacon env; Smart Accounts rail — not the Beacon Safe factory path.)

**ContractRegistry (FTSOv2 resolution):** `0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019`  
Used by `packages/shared/src/ftso.ts` via `getContractAddressByName("FtsoV2")`.

---

## 3. Current Beacon runtime — what is REAL

Network: **Coston2, chain id 114**.

### 3.1 Deployed / wired product contracts (REAL)

| Component | Address | Role |
| --- | --- | --- |
| Flare ContractRegistry | `0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019` | Resolve FTSOv2 (and other named contracts) |
| MockUSDT0 | `0x6fd8a72a972040f3153894BBd0d829a58f1Fe86c` | EIP-3009 test token for Flow x402 / Safe / Jobs |
| X402Facilitator | `0x1f409a809cE6e8A4467C1fD40943aC40169f4779` | Settles EIP-3009 authorizations |
| BeaconEscrow (prepaid) | `0xE68c22621314977f00c85D89e4f5b10573C51C7E` | Jobs `lockPrepaid` / release / refund |
| BeaconSafeFactory | `0x9e88ADFB4dA7530675acC520cC9a0a818543c4F2` | wallet → personal `BeaconAgentVault` |
| BeaconCoston2SwapDesk | `0x36c17ca6Aa2b61b13f7c4B5A59629320a8B4dF29` | FTSO-synced MockUSDT0 → FXRP Safe swaps |
| BeaconJobRegistry | `0x100a3E24909DE25B9CAe75Ba665Be6F893b98889` | Job registry |
| FXRP OFT adapter | `0xCd3d2127935Ae82Af54Fc31cCD9D3440dbF46639` | LayerZero V2 OFT on Coston2 (`oftBridge.ts`) |

**Not confused with product rails:** faucet / SparkDEX USDT0 `0xC1A5B41512496B80903D1f32d6dEa3a73212E71F` is a different token and is **not** the Beacon Escrow/Facilitator settle path.

### 3.2 Product loops that exist today (REAL)

| Loop | Honesty | Evidence in repo |
| --- | --- | --- |
| FTSOv2 feed reads via ContractRegistry | REAL | `packages/shared/src/ftso.ts` |
| Personal BeaconAgentVault per wallet (factory) | REAL | Factory address above; vault resolution in shared vault client |
| Agent session gating Safe actions | REAL | API Safe session checks |
| Jobs Safe lock: `vault.execute` (token transfer to escrow) then `escrow.lockPrepaid` | REAL | **2 txs** — `packages/shared/src/safeJobLock.ts` |
| Flow x402 micropays (EIP-3009 + Facilitator) | REAL | Env + facilitator address; paid resource / Flow paths |
| FAssets status + redeem **prepare** | REAL (status/prepare) | `packages/shared/src/fassetsStatus.ts` |
| FAssets **mint** | `docs_handoff` only | Explicit `mint: "docs_handoff"` — no fake mint button |
| LayerZero OFT discover / prepare / execute with live peer checks | REAL (with honesty) | `packages/shared/src/oftBridge.ts` — live `peers(eid)` + PeerSet; fallback routes labeled `live:false` / `fallback-snapshot` |
| Application receipts with explorer links | REAL (application record) | Flow/Safe/Jobs receipt UX — not a substitute for on-chain attestation |

### 3.3 What “complete inspectable loop” means here

A judge-visible loop is valuable when every spend has:

1. Decision data (e.g. FTSO snapshot)  
2. Policy decision  
3. Payment (x402 or Safe escrow)  
4. Execution  
5. Receipt with real Coston2 explorer links for hashes that actually occurred  

Do **not** invent tx hashes for documentation. Only paste hashes from live runs into master docs after verification.

---

## 4. STUB / SIMULATED / NOT PRODUCT-WIRED

### 4.1 FDC package — STUB relative to Flow/API product

- `packages/fdc` exports `FdcClient` (`packages/fdc/src/index.ts`).
- Workspace package `@beacon/fdc` exists in the monorepo.
- **Validated:** Flow / API runtime does **not** import `@beacon/fdc` for product paths (only isolated scripts such as `scripts/fcc-instruction-test.ts` use the FCC client from that package).
- **Honesty:** Do **not** claim “Flow FDC live” or that Jobs/Flow currently request + verify FDC proofs end-to-end.

**Label for product claims today:** `STUB` / not product-wired.

### 4.2 FCC — SIMULATED_TEE / scaffold

- Official docs: FCC is **not yet fully public production** — https://dev.flare.network/fcc/overview  
- Beacon: `FccExtensionClient` in `packages/fdc/src/fcc.ts` — scaffold-style instruction sender + ext-proxy client.
- Live product honesty: `SIMULATED_TEE=true`, `FCC_MODE=simulated` — not hardware-attested Confidential Space.
- `/health` and `GET /v1/fcc/status` expose mode + honesty copy (`docs/HONESTY.md`).

**Label:** `SIMULATED` (SIMULATED_TEE). Hardware TEE path = `NOT AVAILABLE` for public production claims until registered machine / code-hash evidence exists.

### 4.3 Smart Accounts package — helpers only + opcode conflict

- `packages/smart-accounts/src/index.ts` provides:
  - Registry address helpers from env (`MasterAccountController`, AssetManager FXRP, FDC hub/verification expectations, etc.)
  - XRPL credit memo encode/decode helpers
  - Local `CUSTOM_INSTRUCTION_OPCODES` with `DEPOSIT_CREDIT: 0xfe` and `REFUND_CREDIT: 0xff`
- **Critical conflict:** Official Flare Smart Accounts use:
  - `0xFE` — hash-committed custom userOp (recommended custom instruction)
  - `0xFF` — inline / memo-field custom instruction variant  
  See https://dev.flare.network/smart-accounts/custom-instruction
- Beacon’s local `0xfe` / `0xff` names **must be renamed** to a separate namespace before any XRPL/Smart Account expansion. They must never masquerade as official instruction opcodes.
- Package is **not** a PersonalAccount executor wired through Flow/API as a product rail.

**Label:** `STUB` (helpers) + **must-fix** opcode naming before product use.

### 4.4 Official Flare AI Skills — not assumed installed

Official listed skills (https://dev.flare.network/network/guides/flare-ai-skills):

- `flare-general`
- `flare-ftso`
- `flare-fassets`
- `flare-fdc`
- `flare-smart-accounts`

There is **no official `flare-fcc` skill** in that list. Until skills are installed in the agent environment, treat Dev Hub + GitHub as the source of truth — do not invent skill coverage.

---

## 5. P0 security finding (REAL bug)

**Location:** `apps/api/src/index.ts`

Both Safe job approval routes call `executeSafeJobLock` **before** `assertPolicyAllows`:

1. `POST /v1/jobs/:id/approve` with `mode === "safe"` — lock/spend first, then policy.
2. `POST /v1/jobs/:id/approve-safe` — same order.

**Impact:** A policy denial can occur **after** value has already moved (`vault.execute` + `lockPrepaid`). Spend accounting may also record after the fact.

**Required fix (implementation plan Phase 1):** assert policy (and any FCC shadow check when enforced) **before** any Safe transfer or escrow lock. Negative tests: denied policy → zero txs → zero spend accounting.

---

## 6. Ecosystem map — Flare primitives vs Beacon

| Primitive | Official role | Beacon today | Honesty |
| --- | --- | --- | --- |
| FTSOv2 | On-chain / off-chain feeds | Registry-resolved reads; SwapDesk sync; advisory heuristics | REAL reads; **execution guard incomplete** (see gap matrix) |
| FDC | Attest external facts; verify on Flare | Client package present; not Flow/API product path | STUB / not claimed live |
| FCC / FCE | Confidential computation + signed results | Scaffold client; SIMULATED_TEE | SIMULATED |
| x402 / EIP-3009 | Machine micropayments | Facilitator + MockUSDT0 Flow path | REAL |
| FAssets | XRPL ↔ FXRP | Status + redeem prepare; mint = docs_handoff | REAL prepare; mint handoff |
| Smart Accounts | XRPL one-signature Flare execution | Registry/memo helpers; opcode conflict | STUB |
| LayerZero OFT | FXRP cross-chain | Discover/prepare/execute + live peers | REAL with destination-proof gap for “complete” |
| Beacon Safe (personal vault) | Agent spend + policy caps | Factory + session + Jobs 2-tx lock | REAL (Beacon product; **not** Flare Smart Accounts) |

---

## 7. Judge / community signals (no competitor naming)

Validated judging themes from community / mentor research used for prioritization:

1. **Real usefulness today** — working Coston2 loops beat vaporware primitives.  
2. **Complete inspectable loops** — every claim backed by visible hashes/receipts.  
3. **FCC + x402 + policy for agents** — confidential policy story + machine payments, labeled honestly.  
4. **FAssets / Smart Accounts for XRPFi one-signature** — parallel XRPL rail, not fake rename of Beacon Safe.  
5. **Honest claims** — SIMULATED / STUB / NOT AVAILABLE when true.

Rejected postures: claiming hardware TEE without attestation; claiming FDC live in Flow; calling Beacon Safe a Smart Account; inventing mint buttons; marking LayerZero complete without destination proof.

---

## 8. Recommended architecture (summary)

Full diagrams live in [`FLARE_NATIVE_BEACON_ARCHITECTURE.md`](./FLARE_NATIVE_BEACON_ARCHITECTURE.md).

| Priority | Direction |
| --- | --- |
| **P0** | Policy-before-spend; FTSO execution guard; evidence-bound x402; real FDC **only where claimed** |
| **P1** | FCC shadow → opt-in V2 Safe with on-chain verified TEE auth; XRPL / FAssets / Smart Accounts **parallel** rail |
| **P2** | LayerZero compose **only** with destination proof |

Preserve existing Flow, Safe V1, Jobs, and AI router. Do not rewrite working rails to force every Flare primitive into one path.

---

## 9. Rejected architectures

| Idea | Why rejected |
| --- | --- |
| Generic protocol dashboards as the product | Low Flare depth, weak inspectable agent loop |
| Copying protocol operator software into Beacon | Scope explosion; not user agent OS |
| TEE holds the executor private key | Wrong trust model; executor remains gas relayer |
| Automatic fail-open when FCC unavailable | Security regression |
| Rename Beacon Safe as Smart Account | Dishonest; different products |
| Force every Flare primitive into one Flow | Demo fragility; false claims |
| Claim FDC / hardware FCC / official opcode memos without wiring | Honesty failure |

---

## 10. Current vs target capability (honesty map)

| Capability | Current label | Target when done |
| --- | --- | --- |
| Coston2 personal Safe + Jobs lock | REAL | REAL (policy order fixed) |
| Flow x402 | REAL | REAL + evidence envelope |
| FTSOv2 reads | REAL | REAL + execution guard |
| FDC in Flow/API | STUB | REAL async attestation only for selected types |
| FCC policy | SIMULATED | SIMULATED until hardware; V2 on-chain verify when available |
| FAssets mint | docs_handoff | REAL when direct-mint UX wired |
| Smart Accounts instructions | STUB + opcode conflict | REAL after rename + allowlisted instructions |
| LZ OFT | REAL (source) | REAL complete with dest proof |

---

## 11. Research completeness gate

Phase 0 is complete when:

1. This file, the gap matrix, architecture, and implementation plan **agree** on REAL / SIMULATED / STUB / NOT AVAILABLE.  
2. No doc claims Flow FDC live.  
3. FCC is labeled SIMULATED_TEE / not fully public production.  
4. Smart Account opcode conflict is documented as a rename prerequisite.  
5. P0 policy-before-spend is listed as the first code change.  
6. No invented transaction hashes appear in these four docs.

**Next:** [`FLARE_INTEGRATION_GAP_MATRIX.md`](./FLARE_INTEGRATION_GAP_MATRIX.md)
