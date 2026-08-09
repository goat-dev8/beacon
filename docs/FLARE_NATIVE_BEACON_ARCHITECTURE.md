# Flare-Native Beacon Architecture

**Honesty labels:** `REAL` | `SIMULATED` | `STUB` | `NOT AVAILABLE`  
**Companion:** [`FLARE_DEEP_RESEARCH.md`](./FLARE_DEEP_RESEARCH.md) · [`FLARE_INTEGRATION_GAP_MATRIX.md`](./FLARE_INTEGRATION_GAP_MATRIX.md) · [`FLARE_IMPLEMENTATION_PLAN.md`](./FLARE_IMPLEMENTATION_PLAN.md)

---

## 1. Product thesis

Beacon becomes a **Flare-native AI execution OS** by composing:

| Need | Flare / Beacon surface | Honesty today |
| --- | --- | --- |
| Decision data | FTSOv2 via ContractRegistry | REAL reads |
| External evidence | FDC | STUB in Flow/API |
| Confidential policy | FCC / FCE | SIMULATED_TEE |
| Machine payment | x402 EIP-3009 | REAL |
| Agent spend vault | Personal BeaconAgentVault (Safe) | REAL |
| XRP liquidity | FAssets + Smart Accounts | Partial / STUB |
| Cross-chain FXRP | LayerZero OFT | REAL source path |

**Non-goals:** rewrite Flow/Safe/Jobs/AI router; force every primitive into one path; claim hardware TEE or live FDC without proofs.

---

## 2. Current architecture (as deployed / wired)

### 2.1 Current system context

```mermaid
flowchart TB
  subgraph Clients
    Web[apps/web Flow Safe Jobs]
  end

  subgraph API["apps/api REAL"]
    Router[Agent / Jobs / Safe routes]
    Session[Safe agent session]
    Policy[assertPolicyAllows Redis/on-chain caps]
    X402[EIP-3009 settle Facilitator]
  end

  subgraph Shared["packages/shared REAL"]
    FTSO[ftso.ts ContractRegistry]
    SafeLock[safeJobLock 2 txs]
    OFT[oftBridge live peers]
    FAssets[fassetsStatus prepare / docs_handoff mint]
  end

  subgraph Coston2["Coston2 chain 114"]
    Registry[ContractRegistry 0xaD67…6019]
    FtsoV2[FtsoV2 via registry]
    Mock[MockUSDT0 0x6fd8…e86c]
    Fac[Facilitator 0x1f409…4779]
    Escrow[Escrow 0xE68c…1C7E]
    Factory[SafeFactory 0x9e88…c4F2]
    Vault[Personal BeaconAgentVault]
    Desk[SwapDesk 0x36c1…dF29]
    JobsReg[JobRegistry 0x100a…8889]
    OftA[FXRP OFT 0xCd3d…6639]
  end

  subgraph StubZone["STUB / SIMULATED — not product-wired"]
    FdcPkg[packages/fdc FdcClient]
    FccCli[FccExtensionClient SIMULATED_TEE]
    SaPkg[smart-accounts helpers + opcode conflict]
  end

  Web --> Router
  Router --> Session
  Router --> X402
  Router --> SafeLock
  Router --> FTSO
  Router --> OFT
  Router --> FAssets
  SafeLock --> Vault
  SafeLock --> Escrow
  FTSO --> Registry --> FtsoV2
  X402 --> Fac
  X402 --> Mock
  Desk --> FtsoV2
  Factory --> Vault
  Router -.->|P0 bug: lock before policy on Safe approve| Policy
  FdcPkg -.->|not imported by Flow/API| Router
  FccCli -.->|status / scaffold only| Router
  SaPkg -.->|not PersonalAccount executor| Router
```

### 2.2 Jobs Safe lock lifecycle (REAL, 2 txs)

```mermaid
sequenceDiagram
  participant User
  participant API as apps/api
  participant Vault as BeaconAgentVault
  participant Escrow as BeaconEscrow
  participant Policy as assertPolicyAllows

  User->>API: approve / approve-safe
  Note over API,Policy: P0 BUG: current order locks then checks policy
  API->>Vault: execute(token.transfer escrow)
  Vault-->>API: spendTxHash
  API->>Escrow: lockPrepaid(jobId, vault, amount)
  Escrow-->>API: lockTxHash
  API->>Policy: assertPolicyAllows
  Note over Policy: Should run BEFORE vault/escrow txs
```

**Correct target order:** session → policy (and FCC when enforced) → `vault.execute` → `lockPrepaid` → record spend → receipt.

### 2.3 Trust boundaries today

