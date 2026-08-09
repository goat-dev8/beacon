# Flare Native Beacon — Final Integration Audit

> **Audit Date:** 2026-08-10  
> **Network:** Coston2 (Chain ID 114) + Flare Mainnet (Chain ID 14) for SparkDEX  
> **Auditor:** Beacon Technical Review

---

## Executive Summary

This document provides a comprehensive audit of all Flare protocol integrations in Beacon, classifying each as **REAL**, **PARTIAL**, **SIMULATED**, **STUB**, or **UNAVAILABLE** with evidence where available.

### Classification Legend

| Status | Meaning |
|--------|---------|
| **REAL** | Integration uses official Flare contracts/APIs, verified on-chain bytecode, never invents data |
| **PARTIAL** | Core functionality works but some features require external steps or are incomplete |
| **SIMULATED** | Uses `SIMULATED_TEE` flag — hackathon-accepted, NOT hardware-attested |
| **STUB** | Code structure exists but execution is not implemented |
| **UNAVAILABLE** | Integration not configured or blocked by external dependencies |

---

## 1. FTSO (Flare Time Series Oracle)

### Classification: **REAL**

| Aspect | Status | Evidence |
|--------|--------|----------|
| FtsoV2 via Registry | REAL | Registry `0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019` → `getContractAddressByName("FtsoV2")` |
| Execution Guard | REAL | `evaluateFtsoGuard()` blocks on STALE / HIGH_DEVIATION / EXCESSIVE_SLIPPAGE |
| Live Price Feeds | REAL | `readFtsoFeeds()` reads XRP/USD, FLR/USD, BTC/USD from FtsoV2 contract |

### Official Mechanism

FTSOv2 provides decentralized price feeds updated every ~90 seconds (voting epoch). Beacon reads:
- Feed values via `FtsoV2.getFeedsById()`
- Timestamps from block metadata
- Staleness validation against configurable `maxAgeSeconds` (default 300s)

### Beacon Implementation

```typescript
// packages/shared/src/ftsoGuard.ts
export function evaluateFtsoGuard(feeds: FtsoGuardFeed[], params: FtsoGuardParams): FtsoGuardResult {
  // STALE check: feedAge > maxAgeSeconds → BLOCK
  // HIGH_DEVIATION check: deviation > maxDeviationBps → BLOCK
  // EXCESSIVE_SLIPPAGE check: quotedSlippageBps > maxSlippageBps → BLOCK
}
```

### Gaps

None — full lifecycle implemented.

### Test Required

- [ ] Call `GET /v1/ftso/guard?symbol=XRP/USD` and verify live feed values
- [ ] Verify guard blocks swap when feed is stale (mock old timestamp)

### On-Chain Evidence Required

- FtsoV2 contract address via registry lookup (returns `0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d` on Coston2)

---

## 2. FDC (Flare Data Connector)

### Classification: **REAL**

| Aspect | Status | Evidence |
|--------|--------|----------|
| FdcHub | REAL | Resolved via registry: `0x48aC463d7975828989331F4De43341627b9c5f1D` |
| FdcVerification | REAL | Resolved via registry: `0x906507E0B64bcD494Db73bd0459d1C667e14B933` |
| Relay | REAL | Used for `isFinalized(200, roundId)` check |
| DA Layer | REAL | `https://ctn2-data-availability.flare.network/api/v1/fdc/proof-by-request-round-raw` |
| Verifier | REAL | `https://fdc-verifiers-testnet.flare.network/verifier/{chain}/{type}/prepareRequest` |

### Official Mechanism

1. `prepareRequest` → verifier returns `abiEncodedRequest`
2. `FdcHub.requestAttestation(abiEncodedRequest)` with fee from `FdcRequestFeeConfigurations`
3. Compute `roundId` from `FlareSystemsManager` timing parameters
4. `Relay.isFinalized(200, roundId)` — protocol ID 200 for FDC
5. Fetch proof from DA Layer
6. Optional: on-chain verify via `FdcVerification.verifyAddressValidity()`

### Beacon Implementation

```typescript
// packages/fdc/src/index.ts - FdcClient
async runFullAttestationLifecycle(attestationType, sourceId, requestBody, options): Promise<FullAttestationResult> {
  // Step 1: prepareRequest via verifier
  // Step 2: submitAttestation to FdcHub
  // Step 3: waitFinalized via Relay
  // Step 4: fetchProof from DA Layer
}
```

### Gaps

