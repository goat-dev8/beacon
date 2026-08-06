# Beacon — Summer Signal Deep Research & Product Audit

**Date:** 2026-08-06  
**Product:** Beacon Flare AI OS  
**Hackathon:** Flare Summer Signal  
**Authority:** Verified Flare DevHub docs, SparkDEX docs, LayerZero docs, on-chain bytecode checks (Flare Mainnet chain 14 / Coston2 chain 114), Quantic/FlareDevHub competitor highlights (`x,youtube.md`), Beacon prior audits (`FINAL_AUDIT.md`, `PRODUCTION_AUDIT.md`, `PRODUCT_GAP_ANALYSIS.md`, `WIN_RESEARCH_2026-08-06.md`, `history.md`)

**North star:** Judges should experience one coherent Flare AI OS — signal → quote → policy → pay → execute → receipt — across FTSO, SparkDEX, LayerZero, FAssets, x402, vault rails, and authorization receipts. Single-feature competitors win a niche; Beacon wins the stack.

**Honesty locks (non-negotiable):**
1. Never invent APY or vault yields.
2. Never fake SparkDEX liquidity or swaps on Coston2.
3. Never claim FCC / FCE hardware TEE attestation in live product copy.

---

## 1. Official Flare constraints (verified)

### 1.1 SparkDEX V3 — mainnet bytecode only

| Contract | Address | Flare Mainnet (14) | Coston2 (114) |
|---|---|---|---|
| V3 Factory | `0x8A2578d23d4C532cC9A98FaD91C0523f5efDE652` | Bytecode present | **Empty** (`eth_getCode` → `0x`) |
| SwapRouter | `0x8a1E35F5c98C4E85B36B7B253222eE17773b2781` | Bytecode present | **Empty** |
| QuoterV2 | `0x5B5513c55fd06e2658010c121c37b07fC8e8B705` | Documented mainnet | **Empty on Coston2** (same pattern) |

**Implications for Beacon**
- Any Coston2 “swap prepare” that targets these addresses is a call against a non-contract → critical honesty failure if executed or presented as live.
- Swap execution and QuoterV2-backed estimates belong on **Flare Mainnet (chain 14)** with an explicit MetaMask chain switch.
- FTSO mid-price is acceptable for narrative bias / portfolio marking; it is **not** a SparkDEX quote.