| Boundary | Who is trusted | Honesty |
| --- | --- | --- |
| Owner wallet | Signs deposits / EIP-3009; owns personal vault | REAL |
| Settler / executor key | Gas relayer for vault.execute + escrow ops | REAL — must not bypass policy |
| Redis / server policy | `assertPolicyAllows` | REAL but currently after Safe lock (bug) |
| On-chain vault caps | maxSpend / allowlists / pause | REAL defense-in-depth |
| FCC | Simulated attestation | SIMULATED — not hardware |
| FDC | Unused in product path | STUB |
| Application receipt | UX record + explorer links | REAL as app record, not FDC proof |

---

## 3. Target architecture

### 3.1 Intent → evidence → authorize → pay → execute → prove

```mermaid
flowchart LR
  User[UserIntent] --> Compiler[IntentCompiler]
  Compiler --> DataPlan[EvidenceAndDataPlan]
  DataPlan --> FTSO[FTSOV2Snapshot]
  DataPlan --> FDC[FDCProofOptional]
  FTSO --> Decision[ExecutionDecision]
  FDC --> Decision
  Decision --> FCC[FCCPolicyAuthorization]
  FCC --> Payment[SafeOrX402Payment]
  Payment --> Execute[FXRPOrAgentExecution]
  Execute --> LZ[LayerZeroOptional]
  Execute --> Receipt[EvidenceReceipt]
  LZ --> Receipt
```

**Honesty rule:** FDC, FCC, FAssets, Smart Accounts, and LayerZero appear in the receipt **only** when their proof is visible in that run. Otherwise omit or label `NOT AVAILABLE` / `STUB` / `SIMULATED`.

### 3.2 Adapter layer (target)

```mermaid
flowchart TB
  Flow[Flow / Jobs / Safe UI]
  API[apps/api]
  subgraph Adapters["packages/flare adapters — to introduce"]
    Price[PriceOracleAdapter]
    Attest[AttestationAdapter]
    FA[FAssetsAdapter]
    SA[SmartAccountAdapter]
    Pay[PaymentAdapter]
    XChain[CrossChainAdapter]
    Conf[ConfidentialComputeAdapter experimental]
  end
  Env[EvidenceEnvelope]
  Chain[Coston2 + optional XRPL / dest chains]

  Flow --> API
  API --> Adapters
  Adapters --> Env
  Adapters --> Chain
```

Risky features stay behind **executable** flags: FDC, FCC shadow/enforced, Smart Accounts, FAssets direct mint, cross-chain compose.

### 3.3 EvidenceEnvelope (target schema — conceptual)

Shared envelope fields (implementation later; no invented APIs beyond this doc contract):

| Field | Purpose |
| --- | --- |
| inputCommitment | Hash of user intent / job id / service id |
| quoteOrDataSnapshot | FTSO timestamp + feeds / quote |
| policyDecision | allow/deny, epoch, reason commitment |
| payment | x402 auth or Safe spend+lock hashes |
| execution | Agent / swap / mint result refs |
| externalProof | FDC proof hash / round when used |
| crossChain | OFT GUID + dest receipt when claimed complete |
| receiptLinks | Explorer URLs for **real** hashes only |

---

## 4. Protocol-specific architectures

### 4.1 FTSO execution guard (P0)

```mermaid
flowchart LR
  Quote[Agent quote / SwapDesk] --> Guard{BeaconExecutionGuard}
  Registry[ContractRegistry] --> Ftso[FtsoV2 freshness]
  Ftso --> Guard
  Guard -->|pass| Exec[Safe execute / x402 price]
  Guard -->|stale / deviation / breaker| Block[Fail closed + receipt]
```

**Label today:** FTSO reads REAL; guard module NOT YET product — treat as planned REAL.

### 4.2 FDC evidence engine (P0 when claimed)