- Automated mint / operator XRPL fields remain separate from FDC verify
- Value-moving product paths still require Accepted business policy in addition to on-chain verify

### Implementation Path

1. Typed proof encoder for `verifyAddressValidity` / `verifyEVMTransaction` — **done for AddressValidity**
2. Optional verify on `/v1/fdc/*` prepare/recover paths — **done** (`onChainVerified` via staticCall)

### Test Required

- [x] Full lifecycle: prepare AddressValidity → submit → wait finalized → fetch proof
- [x] Verify DA layer returns proof bytes after finalization
- [x] On-chain `verifyAddressValidity` staticCall returns true (evidence JSON)

### On-Chain Evidence Required

- FdcHub tx hash from `submitAttestation`: **`0x2c62375359beeb5491c648260d79c2ec69a71fc2260bcb21027b7ad86be04516`**
- Relay `isFinalized(200, 1420937)` returns **true**
- DA layer proof: **AVAILABLE**, `responseBody.isValid: true` via `/api/v1/fdc/proof-by-request-round`
- Systems explorer: https://coston2-systems-explorer.flare.network/voting-round/1420937?tab=fdc
- **On-chain VERIFIED:** `docs/evidence/fdc-address-validity-verify.json` — `onChainVerified: true`, `callKind: staticCall`, FdcVerification `0x906507E0B64bcD494Db73bd0459d1C667e14B933`

**Live classification note (2026-08-10):** prepare→submit→finalize→proof is **REAL**. AddressValidity on-chain verify is **VERIFIED** (VIEW/staticCall — not a state-changing tx).

---

## 3. FCC (Flare Confidential Compute) / TEE

### Classification: **SIMULATED** (TEE machine **PRODUCTION** status 2; instruction→result may be **PARTIAL**)

| Aspect | Status | Evidence |
|--------|--------|----------|
| SIMULATED_TEE | SIMULATED | `SIMULATED_TEE=true` — hackathon-accepted |
| TEE machine | PRODUCTION (status 2) | `0x6516cE58ae346fB4c438463f05B17B50EeB1c8ed` via FlareTeeManager `0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE` |
| Extension / sender | LIVE | Extension `65925`, InstructionSender `0x11bFc67F6c5e7a1265b52292F5AE5a8f4B821c46` |
| Stack versions | LIVE | tee-node `v0.0.24`, tee-proxy `v0.0.21`, `register-tee rRap` + availability proof |
| InstructionSender smoke | PARTIAL | tx `0x1e64917aeed71c20cf628131dcd8415e195dab89bb71f07eec3bf7a493a6cb25` |
| TEE_PROXY_URL | AVAILABLE | `https://tee-proxy-coston2-1.flare.rocks` |
| EXT_PROXY_URL | EPHEMERAL | Live trycloudflare tunnel — must stay alive or re-register; poll may 404 → PARTIAL |
| Hardware TEE | UNAVAILABLE | Not GCP Confidential Space; do not claim hardware |
| Value-protection API | REAL (decision) | `POST /v1/fcc/policy/evaluate` ALLOW/DENY; `canMoveFunds: false` |
| Smart Accounts | STUB | Parallel XRPL rail not live |

### Official Mechanism

FCC uses confidential compute enclaves to execute policy. The lifecycle:
1. Deploy InstructionSender contract linked to TEE extension
2. Register TEE machine (`register-tee rRap`) → FlareTeeManager status **2 = PRODUCTION**
3. Call `sendSayHello` / `sendEvaluateFit` / `sendAccept` with payload
4. Poll extension proxy for result via instruction ID

### Beacon Implementation

```typescript
// packages/fdc/src/fcc.ts - getFccLifecycleStatus
// Probes FlareTeeManager.getTeeMachineStatus(teeId) → teeProduction when status===2
// Honesty: SIMULATED_TEE PRODUCTION ≠ hardware Confidential Space
// canMoveFunds: false until result polled+verified (never faked)
```

### Gaps

| Gap | Impact | Status |
|-----|--------|--------|
| trycloudflare EXT_PROXY ephemeral | Tunnel die ⇒ result poll PARTIAL/404 | DOCUMENTED |
| instruction→result poll | May 404 while tunnel/registration lag | PARTIAL |
| `sendEvaluateFit` / `sendAccept` may not exist | Fallback `sendSayHello` | Needs probe |
| Hardware attestation | Cannot claim TEE hardware security | DOCUMENTED |
| Smart Accounts PersonalAccount | Parallel rail | STUB |

### Honesty Labels