**Sources**
- [SparkDEX V2/V3.1 DEX contracts](https://docs.sparkdex.ai/additional-information/smart-contract-overview/v2-v3.1-dex.md) — Factory, SwapRouter, QuoterV2 listed as above
- [SparkDEX docs hub](https://docs.sparkdex.ai/)
- Beacon internal verification: `WIN_RESEARCH_2026-08-06.md` (`eth_getCode` empty on 114, deployed on 14)
- DevHub USDT0↔FXRP swap guides label SparkDEX router usage for **Flare Mainnet**; Coston2 docs that reuse mainnet router addresses are a known mismatch — do not ship silent dead swaps ([USDT0→FXRP swap](https://dev.flare.network/fxrp/token-interactions/usdt0-fxrp-swap))

---

### 1.2 FAssets on Coston2 — FTestXRP only

| Fact | Detail |
|---|---|
| Controllers | `AssetManagerController.getAssetManagers()` on Coston2 returns **one** manager (FXRP / Testnet XRP) |
| Live FAsset | **FTestXRP** only |
| FBTC / FDOGE | **Not** available on Coston2 for mint/redeem product paths |
| Product rule | Surface only managers returned by the controller; label other FAssets “not on Coston2” / documented elsewhere |

**Sources**
- [FAssets reference](https://dev.flare.network/fassets/reference)
- [FAssets developer guides](https://dev.flare.network/fassets/developer-guides)
- [FXRP overview](https://dev.flare.network/fxrp/overview)
- Beacon controller probe notes in `WIN_RESEARCH_2026-08-06.md`

---

### 1.3 FXRP OFT Adapter (Coston2 / LayerZero)

| Item | Value |
|---|---|
| OFT Adapter (Coston2) | `0xCd3d2127935Ae82Af54Fc31cCD9D3440dbF46639` |
| Pattern | Lock on Flare adapter; mint/burn OFT on destination |
| Documented Coston2 peers (discovery script) | BSC (EID 40102), Sepolia (EID 40161), Hyperliquid (EID 40362) |
| Fee honesty | Use on-chain `quoteSend` only — never invent bridge fees |
| Destination fill | Not claimed until LayerZero Scan + destination receipt exist |

**Sources**
- [FXRP OFT](https://dev.flare.network/fxrp/oft)
- [Discovering available bridge routes](https://dev.flare.network/fxrp/oft/fxrp-autoredeem#discovering-available-bridge-routes) — adapter address + peer table
- [LayerZero OFT documentation](https://docs.layerzero.network/)
- LayerZero Scan (testnet) for delivery proof: `https://testnet.layerzeroscan.com/`

---

### 1.4 Firelight & Upshift (Coston2 vault rails)

| Protocol | Coston2 address | Mechanics (do not invent APY) |
|---|---|---|
| **Firelight** | `0xC90D6847747b85d1fa2E07859869fb9fB72c0361` | ERC-4626; period-based withdraw/redeem → later `claimWithdraw()` |
| **Upshift** | `0x24c1a47cD5e8473b64EAB2a94515a196E10C7C81` | ERC-4626-style; `deposit`; `instantRedeem()` (fee) or `requestRedeem()` + `claim(y,m,d,receiver)` |

**Product rule:** Read vault config / share balances on-chain. Display **status**, not fabricated yields. Never invent APY numbers for judging demos.

**Sources**
- [Firelight vaults](https://dev.flare.network/fxrp/firelight) — Coston2 deployment address explicit
- [Upshift vaults](https://dev.flare.network/fxrp/upshift)
- [Upshift status script](https://dev.flare.network/fxrp/upshift/status) — `VAULT_ADDRESS = 0x24c1a47cD5e8473b64EAB2a94515a196E10C7C81`
- Smart Accounts FAsset instructions covering Firelight / Upshift types: [FAsset instructions](https://dev.flare.network/smart-accounts/fasset-instructions)

---

### 1.5 x402 on Coston2 — MockUSDT0 + EIP-3009

| Constraint | Verified stance |
|---|---|
| Payment token in official guides | **MockUSDT0** with EIP-3009 (`transferWithAuthorization`) |
| FXRP EIP-3009 | **Not ready** — DevHub: FXRP supported once it implements EIP-3009; guide will be updated then |
| Facilitator | Verifies + settles authorizations on-chain |
| Beacon product copy | Label MockUSDT0 ≠ SparkDEX / mainnet USDT0; fail-closed settle before resource delivery |

**Sources**
- [x402 Payment Protocol](https://dev.flare.network/fxrp/token-interactions/x402-payments) — MockUSDT0 note + EIP-3009 flow
- Official composition showcase: [fce-weather-insurance-x402-agent](https://github.com/flare-foundation/fce-weather-insurance-x402-agent)
- EIP-3009 / x402 ecosystem refs linked from DevHub (Coinbase x402, EIP-712)

---

### 1.6 FCC / FCE — not generally available production

DevHub warning (verbatim intent): **Flare Confidential Compute is in the final stages of development and is not yet a fully public production system.** Builders can start with FCE scaffolds and example extensions; that does **not** authorize live product claims of hardware TEE attestation.

| Allowed | Forbidden in live UI |
|---|---|
| “Simulated TEE / policy preview” labels | “Running in Flare Confidential Compute hardware” |
| Redis / server-enforced spend policy with Authorization Receipt | Claiming enclave attestation proofs |
| Roadmap: private policy → FCC when public | Shipping FCC badges as if production |

**Sources**
- [FCC overview](https://dev.flare.network/fcc/overview)
- [FCC guides](https://dev.flare.network/fcc/guides)
- Official references judges recognize: [fce-weather-insurance-x402-agent](https://github.com/flare-foundation/fce-weather-insurance-x402-agent), [fce-orderbook](https://github.com/flare-foundation/fce-orderbook), related FCE scaffolds (`fce-extension-scaffold`, `fce-sign`, `fce-weather-insurance`)
- Community / DevRel demos often still use MetaMask for x402 on Coston2 (acceptable for agent demos)

---

### 1.7 Network capability map (Beacon must make this obvious)

| Capability | Network | Why |
|---|---|---|
| FTSO feeds | Coston2 (114) primary; mainnet registry also valid | Hackathon default |
| x402 / MockUSDT0 / Bound Work escrow | Coston2 | Beacon rails deployed |
| FXRP OFT bridge quote/send | Coston2 | Adapter + peers live |
| FAssets status / FTestXRP | Coston2 | Controller managers |
| Firelight / Upshift reads | Coston2 | Documented vaults |
| SparkDEX swap + QuoterV2 | **Flare Mainnet (14) only** | Router/factory/quoter bytecode |

---

## 2. Competitor benchmark (Quantic / FlareDevHub highlights)

Context: On 21 July 2026, @0xQuantic (Flare / FlareDevHub core; ProofRails founder) highlighted strong Summer Signal directions: FCC/TEE, XRPFi/FAssets, FDC external data, and new financial primitives. Expanded analysis in `x,youtube.md` (Quantic post + follow-on DevHub / @fassko amplification through ~Aug 2026).

**Signal judges reward:** real rails, clear Flare primitive badges, complete product loops, and honesty about what is simulated vs on-chain.

Below: strengths / weaknesses vs **Beacon’s opportunity as a unified Flare AI OS**. Forbidden private inspiration project names are omitted; where relevant, use the category judges already favor (policy-controlled agent spend vaults, verifiable paid APIs, etc.).

---

### 2.1 Keyless (`@KeylessAccounts`)

| | |
|---|---|
| **What** | Policy-controlled XRP accounts; signing keys stay in TEE; txs signed only if they match owner rules (limits, allowlists) |
| **Strengths** | Crystal-clear FCC story; “account only does what you allow”; aligns with agent safety narrative mentors praise |
| **Weaknesses vs Beacon** | Narrow surface (account control, not a full OS). Limited public GitHub mid-hackathon. Does not own FTSO→swap→bridge→pay→receipt desk UX |
| **Beacon opportunity** | Keep Security Center + Authorization Receipt as the *policy layer* of a broader OS; do not try to out-niche a pure keyless XRP account — out-compose it with execute + pay + history |

---

### 2.2 Encrypted Finance (`@EncryptedFi`)

| | |
|---|---|
| **What** | Private DeFi via confidential compute + encrypted instructions + shared execution wallets |
| **Strengths** | Privacy-forward positioning; FCC track narrative |
| **Weaknesses vs Beacon** | FCC not public production → hard to prove hardware claims; less evidence of multi-primitive Flare integration (FTSO/SparkDEX/LZ/x402) in public materials |
| **Beacon opportunity** | Win on **verifiable public rails today** (FTSO, SparkDEX mainnet, OFT, x402) while labeling any TEE path simulated — honesty is a judging asset |

---

### 2.3 FlightGuard (`@_ace_won`)

| | |
|---|---|
| **What** | Parametric flight-delay insurance: buy with USDT0/FXRP → FDC Web2Json attests flight status → auto payout if delay ≥2h / cancel; FTSO pricing; keeper settlement |
| **Strengths** | Excellent FDC story; live Coston2 app (`flightguard.vercel.app`); end-to-end with real flight data — judges love complete loops |
| **Weaknesses vs Beacon** | Single vertical (insurance). Not an agent OS or creative/commerce meter |
| **Beacon opportunity** | Steal the *completeness* lesson (attest → settle → receipt). Beacon’s FDC client must stop inventing `requestId`s and wire real attestation when claiming FDC |

---

### 2.4 Torch (`@Big14teru` / github.com/big14way/torch)

| | |
|---|---|
| **What** | XRP-margined perps; TEE executor so operators do not hold signing keys; public GitHub early |
| **Strengths** | Ambitious XRPFi product; checkable claims; strong demo energy in live sessions |
| **Weaknesses vs Beacon** | Perps complexity + FCC dependency risk (migration waiting on FCC launch noted in community Q&A). Not a general agent payment/OS layer |
| **Beacon opportunity** | Do not compete on leverage UX. Compete on **agent desk that can signal (FTSO), swap (SparkDEX mainnet), bridge (LZ), pay (x402)** with receipts |

---

### 2.5 Lodestar (`@lodestar_flr`)

| | |
|---|---|
| **What** | Fixed-term FXRP (or sFLR) collateral lending; borrow USDT0 at fixed rate; deadline-based default vs continuous liquidation; FTSOv2 pricing |
| **Strengths** | Clean XRPFi credit primitive; live Coston2 |
| **Weaknesses vs Beacon** | Single protocol. No agent micropayment / creative delivery / multi-rail OS |
| **Beacon opportunity** | Portfolio + FAssets + vault **reads** can *cite* Firelight/Upshift honestly without inventing APY; Lodestar shows demand for FXRP credit UX Beacon can route users toward conceptually, not clone |

---

### 2.6 ProofRails (founded by @0xQuantic)

| | |
|---|---|
| **What** | x402 payment → verifiable receipt + finance-readable artifacts + on-chain evidence commitment on Flare; mainnet beta amplified by FlareDevHub |
| **Strengths** | Exact machine-economy story DevRel pushes; receipts as first-class product; founder/judge-adjacent narrative |
| **Weaknesses vs Beacon** | Receipt/payment infrastructure focus — not a full FTSO/SparkDEX/bridge/FAssets creative OS |
| **Beacon opportunity** | Treat Authorization Receipt + x402 settle headers as **table stakes**. Every Beacon paid path should feel ProofRails-grade: pay → deliver → prove |

---

### 2.7 Official / reference compositions judges already know

| Reference | Why it matters for Beacon |
|---|---|
| [fce-weather-insurance-x402-agent](https://github.com/flare-foundation/fce-weather-insurance-x402-agent) | Canonical x402 + FCC composition (pay API, protect secrets, agent consumes clean result) |
| [fce-orderbook](https://github.com/flare-foundation/fce-orderbook) | Confidential CLOB reference for FCE patterns |
| **sotto**, **aegisflow** | Named in ecosystem inventories as adjacent Flare agent / flow experiments — use as existence proof that multi-step agent UX is expected, not optional |
| Policy-controlled agent spend vaults judges favor | Category-level pattern: private (or labeled-simulated) spend policy + on-chain settlement without giving agents raw keys — Beacon Security Center should compose with this category, not pretend to be the whole category |

**Net competitive stance for Beacon**

| Competitor class | They win | Beacon wins if… |
|---|---|---|
| Single FCC niche | Depth of TEE story | Honest simulated labels + broader OS |
| Single FDC product | Attestation completeness | Wire FDC for real; keep OS breadth |
| Single XRPFi venue | Protocol depth | Route + mark + swap + bridge + pay |
| Receipt / x402 infra | Payment proof | Same receipt rigor **plus** Flare DeFi/data primitives |

Beacon’s unique claim: **one AI OS that names and uses FTSO + SparkDEX + LZ + FAssets + x402 + vault + receipts** in one intent pipeline.

---

## 3. Beacon current audit gaps (from prior audits)

Status language: **Gap** = must fix or honestly demote before judging; **Partial** = path exists, proof incomplete.

### 3.1 UX / composition gaps

| Gap | Detail | Risk |
|---|---|---|
| **Card stacking** | Multiple overlapping intent/result cards dilute the “one composition” desk | Mentors see agent tab farm, not OS |
| **Triple execution UI** | Execution drawer + inline cards + legacy desk phases compete | Confusing approve/swap/send story |
| **sessionStorage vs Postgres split** | Execution states / desk drafts in `sessionStorage`; conversations/history in Postgres | Refresh/resume inconsistency; “working” demos break under judge reload |
| **Treasury = Portfolio alias** | Intent titles alias treasury ↔ portfolio (`flareAgents` copy) | Product identity blur; two names for one job |
| **Accessibility ~81** | Audit score short of polished desk bar | Judging polish / a11y deductions |
| **No auto-scroll** | New messages / phase updates do not follow viewport | Feels broken mid-demo |
| **Mobile history hidden** | History rail missing/obscured on small screens | Mobile judging fails resume story |

### 3.2 Flare honesty / quote gaps

| Gap | Detail | Risk |
|---|---|---|
| **SparkDEX estimates use FTSO mid, not QuoterV2** | Narrative price ≠ pool quote | Slippage surprise; mentors catch “fake DEX quote” |
| **Bridge destination not verified** | Prepare/send may succeed while destination fill unproven | Claiming bridge complete without LZ Scan / dest receipt |
| **FCC simulated in UI** | Correct technically; risk of badge wording drifting into hardware claims | Instant credibility loss vs DevHub warning |

### 3.3 Execution / registry / policy gaps

| Gap | Detail | Risk |
|---|---|---|
| **Execution stubs** | Registry stubs for `media` / `research` / `bound_work` (and related) vs full adapters | Judge hits stub after paying / approving |
| **BeaconJobRegistry unrestricted authorize/close** | Auth surfaces too open | Security / escrow integrity failure under scrutiny |
| **FDC client invents `requestId`s / not wired** | Scaffold only — synthetic IDs | Cannot claim FDC; fails FlightGuard-class comparison |
| **Redis-optional policy fails open** | Without Redis, policy enforcement may allow spend | Opposite of Security Center story |
| **Fake model display names** | UI badges not matching actual model family | Trust leak on “Powered by …” |

### 3.4 What is already working (do not regress)

From `FINAL_AUDIT.md` / `PRODUCTION_AUDIT.md` (2026-08-05) and 2026-08-06 honesty fixes:

- Fixed ChatGPT-style Flow layout; wallet-keyed APIs
- Postgres conversations + execution engine schema/API (partial stubs remain)
- PolicyEvaluator with **simulated FCC** labeling when honest
- SparkDEX approve+swap path with explorer receipts — **must be mainnet-gated after Coston2 bytecode discovery**
- Bridge OFT `quoteSend` prepare; destination fill not claimed
- Image/research settle-then-deliver x402 paths (fail-closed)
- Bound Work escrow for large creative jobs
- FTSO live feeds for signals / portfolio marking

---

## 4. Ship list · truth constraints · judging strategy

### 4.1 Truth constraints (print on the wall)

1. **Never invent APY** — Firelight/Upshift = address + on-chain status only.
2. **Never fake SparkDEX on Coston2** — `getCode(router|factory|quoter)` empty → block execute on 114; offer chain-14 prepare + switch.
3. **Never claim FCC hardware** — simulated TEE / server policy only until public FCC is integrated with real attestation.
4. **Never invent FAssets** — Coston2 shows FTestXRP manager only; FBTC/FDOGE = not on Coston2.
5. **Never invent bridge fees or fills** — `quoteSend` + LZ Scan; destination receipt required to claim fill.
6. **Never equate MockUSDT0 with SparkDEX USDT0** — label in status bar / cards.
7. **Never invent FDC request IDs** — wire or demote FDC badge.
8. **Policy must fail closed** — no Redis ⇒ deny spend / require explicit safe mode, not open allow.

### 4.2 Ship list (judging-critical order)

| Priority | Ship item | Proof mentors need |
|---|---|---|
| P0 | SparkDEX honesty gate + QuoterV2 estimates on mainnet | `getCode` gate; QuoterV2 quote in UI; chain 14 switch; explorer txs |
| P0 | x402 settle → deliver once + receipt | 402 → settle → artifact; no catalog replay |
| P0 | Security policy fail-closed + Authorization Receipt | Pause / allowlist / budget enforced without Redis open hole |
| P0 | FCC / TEE wording audit | Zero hardware claims |
| P1 | Unified execution UX (kill triple UI / card stacking) | One drawer or one card family; shared phase language |
| P1 | Persist execution + history in Postgres (reduce sessionStorage split) | Refresh → same conversation + pending phases |
| P1 | Bridge destination verification | LZ Scan link + dest balance/receipt before “bridged” |
| P1 | FAssets desk honesty | Controller managers + FXRP settings + FTSO lot value; no FBTC/FDOGE mint CTA on 114 |
| P1 | Firelight/Upshift read-only cards | Addresses + live shares/config; **no APY invention** |
| P2 | Wire or hide FDC | Real request IDs or remove FDC claim |
| P2 | Restrict BeaconJobRegistry authorize/close | Role / wallet checks |
| P2 | Replace execution stubs for paid media/research/bound_work | Paid path cannot land on stub |
| P2 | Fix model display names | Badge = actual provider/family |
| P2 | a11y + auto-scroll + mobile history | Score ↑; demo works on phone |
| P2 | Disambiguate Treasury vs Portfolio | One name, one job |

### 4.3 Why Beacon wins as unified Flare AI OS

**Thesis:** Summer Signal mentors are flooded with excellent *single-feature* demos (insurance, perps, lending, keyless accounts, receipts). The winning OS narrative is the one that **composes Flare’s actual stack** into a daily agent desk without lying about network reality.

```
Intent → Clarify → Quote → Policy → Pay → Execute → Observe → Receipt → History → Resume
```

| Flare primitive | Beacon role in the OS | Competitor usually stops at |
|---|---|---|
| **FTSO** | Signal + portfolio mark + risk narrative | Price widget |
| **SparkDEX** | Mainnet liquid FXRP/USDT0/WNat swaps via QuoterV2 + router | Fake Coston2 DEX or none |
| **LayerZero OFT** | FXRP bridge quote/send with peer discovery | Static “bridge soon” |
| **FAssets** | FTestXRP truth on Coston2; mint/redeem literacy | Logo only |
| **x402 + EIP-3009** | Pay for research/image/resources; fail-closed settle | One demo 402 |
| **Vault rails** | Firelight/Upshift status (no APY fiction) | Yield screenshot |
| **Receipts / policy** | Authorization Receipt + spend rules (simulated TEE labeled) | Policy-only or receipt-only product |

**Judging script (90 seconds)**

1. Connect wallet → show network map (114 vs 14) in UI chrome.  
2. FTSO signal → Portfolio mark (live).  
3. SparkDEX: attempt on Coston2 blocked honestly → switch to 14 → QuoterV2 quote → approve/swap → explorer.  
4. Bridge: peer list from OFT adapter → `quoteSend` → send → LZ Scan (destination claimed only if verified).  
5. x402: protected resource → settle → artifact + receipt.  
6. Security Center: budget block + Authorization Receipt (simulated TEE label visible).  
7. FAssets/vault: controller + Firelight/Upshift addresses, on-chain status, **no invented APY**.  
8. Refresh: history + paid badges resume (Postgres).

**What not to demo**
- Coston2 SparkDEX “success”
- Hardware FCC claims
- Invented vault APY
- FDC with synthetic `requestId`
- Polymarket / external betting UI (dilutes Flare hero stack)

---

## 5. Absolute never-claims (restate)

| Never | Instead |
|---|---|
| Invent APY / “earning X% on Firelight/Upshift” | Show vault address, shares, period/epoch status from chain |
| Fake SparkDEX on Coston2 | Block execute; mainnet QuoterV2 + router only |
| Claim FCC / FCE hardware TEE in production UI | “Simulated TEE / policy preview” + roadmap |
| Claim FXRP EIP-3009 x402 ready | MockUSDT0 path; cite DevHub |
| Claim FBTC/FDOGE on Coston2 | FTestXRP only via AssetManagerController |
| Claim bridge filled without destination proof | Prepare/send + LZ Scan; fill when verified |
| Claim FDC attestation with invented IDs | Wire or demote |

---

## Source index

### Official Flare / partner docs
- https://docs.sparkdex.ai/
- https://docs.sparkdex.ai/additional-information/smart-contract-overview/v2-v3.1-dex.md
- https://dev.flare.network/fassets/reference
- https://dev.flare.network/fassets/developer-guides
- https://dev.flare.network/fxrp/overview
- https://dev.flare.network/fxrp/oft
- https://dev.flare.network/fxrp/oft/fxrp-autoredeem
- https://dev.flare.network/fxrp/firelight
- https://dev.flare.network/fxrp/upshift
- https://dev.flare.network/fxrp/upshift/status
- https://dev.flare.network/fxrp/token-interactions/x402-payments
- https://dev.flare.network/fxrp/token-interactions/usdt0-fxrp-swap
- https://dev.flare.network/fcc/overview
- https://dev.flare.network/fcc/guides
- https://dev.flare.network/smart-accounts/fasset-instructions
- https://docs.layerzero.network/

### Official GitHub references
- https://github.com/flare-foundation/fce-weather-insurance-x402-agent
- https://github.com/flare-foundation/fce-orderbook
- https://github.com/big14way/torch

### Competitor / DevRel signal
- Quantic highlight post (21 Jul 2026): https://x.com/0xQuantic/status/2079545499196030997
- Expanded competitor notes: `d:\route\Flare\x,youtube.md`
- FlightGuard live: https://flightguard.vercel.app/

### Beacon internal audits / research
- `beacon/FINAL_AUDIT.md`
- `beacon/PRODUCTION_AUDIT.md`
- `beacon/PRODUCT_GAP_ANALYSIS.md`
- `beacon/WIN_RESEARCH_2026-08-06.md`
- `beacon/WIN_RESEARCH_2026-08-05.md`
- `beacon/history.md`

---

*End of document — 2026-08-06. Update when bytecode, controller managers, OFT peers, or FCC production status change; do not update by inventing yields or testnet DEX liquidity.*
