# Beacon Master Document

**Single source of truth for Beacon (Flare AI OS).**  
**Network:** Flare Testnet Coston2 (chain ID **114**)  
**Last aligned with:** `history.md` (2026-08-12 production hardware FCC live on Render + Vercel), `docs/evidence/hardware-fcc/prod-status.json`  
**Rule:** Do not invent facts. Mark unknowns as TODO. No secrets in this file.

---

## 1. Product definition

**Beacon = Flare AI OS.**

Beacon turns market or work intent into a settled path: quote -> policy -> payment -> execution -> explorer receipt.

Tagline from package / product copy: **Finish AI work. Pay only when it passes.**

Landing framing (`WhatIsBeacon`): a conversation that turns market intent into quote, policy, payment, execution, and an explorer receipt. Signal -> Quote -> Policy -> Pay -> Execute -> Receipt.

Beacon is **not** Flare Smart Accounts (XRPL personal accounts). MetaMask / Rabby users use **Beacon Safe** (`BeaconAgentVault`) — **one personal vault per wallet** created via `BeaconSafeFactory` on Coston2.

---

## 2. User journey

```
Landing (/)
  -> /start (Get Started walkthrough)
  -> Connect wallet (MetaMask / Rabby, Coston2 only)
  -> Fund Beacon Safe (EIP-3009 deposit or transfer of MockUSDT0)
  -> Set spending policy (caps, window, session, pause)
  -> FCC path is hardware-backed GCP Confidential Space (AMD SEV) on Coston2; FlareTeeManager status 2 PRODUCTION; `canMoveFunds: false`
  -> x402 micropays in Flow (Facilitator + EIP-3009) and/or Agent Jobs escrow
  -> Receipts (job receipt + explorer tx links)
  -> Flow (/flow) for ongoing chat OS work
```

### Routes (`App.tsx`)

| Path | Surface |
|------|---------|
| `/` | Landing |
| `/start` | Get Started |
| `/flow` | Flow (chat OS) |
| `/flow/desk` | Agent Jobs (nav label: **Jobs**) |
| `/flow/security` | Safe |
| `/flow/mcp` | Connect Agents (Beacon MCP) |
| `/mcp` | Redirect -> `/flow/mcp` |
| `/app` | Redirect -> `/flow/desk` |
| `/desk-legacy` | Legacy AppPage |
| `*` | Redirect -> `/` |

---

## 3. Surfaces

| Surface | Route | Role |
|---------|-------|------|
| **Flow** | `/flow` | Chat OS: swap, bridge, research, signals, portfolio, risk, yield, FAssets, x402 micropays |
| **Agent Jobs** | `/flow/desk` | Paid AI generation with escrow + receipt (formerly Bound Work; nav: **Jobs**) |
| **Safe** | `/flow/security` | Create personal Safe, fund once, set policy, pause/resume; MockUSDT0 balance for that wallet’s agent spends + jobs |
| **Connect Agents** | `/flow/mcp` (`/mcp`) | Authorize Claude / Cursor / generic MCP clients to use Beacon tools without ever receiving private keys |

Nav rail (`ProductShell`): Flow -> Jobs -> Safe -> Agents.

---

## 3b. Beacon MCP (external agents)

**Purpose:** Let Claude, Cursor, or any MCP-compatible client call Beacon on behalf of a user — without custody of keys.

```
External AI Agent
  -> POST /mcp (Bearer MCP access token)
  -> grant resolve (Redis, per wallet)
  -> scope + spend gate (@beacon/mcp)
  -> app policy (assertPolicyAllows)
  -> Beacon Safe / existing execution rails
  -> structured result + explorer proof + audit
```

**Auth:** Wallet Safe-session unlock on Connect Agents → create grant (scopes, per-tx/daily MCP caps, TTL) → short-lived access token (1h HMAC) + refresh token. OAuth discovery + PKCE code exchange available for clients that support it.

**Boundary:** MCP caps are ceilings. On-chain Safe policy + emergency pause remain the financial boundary. Emergency revoke on Safe also revokes all MCP grants for that wallet.

**Package:** `packages/mcp`. **Routes:** `apps/api/src/mcpRoutes.ts`. **UI:** `apps/web/src/pages/McpPage.tsx`.

**Default Connect scopes (Flow parity):** all read scopes + `exec:swap`, `exec:bridge`, `exec:job`, `exec:x402`, `exec:fassets_redeem`.