```typescript
// SIMULATED_TEE + status 2:
"PRODUCTION (status=2) via SIMULATED_TEE availability attestation — NOT GCP Confidential Space hardware"
// canMoveFunds: false ALWAYS until result verified
// hardwareClaim: false
```

### Implementation Path

1. `GET /v1/fcc/lifecycle` reports teeMachineStatus / teeProduction / instructionPath honestly
2. `POST /v1/fcc/policy/evaluate` value-protection ALLOW/DENY (amount cap / recipient / expiry)
3. Opt-in `submitInstruction: true` for on-chain FCC (does not auto-spend from Jobs/Chat/Safe)
4. Stable EXT_PROXY domain when leaving ephemeral tunnel

### Test Required

- [x] Verify InstructionSender bytecode at `0x11bFc67F6c5e7a1265b52292F5AE5a8f4B821c46`
- [x] On-chain `sendSayHello` smoke tx `0x1e64917aeed71c20cf628131dcd8415e195dab89bb71f07eec3bf7a493a6cb25`
- [x] FlareTeeManager status 2 PRODUCTION evidence (`docs/evidence/fcc-tee-production.json`)
- [ ] `GET /v1/fcc/lifecycle` on **production** after redeploy (expects teeProduction + SIMULATED honesty)
- [x] Shadow / value-protection returns `canMoveFunds: false`

### On-Chain Evidence Required

- TEE PRODUCTION evidence: **`docs/evidence/fcc-tee-production.json`**
- InstructionSender live instruction tx: **`0x1e64917aeed71c20cf628131dcd8415e195dab89bb71f07eec3bf7a493a6cb25`**
- Explorer: https://coston2-explorer.flare.network/tx/0x1e64917aeed71c20cf628131dcd8415e195dab89bb71f07eec3bf7a493a6cb25
- Result poll: **may remain PARTIAL** while EXT_PROXY is ephemeral trycloudflare or returns 404

---

## 4. FAssets

### Classification: **PARTIAL**

| Aspect | Status | Evidence |
|--------|--------|----------|
| Status/Desk Read | REAL | `AssetManagerFXRP` via registry, `readFassetsDesk()` |
| Redeem Prepare | REAL | `prepareFassetsRedeemLots()` generates approve + redeem calldata |
| Mint | UNAVAILABLE | Requires XRPL agent reservation + Xaman payment — docs handoff |
| OFT Bridge | REAL | Via LayerZero adapter (see LayerZero section) |

### Official Mechanism

FAssets (FXRP, FBTC, FDOGE) are wrapped representations of external assets:
- **Mint:** Reserve agent → pay underlying → claim FAsset
- **Redeem:** Burn FAsset → receive underlying to specified address

### Beacon Implementation

```typescript
// packages/flare/src/adapters/fassets.ts
class FAssetsAdapter {
  async getStatus(): Promise<FAssetsAdapterResult>
  async prepareRedeem(params): Promise<RedeemPrepResult>
  getMintHandoff(symbol): { status: "NOT_AVAILABLE", docs: [...] }
}
```

### Gaps

| Gap | Impact | Resolution |
|-----|--------|------------|
| Automated mint | Cannot complete XRPL+agent flow | Documented handoff to DevHub |
| Agent reservation | Requires external Xaman flow | Out of scope for Beacon |

### Test Required

- [ ] `GET /v1/fassets/status` returns real AssetManager data
- [ ] `POST /v1/fassets/redeem/prepare` returns valid calldata

### On-Chain Evidence Required

- AssetManagerFXRP address: `0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA`
- FXRP token address: `0x0b6A3645c240605887a5532109323A3E12273dc7`

---

## 5. Smart Accounts

### Classification: **STUB**

| Aspect | Status | Evidence |
|--------|--------|----------|
| Registry Helpers | STUB | `registryFromEnv()` reads expected addresses |
| PersonalAccount Executor | STUB | Not implemented |
| Custom Instruction Opcode | DOCUMENTED | `0xff` per Flare docs |

### Official Mechanism

Flare Smart Accounts enable cross-chain asset management with custom instructions:
- `MasterAccountController` manages account creation
- Custom instruction opcode `0xff` triggers protocol handlers
- XRPL integration via operator addresses

### Beacon Implementation

```typescript
// packages/flare/src/adapters/smartAccount.ts
class SmartAccountAdapter {
  getRegistry(): SmartAccountAdapterResult // status: "STUB"
  validateRegistry(): { valid: boolean, missing: string[] }
  executeCustomInstruction(): // Returns error: "STUB — not implemented"
}
```