Official lifecycle (see https://dev.flare.network/fdc/overview): encode/prepare → `FdcHub.requestAttestation` → voting round → Relay finalization → DA proof → `FdcVerification`.

Beacon target consumers (allowlisted only):

1. `EVMTransaction` — external chain execution evidence  
2. Payment / XRPLPayment — funding / action evidence  
3. Deterministic allowlisted `Web2Json` — event-triggered agents  

Never treat a structurally valid proof as sufficient business authorization without Beacon policy.

**Today:** `STUB` in Flow/API.

### 4.3 FCC confidential authorization (P1)

```mermaid
stateDiagram-v2
  [*] --> SimulatedScaffold: FccExtensionClient
  SimulatedScaffold --> ShadowMode: compare vs Redis/on-chain\ncannot move funds
  ShadowMode --> OptInV2: BeaconAgentVaultV2\non-chain verify auth
  OptInV2 --> Hardware: only with registered\nmachine + code hash
  Hardware --> [*]: REAL confidentiality
  OptInV2 --> SimulatedLabel: if no hardware\nkeep SIMULATED_TEE label
```

Official note: FCC **not yet fully public production** — https://dev.flare.network/fcc/overview  

V1 factory Safes are **never** silently migrated.

### 4.4 Dual rails: Beacon Safe vs Smart Accounts (P1)

```mermaid
flowchart TB
  subgraph EVMRail["EVM MetaMask rail REAL"]
    MM[Owner wallet]
    Fact[BeaconSafeFactory]
    BV[Personal BeaconAgentVault]
    MM --> Fact --> BV
    BV --> Jobs[Jobs escrow / x402 adjacent]
  end

  subgraph XRPRail["XRPL parallel rail TARGET"]
    Xaman[Xaman / XRPL owner]
    PA[PersonalAccount via MasterAccountController]
    FXRP[FXRP direct mint]
    Instr[Official 0xFE / 0xFF instructions]
    Xaman --> PA
    Xaman --> FXRP
    FXRP --> Instr
  end

  Note1[Do not rename Beacon Safe as Smart Account]
  Note2[Rename local CUSTOM_INSTRUCTION_OPCODES 0xfe/0xff\nbefore any Beacon memo expansion]
```

`MasterAccountController` expected: `0x434936d47503353f06750Db1A444DBDC5F0AD37c`.

### 4.5 LayerZero (P2)

```mermaid
sequenceDiagram
  participant User
  participant Beacon
  participant OFT as FXRP OFT Adapter
  participant LZ as LayerZero
  participant Dest as Destination chain

  User->>Beacon: prepare/execute OFT
  Beacon->>OFT: live peers check
  OFT-->>Beacon: peer ok or reject
  Beacon->>OFT: send
  OFT-->>Beacon: source tx + GUID
  Beacon->>LZ: track delivery
  LZ-->>Dest: message
  Dest-->>Beacon: dest receipt REQUIRED for complete
  Note over Beacon: Without dest proof status stays in-flight / incomplete
```

---

## 5. Judge flows (narrow demos)

### Primary — Verifiable Agent Spend

1. Fund personal Safe (MockUSDT0).  
2. FTSO-bound quote / decision.  
3. Optional deterministic FDC trigger **only if verified**.  
4. Policy: server + optional FCC shadow/V2.  
5. Pay: x402 machine service and/or Safe escrow.  
6. Execute agent action.  
7. Evidence receipt opens **real** Coston2 explorer links.

Primary remains valid with FCC labeled `SIMULATED_TEE`.

### Secondary — One XRPL Intent

1. Xaman payment → direct mint FXRP to PersonalAccount.  
2. Allowlisted Smart Account instruction.  
3. Optional LZ bridge **only with dest proof**.  
4. Receipt spans XRPL + FDC/FAssets + Flare (+ dest).

Keep secondary **parallel** to MetaMask Safe; do not force XRPL users into MockUSDT0 Safe path.

---

## 6. Failure modes

| Failure | Behavior |
| --- | --- |
| Policy deny | Zero spend txs; authorization receipt shows deny |
| FTSO stale / breaker | Fail closed for value-moving guarded actions; informational UI may degrade read-only |
| FDC timeout | Job/action shows timed-out; no false “verified” |
| FCC unavailable | No fail-open for enforced mode; V1 policy remains |
| FCC SIMULATED | Explicit honesty badge; no hardware claim |
| LZ no dest proof | Never mark complete |
| Opcode misuse | Block until Beacon locals renamed away from `0xFE`/`0xFF` |
| Mint without XRPL | Remain `docs_handoff` — no fake button |

---

## 7. Security architecture notes

1. **P0:** move `assertPolicyAllows` before `executeSafeJobLock` in both approve routes.  
2. Executor is a gas relayer, not an authorization oracle.  
3. On-chain vault limits remain after FCC lands.  
4. EvidenceEnvelope commitments should make receipts inspectable without inventing hashes.  
5. Feature flags must be executable, not documentation-only.

---

## 8. Honesty summary for architecture slides

| Claim | Label |
| --- | --- |
| Personal Safe + Jobs 2-tx lock + x402 + FTSO reads + OFT with live peers | REAL |
| FCC confidentiality | SIMULATED |
| Flow FDC | STUB |
| Smart Accounts product rail | STUB (helpers; opcode rename required) |
| Hardware TEE / official flare-fcc skill | NOT AVAILABLE |

**Next:** [`FLARE_IMPLEMENTATION_PLAN.md`](./FLARE_IMPLEMENTATION_PLAN.md)