**Tools (match Flow rails):**
| Flow tile | MCP tools |
|-----------|-----------|
| Swap | `swap` (Safe MockUSDT0→FXRP Coston2) |
| Bridge | `get_bridge_routes`, `bridge` (Agent OFT; destination e.g. Sepolia) |
| Signals | `get_signals` (FTSO + market intel) |
| Portfolio | `get_portfolio`, `get_balance`, `get_safe` |
| Yield | `get_yield` |
| FAssets | `get_fassets`, `fassets_redeem` (prepare; needs XRPL `r…`) |
| x402 | `x402_pay` (intent + Flow settle honesty) |
| Jobs | `create_job`, `get_job` / `get_job_status` |

Bridge spend/policy is evaluated on **Coston2 (114)**. Destination peer names are LayerZero routes — Sepolia does **not** need to be in `allowedChains`.

---

## 4. Architecture diagram (text)

```
                         apps/web (Vercel)
                    Landing -> /start -> ProductShell
                    Flow -> Jobs -> Safe -> Agents (MCP)
                                   |
                                 HTTPS
                                   |
                         apps/api (Render)
                    Fastify -> jobs -> vault -> agents
                    flow -> x402 settle -> security
                    mcp (/mcp) -> grants -> Safe rails
                    (+ embedded workers when enabled)
                                   |
              Postgres + Upstash Redis + Coston2 RPC
                                   |
         MockUSDT0 / Facilitator / Escrow / Vault / JobRegistry

  orchestrator: generate / accept
  settler: release / refund / receipts

  Coston2 (chain 114):
  MockUSDT0, Facilitator, Escrow, AgentVault, JobRegistry, SwapDesk
  FTSO (execution guard on Safe swaps), FAssets status/redeem, LayerZero OFT + delivery track
  FDC API lifecycle (REAL + on-chain AddressValidity VERIFIED via staticCall; never invented proofs)
  FCC shadow + value-protection evaluate (hardware GCP Confidential Space; FlareTeeManager PRODUCTION status 2)

* FDC: API `/v1/fdc/*` wired; Flow does not silently fake attestations. Evidence: `docs/evidence/fdc-address-validity-verify.json` (`onChainVerified: true`).
* FCC: `SIMULATED_TEE=false` / `FCC_MODE=verified`. TEE `0xA5E9…646d` on manager `0x1a9C…18aE` is **PRODUCTION (status 2)** with `/info` platform `GCP_AMD_SEV` and measured codeHash `0x2813e4ec…5806`. Shadow / value-protection evaluate cannot move funds (`canMoveFunds: false`). Stable ext-proxy: reserved ngrok `https://policy-handful-outlast.ngrok-free.dev`. Historical simulated TEE `0x6516…c8ed` is paused (development evidence only).
* Beacon Safe ≠ Flare Smart Account. Smart Accounts rail = **STUB**. Local credit memo markers are `0xbe`/`0xbc`, not SA `0xff`.
```

### Packages (workspaces)

`packages/shared`, `flare`, `x402`, `quote`, `execution`, `acceptance`, `pipeline`, `receipts`, `fdc`, `smart-accounts`, `contracts`  
`services/orchestrator`, `services/settler`  
`apps/api`, `apps/web`

**Flare-native research (2026-08-09):** `docs/FLARE_DEEP_RESEARCH.md`, `FLARE_INTEGRATION_GAP_MATRIX.md`, `FLARE_NATIVE_BEACON_ARCHITECTURE.md`, `FLARE_IMPLEMENTATION_PLAN.md`.

---

## 5. Contracts + current Coston2 addresses

**Authoritative live set** (from `ARCHITECTURE_AUDIT.md` + `apps/web/src/lib/chain.ts` defaults):

| Component | Address | Role |
|-----------|---------|------|
| MockUSDT0 | `0x6fd8a72a972040f3153894BBd0d829a58f1Fe86c` | EIP-3009 token (official x402 demo pattern) |
| X402Facilitator | `0x1f409a809cE6e8A4467C1fD40943aC40169f4779` | Settles EIP-3009 for Flow x402 |
| BeaconEscrow (prepaid) | `0xE68c22621314977f00c85D89e4f5b10573C51C7E` | Job lock / release / refund (`lockPrepaid`) |
| **BeaconSafeFactory** | `0x9e88ADFB4dA7530675acC520cC9a0a818543c4F2` | wallet → personal BeaconAgentVault |
| BeaconAgentVault (legacy shared) | `0xc7C6C06Dd59173dBAf8382627d6A483Ca53AAF33` | Pre-factory shared pool — **not** used for new wallets |
| BeaconJobRegistry | `0x100a3E24909DE25B9CAe75Ba665Be6F893b98889` | Job registry |
| Executor / escrow owner / payee | `0xBDfCeE82Bd42FEfA58ee850B3709636a8B6b0034` | Settler key / payee |
| BeaconCoston2SwapDesk | `0x36c17ca6Aa2b61b13f7c4B5A59629320a8B4dF29` | FTSO-synced MockUSDT0->FXRP Safe swaps |

### Contract source files (`packages/contracts/src`)

- `BeaconEscrow.sol`
- `BeaconAgentVault.sol`
- `BeaconSafeFactory.sol`
- `BeaconJobRegistry.sol`
- `BeaconCoston2SwapDesk.sol`
- `X402Facilitator.sol`
- `mocks/MockUSDT0.sol`
- `interfaces/IEIP3009.sol`

### Address honesty notes

- Old escrow `0x68E29567a9eC60D6ADb71901CE187C22Cc087138` **replaced** by prepaid escrow `0xE68c->1C7E`. Env `BEACON_ESCROW` / `VITE_BEACON_ESCROW` must match prepaid.
- **TODO:** `apps/web/.env.example` still lists the old escrow `0x68E2->7138` - treat as stale vs `chain.ts` / audit. Prefer `chain.ts` defaults and Render/Vercel live env.
- Older vault `0x9bD5B894->` appears in history; current vault is `0xc7C6->AAF33`.

---

## 6. Money path

### Primary: Beacon Safe -> Agent Jobs (one session unlock; no per-job wallet prompt)

```
Fund Safe once (EIP-3009 deposit or transfer)
  -> Owner sets spending policy
  -> Owner signs one gas-free Beacon Agent session challenge (24h / browser session)
  -> POST /v1/jobs/:id/approve-safe with wallet-bound Bearer session
  -> vault.execute(token.transfer(escrow, amount))
  -> escrow.lockPrepaid(jobId, vault, amount)   // onlyOwner = settler
  -> Generate -> acceptance
  -> releaseToPayee | refund(to vault)
  -> Receipt
```

### Fallback: wallet EIP-3009 (official Flare gasless pattern)

```
User signs TransferWithAuthorization (from = wallet)
  -> escrow.lockWithAuthorization(...)
  -> Generate -> release | refund(to wallet)
```

### Flow chat x402 (Facilitator, not Jobs escrow)

```
Client request -> HTTP 402 requirements
  -> EIP-712 TransferWithAuthorization
  -> Facilitator settlePayment -> transferWithAuthorization
  -> Resource + payment receipt
```

Agent Jobs escrow is a **product extension** (lock until acceptance), not a replacement for Facilitator.

---

## 7. Honesty constraints (non-negotiable)

1. **EIP-3009 cannot forge from Safe.** Signature must recover to `from`. A contract Safe has no private key for that address. Beacon does **not** set `from = Safe` with a wallet signature. Safe jobs use `vault.execute` + `escrow.lockPrepaid`.
2. **FCC = hardware Confidential Space on Coston2.** Live: `SIMULATED_TEE=false`, `FCC_MODE=verified`. FlareTeeManager **PRODUCTION (status 2)** for TEE `0xA5E9a81044dd4d66384DE09CF95dB317fde5646d` with `/info` `GCP_AMD_SEV` and measured codeHash. `hardwareClaim` is true only when those fields are observed — never hardcoded. `canMoveFunds: false`. Beacon Safe remains the spend boundary. Historical simulated path is documented, not active.
3. **Beacon Safe -> Flare Smart Accounts.** Smart Accounts are XRPL-controlled personal accounts. BeaconAgentVault is a MetaMask/agent policy vault.
4. **MockUSDT0** (`0x6fd8…e86c`) is the payment asset for Safe / Jobs / x402 until FXRP (or faucet USDT0) has official EIP-3009 in Flare x402 guides. Faucet [Coston2](https://faucet.flare.network/coston2) supplies **C2FLR gas** (and optional USDT0/FXRP for other demos). See `docs/RESEARCH_USDT0_FAUCET_VS_MOCK.md`.
5. **Coston2 only** for agent / Safe product rails (chain 114). SparkDEX Mainnet paths are blocked for Safe auto-spend; Safe FXRP uses SwapDesk + FTSO.
6. **FDC** used on Flow attestation paths only - not claimed on Jobs desk.
7. **Agent session = API authentication, not token authorization.** It prevents strangers from triggering a funded Safe. The executor key submits on-chain transactions; the Safe contract remains the custody/policy boundary.
8. **Job receipt is an application record.** It links real Coston2 spend/lock and release/refund hashes but is not itself an on-chain “sealed receipt.”
9. **Safe prepaid lock currently uses two Coston2 transactions.** `vault.execute(transfer)` then `lockPrepaid`; do not describe it as one atomic transaction.

Deep audit: `docs/RESEARCH_AGENT_SAFE_SESSION_AND_REALITY.md`.

### FCC hardware architecture (Coston2)

```
Beacon API / Flow
  -> InstructionSender 0x11bFc67F6c5e7a1265b52292F5AE5a8f4B821c46
  -> Flare data providers POST https://policy-handful-outlast.ngrok-free.dev/instruction
  -> GCP tee-proxy (beacon-fcc-proxy, us-east1-b) :6664
  -> Confidential Space VM beacon-fcc-tee (n2d-standard-2 AMD Milan SEV, MODE=0)
  -> signed result -> ext-proxy /action/result
  -> Beacon verifier / policy evaluate (canMoveFunds: false)
```

- Extension ID `65925` / `0x…10185`
- TEE ID `0xA5E9a81044dd4d66384DE09CF95dB317fde5646d` (status 2 PRODUCTION)
- Image `beacon-fcc-hardware:v0.1.2` digest `sha256:60b9867ad637fb6eacc7a64b4bdc053375d7ac30125681c4dbac0848671af2c5`
- Measured codeHash `0x2813e4ecd1478da4d997ddaf0cde8f33cc6f34d57b174dbae84b3ea56cb75806`
- `/info` platform `GCP_AMD_SEV` (parsed from bytes, never hardcoded into the TEE)
- Evidence: `docs/evidence/hardware-fcc/`

### FCC recovery

1. Confirm `/info` on the reserved HTTPS endpoint still reports `GCP_AMD_SEV` + the measured codeHash.
2. Confirm FlareTeeManager `getTeeMachineStatus` is `2`. Restarting the Confidential Space VM creates a **new TEE identity** — do not reuse a stale teeId. Register the new machine, complete availability (`rRap`), reach PRODUCTION, then pause the stale identity.
3. Keep `SIMULATED_TEE=false` on Render. Do not silently fall back to simulated execution.
4. If the hardware path is down, FCC endpoints must fail closed (`mode=unavailable`, `hardwareClaim=false`) rather than claiming simulated production.
5. Historical simulated evidence (`docs/evidence/fcc-tee-production.json`, paused machines `0x6516…c8ed` / `0x112a…9511`) is not the live path.

---

## 8. Frontend folder structure (`apps/web/src`)

```
apps/web/src/
  App.tsx                 # routes
  main.tsx
  index.css
  assets/
  pages/
    LandingPage.tsx
    GetStartedPage.tsx
    FlowPage.tsx
    DeskPage.tsx          # Agent Jobs
    SecurityPage.tsx      # Safe
    AppPage.tsx           # legacy
  components/
    ProductShell.tsx
    landing/              # Hero, Navbar, Sections, WhyFlare, ->
    flow/                 # ChatColumn, Composer, HistoryRail, ActionCards, ->
    workspace/            # Workspace, ResultExperience, DeskContextStrip
    safe/                 # Deposit, SpendingPolicy, Emergency, VaultPass, ->
    onboarding/
    diagrams/
    ui/
  lib/
    chain.ts              # NETWORK + CONTRACTS
    api.ts
    wallet.ts
    productWallet.tsx
    productTheme.tsx
    x402Pay.ts
    explorers.ts
    types.ts
    ->
```

Vite env prefix: `VITE_*` (see ->10).

---

## 9. Backend

### `apps/api` (Fastify)

Entry: `apps/api/src/index.ts`  
Also: `workers.ts` (embedded job workers), `securityPolicy.ts`, `policyEvaluator.ts`, `flowStore.ts`, `execution/*`, `resources/paidResources.ts`.

**Key route groups:**

| Area | Examples |
|------|----------|
| Health | `GET /health`, `GET /ready`, `GET /v1/ai/probe`, `GET /v1/fcc/status` |
| Jobs | `POST /v1/jobs`, `->/quote`, `->/approve`, `->/approve-safe`, `GET /v1/jobs/:id`, events, artifacts, receipt, look |
| Receipts | `GET /v1/receipts/:id` |
| Agents / Flow rails | signals, swap, fassets, yield, portfolio, bridge, balances, chat, intel |
| Flow store | conversations, activity |
| Vault / Safe | `GET /v1/vault/status`, prepare, safe-swap prepare/execute, swap-desk |
| Security | policy get/put, revoke |
| Credit | `POST /v1/credit/prepare` |
| Chat | `POST /v1/chat/stream` |
| Paid resources / executions | registered via `registerPaidResourceRoutes`, `registerExecutionRoutes` |

### `services/orchestrator`

Polls jobs in `AUTHORIZED` -> `PREPARING` -> `GENERATING` -> `COMPOSING` -> `ACCEPTING`; runs `@beacon/pipeline` and `@beacon/acceptance`.

### `services/settler`

Consumes Redis queue `q:settle` (and `refuse:`); releases/refunds escrow; builds receipts via `@beacon/receipts`.

Production Render may run API with **embedded workers** (`startEmbeddedWorkers`) so separate orchestrator/settler processes are not always required. **TODO:** confirm current Render process model if ops change.

---

## 10. Key env vars (names only)

### App / network

`NODE_ENV`, `APP_NAME`, `APP_URL`, `API_URL`, `API_PORT`, `WEB_PORT`, `LOG_LEVEL`, `SESSION_SECRET`, `ANALYTICS_SALT`, `CHAIN_ID`, `NETWORK_NAME`, `FLARE_REQUIRED`, `ALLOWED_ORIGINS`, `WEB_ORIGIN`

### Coston2 / Flare registry

`COSTON2_RPC_URL`, `COSTON2_WSS_URL`, `COSTON2_EXPLORER_URL`, `COSTON2_FAUCET_URL`, `FLARE_CONTRACT_REGISTRY`, `EXPECTED_ASSET_MANAGER_FXRP`, `EXPECTED_MASTER_ACCOUNT_CONTROLLER`, `EXPECTED_FXRP_TOKEN`, `EXPECTED_FDC_HUB`, `EXPECTED_FDC_VERIFICATION`, `EXPECTED_CORE_VAULT_XRPL`, `EXPECTED_OPERATOR_XRPL`, `EXPECTED_FIRST_VOTING_ROUND_START_TS`, `EXPECTED_VOTING_EPOCH_DURATION_SECONDS`

### Keys (never commit values)

`DEPLOYER_PRIVATE_KEY`, `DEPLOYER_ADDRESS`, `SETTLER_PRIVATE_KEY`, `SETTLER_ADDRESS`, `DEPLOYMENT_PRIVATE_KEY`, `INITIAL_OWNER`, `PROXY_PRIVATE_KEY`, `VAULT_EXECUTOR`

### Contracts / billing

`X402_TOKEN_ADDRESS`, `X402_FACILITATOR_ADDRESS`, `X402_PAYEE_ADDRESS`, `BEACON_JOB_REGISTRY`, `BEACON_ESCROW`, `BEACON_CREDIT`, `BEACON_AGENT_VAULT_ADDRESS`, `BEACON_SWAP_DESK_ADDRESS`

### FCC

`FCC_MODE`, `SIMULATED_TEE`, `LOCAL_MODE`, `MODE`, `TEE_PROXY_URL`, `NORMAL_PROXY_URL`, `EXT_PROXY_URL`, `EXT_PROXY_PORT`, `CHAIN_URL`, `LANGUAGE`, `TEE_NODE_VERSION`, `EXTENSION_PORT`, `GOVERNANCE_SIGNERS`, `GOVERNANCE_THRESHOLD`, `EXTENSION_ID`, `INSTRUCTION_SENDER`, `TEE_ID`, `FLARE_TEE_MANAGER`

### Data / AI / media

`DATABASE_URL`, `DATABASE_URL_DIRECT`, `DATABASE_SSL`, `REDIS_URL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `AI_BASE_URL`, `AI_API_KEY`, `AI_PROXY_URL`, `AI_PROXY_SECRET`, `AI_MODEL_GENERATOR`, `AI_MODEL_JUDGE`, `OPENAI_*`, `ANTHROPIC_*`, pipeline/media keys (`OPENMONTAGE_ROOT`, `COMFYUI_*`, `HF_*`, `POLLINATIONS_*`, ->), `S3_*`

### Feature flags

`ENABLE_API`, `ENABLE_FCC`, `ENABLE_PIPELINE`, `ENABLE_SETTLER`, `ENABLE_FUNDING`, `ENABLE_WEB`

### Web (`apps/web`)

`VITE_API_URL`, `VITE_RPC_URL`, `VITE_X402_TOKEN_ADDRESS`, `VITE_X402_FACILITATOR_ADDRESS`, `VITE_X402_PAYEE_ADDRESS`, `VITE_BEACON_JOB_REGISTRY`, `VITE_BEACON_ESCROW`, `VITE_BEACON_AGENT_VAULT_ADDRESS`

Also: FDC / XRPL / Xaman keys in root `.env.example` for Smart Accounts / FDC paths.

---

## 11. Deployments

| Surface | URL |
|---------|-----|
| Web (Vercel `beacon-desk`) | https://beacon-desk.vercel.app |
| API (Render `beacon-api`) | https://beacon-api-97gl.onrender.com |

Typical AI hop noted in history: Render `AI_PROXY_URL` -> `https://beacon-desk.vercel.app/api/ai/proxy`.

Local desk (dev): `http://localhost:5173` -> API `http://127.0.0.1:3001` (when running locally).

---

## 12. Explorer

- **Coston2 explorer:** https://coston2-explorer.flare.network  
- **RPC default:** https://coston2-api.flare.network/ext/C/rpc  
- **Faucet:** https://faucet.flare.network/coston2 — request **C2FLR** before Create Safe; do **not** expect faucet USDT0 to fund Beacon Safe (use in-app MockUSDT0 mint).
- Token research: `docs/RESEARCH_USDT0_FAUCET_VS_MOCK.md`
- LayerZero testnet scan (bridge txs): https://testnet.layerzeroscan.com (when OFT used)

---

## 13. Flare rails (how Beacon uses them)

| Rail | Beacon usage | Honesty |
|------|--------------|---------|
| **FTSO** | Safe SwapDesk pricing (MockUSDT0->FXRP) | Compliant |
| **FAssets / FXRP** | Flow status + redeem prepare/track (COMPLETED gated on XRPL evidence); Safe FXRP swaps | Compliant (honest lifecycle) |
| **LayerZero OFT** | Flow bridge intents / agent bridge | Compliant (Flow) |
| **x402** | Flow micropays via Facilitator + EIP-3009 | Compliant |
| **FDC** | Flow attestation paths + on-chain AddressValidity VERIFIED (staticCall) | Not claimed on Jobs desk |
| **FCC** | Lifecycle + value-protection evaluate (ALLOW/DENY) | Hardware GCP Confidential Space (`GCP_AMD_SEV`); PRODUCTION status 2; `canMoveFunds: false` |
| **EIP-3009 / MockUSDT0** | Safe funding, wallet job locks, x402 | Compliant; no forged Safe-as-from |

---

## 14. Testing: Chrome E2E expectations

Method used in history: Chrome DevTools against production desk + MetaMask on Coston2. MetaMask **notification extension UI** is not fully automatable via CDP - prepare/sign up to Confirm is the usual limit.

### Matrix (expect green / HTTP 200 where noted)

- **API MATRIX:** `/health`, vault, signals, fassets, yield, portfolio, bridge (and related agent rails)
- **Flow chips / rails:** swap (`beacon_safe`), bridge (`beacon_agent`), x402, FAssets, portfolio, signals, yield, research, risk, Safe
- **Safe:** LIVE / PAUSED, policy unlocked for vault owner, deposit path, remaining window budget
- **Safe swap:** Coston2 chain 114, Execute from Beacon Safe (no MetaMask per spend after policy); no Mainnet switch for this path
- **Bridge:** quote -> Confirm -> Execute with Beacon Agent; explorer + LZ Scan links when on-chain
- **x402:** Unpaid -> EIP-3009 on chain 114 -> settle
- **Agent Jobs:** brief -> quote -> **Pay from Beacon Safe** (primary) or wallet EIP-3009 -> generate -> PASS/CLOSED or NEEDS_LOOK with deliverable; receipt + explorer; Safe timeline shows `vault.execute` + `lockPrepaid`
- **FCC badge:** hardware TEE when `/v1/fcc/status` `mode=verified` and `hardwareClaim=true`
- **CI local:** `npm run typecheck`, `npm test`, `npm run test:contracts`, `npm run web:build`

### Scripted e2e

- Root script: `npm run e2e` -> `scripts/e2e-job-loop.ts` (deployer/settler keys lock escrow)

---

## 15. Common errors / troubleshooting

| Symptom | Likely cause | What to check |
|---------|--------------|---------------|
| UI **"Not charged"** after Safe job | Escrow **refund** after `generation_failed` or refuse - not always a quality FAIL | Job events: `generation_failed`; AI probe; text services should soft-recover (history 2026-08-08 fix) |
| Approve-safe / lock fails | Escrow env mismatch (old `0x68E2->` vs prepaid `0xE68c->`) | Render `BEACON_ESCROW`, Vercel `VITE_BEACON_ESCROW`, `/health` `flareRails.escrow` |
| Policy / overspend reject | `maxSpendPerTx`, rolling window, pause, session, allowlist | Safe page LIVE status; `assertPolicyAllows`; vault allowlist includes `transfer(address,uint256)` to escrow |
| Safe job needs gas | Executor needs C2FLR | Faucet; settler/executor balance |
| Claiming "Safe paid via EIP-3009 as Safe" | Protocol-illegal | Use prepaid path only |
| FCC shown as simulated TEE | Stale env / UI | `SIMULATED_TEE=false`, `FCC_MODE=verified`, `/v1/fcc/status` `hardwareClaim`, `/health` honesty |
| AI 401 / CORS / probe fail | Proxy / keys / ASN | `/v1/ai/probe`; `AI_PROXY_URL`; Vercel `/api/ai/proxy`; no laptop relay required for prod |
| INTERNAL opaque 500 | Server exception | Response `error.detail` (sliced); Render logs |
| SSE / progress crash | Historic `JSON.parse("[object Object]")` | Fixed in history; re-check if regressions |
| Result Open does nothing | `file://` temp paths blocked in Chrome | Use API artifact/raw URLs |
| Video jobs | Coming Soon / NO_FIT in flagship UX | Do not expect full video settle on desk |
| SparkDEX / Mainnet on Safe path | Blocked by design | Use SwapDesk on Coston2 |
| Double-spend / lock fail | `lockedTotal` / `freeBalance` gate | Escrow prepaid balance; vault free balance |
| Stale orchestrator race | Historic mid-fix FAIL/refund | Ensure single worker ownership; re-run job |

---

## 16. Official Flare docs (reference)

- [x402 Payment Protocol](https://dev.flare.network/fxrp/token-interactions/x402-payments)
- [Gasless USDT0 / EIP-3009](https://dev.flare.network/network/guides/gasless-usdt0-transfers#eip-3009-transfer-with-authorization)
- [Smart Accounts overview](https://dev.flare.network/smart-accounts/overview)
- [FAssets swap/redeem](https://dev.flare.network/fassets/developer-guides/fassets-swap-redeem)
- [Developer tools Coston2](https://dev.flare.network/network/developer-tools?network=coston2)
- [LayerZero Flare testnet](https://docs.layerzero.network/v2/deployments/chains/flare-testnet)

Companion audit: `ARCHITECTURE_AUDIT.md`. Living engineering log: `history.md`.

---

## 17. TODO / verify before treating as absolute

- [ ] Confirm Render always embeds workers vs separate orchestrator/settler processes.
- [ ] Sync `apps/web/.env.example` escrow to prepaid `0xE68c->1C7E` (currently may still show old address).
- [ ] Confirm live Vercel env SHA matches latest `main` after any billing/deploy gaps noted in older audits.
- [ ] Video pipeline production readiness beyond "Coming Soon" UI.
- [ ] Hardware FCC / verified enclave: MODE=0 image built (`beacon-fcc-hardware:v0.1.0`); GCP CS blocked on EG $10 prepay + card verify (`OR_MIVEM_04`) + ETA tax — evidence `docs/evidence/hardware-fcc/STATUS.json`. Do not claim GCP_AMD_SEV until that clears.

---

*End of BEACON_MASTER.md. Update this file when addresses, routes, or honesty claims change.*