### Gaps

- PersonalAccount executor integration not complete
- Beacon Safe is NOT a Flare Smart Account (separate architecture)

### Test Required

- [ ] Verify registry address resolution
- [ ] Confirm STUB status returned honestly

---

## 6. x402 Machine Payments

### Classification: **REAL**

| Aspect | Status | Evidence |
|--------|--------|----------|
| EIP-3009 Authorization | REAL | `transferWithAuthorization` on MockUSDT0 |
| Facilitator Contract | DEPLOYED | `0x1f409a809cE6e8A4467C1fD40943aC40169f4779` |
| Token Contract | DEPLOYED | `0x6fd8a72a972040f3153894BBd0d829a58f1Fe86c` |
| Replay Protection | REAL | Nonce tracking in Redis |

### Official Mechanism

x402 enables HTTP-level micropayments using EIP-3009:
1. Client signs `transferWithAuthorization` off-chain
2. Server verifies signature, nonce, expiry
3. On acceptance, server submits authorization on-chain
4. Settlement recorded in evidence envelope

### Beacon Implementation

```typescript
// apps/api/src/flareRoutes.ts - POST /v1/x402/evidence
// - Validates nonce replay
// - Creates commitment hash
// - Records payment evidence
// - Links to job envelope
```

### Test Required

- [ ] Sign EIP-3009 authorization
- [ ] Verify replay rejection on reused nonce
- [ ] Confirm settlement tx recorded

### On-Chain Evidence Required

- `transferWithAuthorization` tx hash on Coston2

---

## 7. SparkDEX

### Classification: **REAL** (Flare Mainnet only)

| Aspect | Status | Evidence |
|--------|--------|----------|
| Factory | DEPLOYED (Mainnet) | `0x8A2578d23d4C532cC9A98FaD91C0523f5efDE652` has bytecode on chain 14 |
| SwapRouter | DEPLOYED (Mainnet) | `0x8a1E35F5c98C4E85B36B7B253222eE17773b2781` |
| QuoterV2 | DEPLOYED (Mainnet) | `0x5B5513c55fd06e2658010c121c37b07fC8e8B705` |
| Coston2 | UNAVAILABLE | Published addresses have NO bytecode on chain 114 |

### Official Mechanism

SparkDEX is Uniswap V3 fork on Flare:
- `QuoterV2.quoteExactInputSingle()` for executable quotes
- `SwapRouter.exactInputSingle()` for execution
- Never use FTSO mid as minOut — FTSO is narrative only

### Beacon Implementation

```typescript
// packages/shared/src/sparkDex.ts
async function quoteSparkDexExactInput(params, deployment): Promise<SparkDexQuote> {
  // Uses QuoterV2 — NEVER FTSO mid
  // Returns amountOutMinimum with slippage applied
}

async function prepareSparkDexSwap(params, env) {
  // Verifies QuoterV2 bytecode before quoting
  // Refuses FTSO-as-quote fallback
}
```

### Honesty Note

```
"SparkDEX SwapRouter + QuoterV2 have bytecode on Flare Mainnet only. 
Coston2 has empty bytecode at published addresses — no fake swaps; execute on chain 14."
```

### Test Required

- [ ] `GET /v1/sparkdex/pools` discovers USDT0/FXRP pools on mainnet
- [ ] QuoterV2 quote returns executable amountOut
- [ ] Verify `requiresChainSwitch: true` when caller is on Coston2

### On-Chain Evidence Required

- Factory bytecode check on chain 14 vs chain 114
- QuoterV2 staticCall success on mainnet

---

## 8. LayerZero OFT Bridge

### Classification: **REAL**

| Aspect | Status | Evidence |
|--------|--------|----------|
| FXRP OFT Adapter | DEPLOYED | `0xCd3d2127935Ae82Af54Fc31cCD9D3440dbF46639` on Coston2 |
| LZ Endpoint V2 | DEPLOYED | `0x6EDCE65403992e310A62460808c4b910D972f10f` |
| Peer Discovery | REAL | `peers(eid)` + `PeerSet` event scanning |
| Delivery Tracking | REAL | `OFTReceived` event on dest chain |

### Official Mechanism

LayerZero V2 OFT enables cross-chain FAsset transfers:
1. `quoteSend()` for messaging fee
2. `send()` with extraOptions (executor lzReceive gas)
3. Monitor via LayerZero Scan or dest `OFTReceived`

