# Flare Integration Gap Matrix — Beacon

**Honesty labels:** `REAL` | `SIMULATED` | `STUB` | `NOT AVAILABLE`  
**Companion:** [`FLARE_DEEP_RESEARCH.md`](./FLARE_DEEP_RESEARCH.md) · [`FLARE_NATIVE_BEACON_ARCHITECTURE.md`](./FLARE_NATIVE_BEACON_ARCHITECTURE.md) · [`FLARE_IMPLEMENTATION_PLAN.md`](./FLARE_IMPLEMENTATION_PLAN.md)

---

## 1. Scoring method

Each candidate integration is scored **1–10** (higher = better) on:

| Dimension | Meaning |
| --- | --- |
| Flare depth | Uses Flare-native primitives, not generic EVM |
| User value | Helps a real Beacon user today |
| Judge value | Visible, inspectable demo signal |
| Novelty | Differentiated agent + Flare story |
| Demo impact | Fits a narrow, complete loop |
| Feasibility | Can ship on current Coston2 + repo |
| Security | Improves or preserves spend safety |
| Time efficiency | Effort vs payoff before demo |
| Regression risk | **Lower is better** — scored 1–10 where 10 = high risk |

**Weighted score (implementation priority):**

```
score =
  0.15*FlareDepth + 0.15*UserValue + 0.15*JudgeValue
  + 0.10*Novelty + 0.10*DemoImpact + 0.15*Feasibility
  + 0.10*Security + 0.10*TimeEfficiency
  - 0.10*RegressionRisk
```

Scores are research judgments from validated current state — not invented protocol capabilities.

---

## 2. Scoring table (P0–P3 candidates)

| ID | Integration | Flare | User | Judge | Novel | Demo | Feas. | Sec. | Time | RegRisk↓ | Weighted | Priority | Current honesty |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | Policy-before-spend fix | 6 | 10 | 9 | 3 | 8 | 10 | 10 | 10 | 2 | **8.4** | **P0** | REAL bug |
| B | Evidence-bound x402 | 8 | 9 | 9 | 7 | 9 | 9 | 8 | 8 | 3 | **8.1** | **P0** | REAL rail, deepen |
| C | FTSO execution guard | 9 | 8 | 9 | 7 | 9 | 8 | 9 | 7 | 4 | **7.7** | **P0** | REAL reads; guard STUB |
| D | Real FDC where claimed | 10 | 7 | 9 | 8 | 8 | 6 | 8 | 5 | 5 | **6.9** | **P0** | STUB in Flow/API |
| E | FCC shadow → opt-in V2 | 10 | 8 | 10 | 9 | 9 | 5 | 9 | 4 | 6 | **6.8** | **P1** | SIMULATED |
| F | XRPL/FAssets/Smart Accounts rail | 10 | 8 | 9 | 9 | 8 | 5 | 7 | 4 | 7 | **6.3** | **P1** | STUB + opcode conflict |
| G | LZ compose + dest proof | 8 | 6 | 7 | 6 | 6 | 6 | 7 | 5 | 6 | **5.5** | **P2** | REAL source; dest incomplete |
| H | Generic dashboards | 2 | 4 | 3 | 1 | 2 | 8 | 3 | 7 | 3 | **3.3** | **Reject** | N/A |
| I | Claim all primitives in one Flow | 5 | 3 | 2 | 4 | 2 | 2 | 2 | 2 | 10 | **1.1** | **Reject** | Dishonest |

---

## 3. Runtime vs package vs stub matrix

| Area | Runtime (apps/API/Flow) | Package exists | Product-wired | Honesty | Gap |
| --- | --- | --- | --- | --- | --- |
| FTSOv2 | Yes — quotes, desk sync, heuristics | `packages/shared/src/ftso.ts` | Yes | REAL | No hard execution guard / circuit breaker before spend |
| x402 EIP-3009 | Yes — Flow micropays | Facilitator + MockUSDT0 | Yes | REAL | Quote/payment/response not fully bound into one EvidenceEnvelope |
| Beacon Safe / Jobs | Yes — personal vault, 2-tx lock | Factory, Escrow, JobRegistry | Yes | REAL | **P0:** policy after lock; session/on-chain caps remain |
| SwapDesk | Yes | `0x36c17…dF29` | Yes | REAL | Should consume FTSO guard when shipped |
| FAssets status/redeem prepare | Yes (status/prepare cards) | `fassetsStatus.ts` | Partial | REAL prepare; mint `docs_handoff` | No product direct-mint UX |
| LayerZero OFT | Yes — discover/prepare/execute | `oftBridge.ts`, adapter `0xCd3d…6639` | Yes | REAL + fallback honesty | Compose only with destination proof (P2) |
| FDC | **No** Flow/API import of `FdcClient` | `packages/fdc` | No | STUB | Do not claim live FDC until request→verify path ships |
| FCC / FCE | Status endpoints + honesty badge | `packages/fdc/src/fcc.ts` | Scaffold / simulated | SIMULATED | Shadow then opt-in V2; no hardware claim |
| Smart Accounts | Not product executor | `packages/smart-accounts` | Registry + memo helpers | STUB | Rename `0xfe`/`0xff` locals; parallel rail only |
| Official flare-fcc skill | N/A | N/A | N/A | NOT AVAILABLE | Not listed on Flare AI Skills page |