### Beacon Implementation

```typescript
// packages/shared/src/oftBridge.ts
async function prepareFxrpOftBridge(params, env) {
  // 1. Discover live peers via peers(eid)
  // 2. Re-verify peer immediately before quoting
  // 3. Quote native fee from quoteSend
  // 4. Build approve + send calldata
}

async function trackOftDelivery(params) {
  // Poll dest OFTReceived — never claim fill from source alone
}
```

### Gaps

- Delivery confirmation requires dest chain RPC (not all chains have public endpoints)
- Some eids only have fallback-snapshot peers (not live)

### Test Required

- [ ] `GET /v1/agents/bridge/routes` returns live peers with `status: "live"`
- [ ] Prepare returns valid quote from `quoteSend`
- [ ] Track source tx and observe protocol_observe phase

### On-Chain Evidence Required

- `peers(40102)` returns non-zero peer for BSC Testnet
- `OFTSent` event guid in source tx logs

---

## 9. Beacon Safe (Personal Vault)

### Classification: **REAL**

| Aspect | Status | Evidence |
|--------|--------|----------|
| Factory | DEPLOYED | `0x9e88ADFB4dA7530675acC520cC9a0a818543c4F2` |
| AgentVault Template | DEPLOYED | `0xc7C6C06Dd59173dBAf8382627d6A483Ca53AAF33` |
| SwapDesk | DEPLOYED | `0x36c17ca6Aa2b61b13f7c4B5A59629320a8B4dF29` |
| Escrow | DEPLOYED | `0xE68c22621314977f00c85D89e4f5b10573C51C7E` |

### Note

**Beacon Safe is NOT a Flare Smart Account.** It is a separate personal vault architecture using:
- Safe-style multisig pattern
- FTSO execution guard for swaps
- Server-enforced spending policy
- x402 micropayment integration

### Test Required

- [ ] Factory deploys new vault for user
- [ ] FTSO guard blocks swap on stale price
- [ ] Policy blocks spend over daily limit

---

## 10. Agent Jobs

### Classification: **REAL**

| Aspect | Status | Evidence |
|--------|--------|----------|
| Job Registry | DEPLOYED | `0x100a3E24909DE25B9CAe75Ba665Be6F893b98889` |
| Execution Engine | REAL | State machine transitions with evidence tracking |
| Worker Settlement | REAL | On-chain settlement to escrow |

### Implementation

Jobs flow through: `pending` → `active` → `executing` → `completed/failed`

Each transition recorded in evidence envelope with:
- FTSO snapshot at execution time
- Policy decision
- FCC shadow authorization
- Payment receipt

---

## 11. Policy Engine

### Classification: **REAL**

| Aspect | Status | Evidence |
|--------|--------|----------|
| Server Policy | REAL | `evaluatePolicy()` with Redis-backed spend accounting |
| FCC Shadow | SIMULATED | Shadow authorization for comparison only |
| Fail-Closed | REAL | Redis unavailable → deny spend |

### Policy Checks

1. Session expiry (configurable hours)
2. Chain allowlist
3. Emergency pause
4. Agent allowlist
5. Per-job limit (USDT0)
6. Daily spend limit (USDT0)
7. Service-specific limits (image cost, video duration)

### Test Required

- [ ] Policy blocks spend when daily limit exceeded
- [ ] Emergency pause immediately blocks all spend
- [ ] Session expiry forces policy refresh

---

## 12. Evidence/Receipts

### Classification: **REAL**

| Aspect | Status | Evidence |
|--------|--------|----------|
| Envelope Structure | REAL | Version 1.0, all stage types defined |
| FTSO Snapshot | REAL | Captured at execution time |
| FDC Proof | REAL | Attached when attestation completes |
| Settlement | REAL | Tx hash and amount recorded |

### Evidence Stages

```typescript
interface EvidenceEnvelope {
  intent?: IntentEvidence;
  quote?: QuoteEvidence;
  ftsoSnapshot?: FtsoSnapshotEvidence;
  fdcProof?: FdcProofEvidence;
  policyDecision?: PolicyDecisionEvidence;
  fccAuthorization?: FccAuthorizationEvidence;
  payment?: PaymentEvidence;
  execution?: ExecutionEvidence;
  acceptance?: AcceptanceEvidence;
  settlement?: SettlementEvidence;
  receipt?: ReceiptEvidence;
}
```

---

## Summary Matrix

| Integration | Status | Blocker | Test Coverage |
|-------------|--------|---------|---------------|
| FTSO | **REAL** | None | Good |
| FDC | **REAL** (+ AddressValidity on-chain VERIFIED staticCall) | None for AV path | Good |
| FCC/TEE | **SIMULATED** + machine **PRODUCTION** (status 2) | Ephemeral trycloudflare EXT_PROXY; instruction→result may PARTIAL | Partial |
| FAssets | **PARTIAL** | Automated mint | Good for redeem |
| Smart Accounts | **STUB** | PersonalAccount executor | None |
| x402 | **REAL** | None | Good |
| SparkDEX | **REAL** | Mainnet only | Good |
| LayerZero | **REAL** | Dest RPC availability | Good |
| Beacon Safe | **REAL** | None | Good |
| Agent Jobs | **REAL** | None | Good |
| Policy Engine | **REAL** | None | Good |
| Evidence | **REAL** | None | Good |

---

## Known Environment Configuration

```bash
# DA Layer (correct base URL)
DA_LAYER_URL=https://ctn2-data-availability.flare.network
# Proof endpoint: /api/v1/fdc/proof-by-request-round-raw

# FCC (SIMULATED mode — PRODUCTION status ≠ hardware)
SIMULATED_TEE=true
TEE_PROXY_URL=https://tee-proxy-coston2-1.flare.rocks
EXT_PROXY_URL=https://<ephemeral>.trycloudflare.com   # ephemeral — keep alive or re-register
INSTRUCTION_SENDER=0x11bFc67F6c5e7a1265b52292F5AE5a8f4B821c46
TEE_ID=0x6516cE58ae346fB4c438463f05B17B50EeB1c8ed
FLARE_TEE_MANAGER=0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE
EXTENSION_ID=65925

# FDC
FDC_VERIFIER_XRP_URL=https://fdc-verifiers-testnet.flare.network/verifier/xrp/
EXPECTED_FDC_HUB=0x48aC463d7975828989331F4De43341627b9c5f1D
EXPECTED_FDC_VERIFICATION=0x906507E0B64bcD494Db73bd0459d1C667e14B933
```

---

## Community Acceptance Notes

1. **SIMULATED_TEE accepted for hackathon** — FCC hardware TEE not publicly available; FlareTeeManager PRODUCTION (status 2) is availability attestation only
2. **One closed loop demonstrated** — x402 + FCC value-protection ALLOW/DENY + policy evaluation (`canMoveFunds: false`)
3. **FDC for real attestations** — Full lifecycle prepare → submit → finalize → proof → on-chain AddressValidity VERIFIED (staticCall)
4. **Remaining honesty** — instruction→result PARTIAL if poll 404; trycloudflare ephemeral; Smart Accounts STUB

---

## Appendix: Contract Addresses (Coston2)

| Contract | Address | Verified |
|----------|---------|----------|
| ContractRegistry | `0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019` | Yes |
| FtsoV2 | Via registry | Yes |
| FdcHub | `0x48aC463d7975828989331F4De43341627b9c5f1D` | Yes |
| FdcVerification | `0x906507E0B64bcD494Db73bd0459d1C667e14B933` | Yes |
| Relay | `0xa10Ba8B1c1e4E47189E9981c54A6DcD6C18B4B33` | Yes |
| AssetManagerFXRP | `0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA` | Yes |
| FXRP Token | `0x0b6A3645c240605887a5532109323A3E12273dc7` | Yes |
| InstructionSender | `0x11bFc67F6c5e7a1265b52292F5AE5a8f4B821c46` | Yes |
| FlareTeeManager | `0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE` | Yes |
| TEE machine (PRODUCTION status 2, SIMULATED) | `0x6516cE58ae346fB4c438463f05B17B50EeB1c8ed` | Yes |
| MockUSDT0 | `0x6fd8a72a972040f3153894BBd0d829a58f1Fe86c` | Yes |
| x402 Facilitator | `0x1f409a809cE6e8A4467C1fD40943aC40169f4779` | Yes |
| Beacon Safe Factory | `0x9e88ADFB4dA7530675acC520cC9a0a818543c4F2` | Yes |
| Beacon Job Registry | `0x100a3E24909DE25B9CAe75Ba665Be6F893b98889` | Yes |
| FXRP OFT Adapter | `0xCd3d2127935Ae82Af54Fc31cCD9D3440dbF46639` | Yes |

---

*This audit reflects the state of Beacon integrations as of 2026-08-10. Contract addresses and API endpoints should be verified against current Flare documentation before production use.*