---

## 4. Gap detail by priority

### P0 — must fix / must deepen before new claims

| Gap | Current | Target | Acceptance signal |
| --- | --- | --- | --- |
| Policy order | `executeSafeJobLock` before `assertPolicyAllows` on approve + approve-safe | Policy (and enforced FCC) **before** spend | Denied policy → 0 txs, 0 spend records |
| FTSO guard | Advisory / desk sync | Freshness, deviation, slippage, circuit-breaker can **block** execution | Stale/manipulated feed fails closed on guarded actions |
| x402 evidence | Payment works | Bind quote, nonce, response hash, acceptance, settlement | One receipt shows all commitments |
| FDC claims | Package STUB | Only claim FDC when async proof verified | Flow shows requested→verified or absent |

### P1 — parallel rails after P0

| Gap | Current | Target | Acceptance signal |
| --- | --- | --- | --- |
| FCC | SIMULATED_TEE scaffold | Shadow compare vs Redis/on-chain; opt-in V2 Safe verifies auth on-chain | Shadow never moves funds; V1 Safes untouched |
| XRPL / FAssets / Smart Accounts | helpers + docs_handoff mint | Parallel one-signature rail with official opcodes | Beacon Safe never renamed as Smart Account; local opcodes renamed |

### P2 — compose only with proof

| Gap | Current | Target | Acceptance signal |
| --- | --- | --- | --- |
| LZ complete | Source OFT + live peers | Source GUID + LZ Scan + destination receipt before “complete” | Fallback snapshots remain non-executable |

---

## 5. Contract / address inventory (validated)

| Name | Address | Honesty |
| --- | --- | --- |
| Coston2 chain | 114 | REAL |
| ContractRegistry | `0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019` | REAL |
| MockUSDT0 | `0x6fd8a72a972040f3153894BBd0d829a58f1Fe86c` | REAL |
| Facilitator | `0x1f409a809cE6e8A4467C1fD40943aC40169f4779` | REAL |
| Escrow | `0xE68c22621314977f00c85D89e4f5b10573C51C7E` | REAL |
| BeaconSafeFactory | `0x9e88ADFB4dA7530675acC520cC9a0a818543c4F2` | REAL |
| SwapDesk | `0x36c17ca6Aa2b61b13f7c4B5A59629320a8B4dF29` | REAL |
| JobRegistry | `0x100a3E24909DE25B9CAe75Ba665Be6F893b98889` | REAL |
| FXRP OFT adapter | `0xCd3d2127935Ae82Af54Fc31cCD9D3440dbF46639` | REAL |
| MasterAccountController (expected) | `0x434936d47503353f06750Db1A444DBDC5F0AD37c` | Env-validated expected; Smart Accounts rail |

No tx hashes are listed here by design.

---

## 6. Official docs ↔ Beacon claim checklist

| Official page | Safe claim today | Unsafe claim |
| --- | --- | --- |
| FTSO overview | We read FtsoV2 via registry | “All agent spends are FTSO-guarded” (not yet) |
| FDC overview | Package exists | “Flow uses FDC” |
| FCC overview | SIMULATED_TEE; not fully public production | “Hardware Confidential Space” |
| Smart Accounts + custom instruction | Parallel future rail; official `0xFE`/`0xFF` | Beacon memo opcodes are official instructions |
| x402 payments | MockUSDT0 + Facilitator Flow | Confusing with faucet USDT0 |
| FAssets direct minting | Redeem prepare; mint docs_handoff | Fake mint complete |
| Flare AI Skills | Five listed skills; no flare-fcc | “We follow official flare-fcc skill” |

---

## 7. Priority recommendation (locked for Phase 0)

1. **P0:** policy-before-spend, FTSO guard, evidence-bound x402, real FDC where claimed  
2. **P1:** FCC shadow then opt-in V2 Safe with on-chain verified TEE auth; XRPL/FAssets/Smart Accounts parallel rail  
3. **P2:** LayerZero compose only with destination proof  

**Rejected:** generic dashboards; fail-open FCC; renaming Safe as Smart Account; inventing FDC/FCC/hardware claims.

---

## 8. Gate to leave Phase 0

- [ ] Scoring table reviewed against architecture + implementation plan  
- [ ] Every row in §3 has a matching honesty label in deep research  
- [ ] P0 bug documented with file path `apps/api/src/index.ts`  
- [ ] Opcode conflict documented as rename-before-expand  

**Next:** [`FLARE_NATIVE_BEACON_ARCHITECTURE.md`](./FLARE_NATIVE_BEACON_ARCHITECTURE.md)
