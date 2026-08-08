# Beacon

Flare AI OS on **Flare Testnet Coston2** (chain ID **114**).

Finish AI work. Pay only when it passes.

Beacon combines a chat OS (Flow), prepaid AI jobs with escrow (Agent Jobs), and a policy vault (Beacon Safe) on MockUSDT0 / x402 / EIP-3009 rails.

| Doc | Role |
|-----|------|
| [BEACON_MASTER.md](./BEACON_MASTER.md) | Master product / ops reference |
| [history.md](./history.md) | Engineering history (no secrets) |
| [ARCHITECTURE_AUDIT.md](./ARCHITECTURE_AUDIT.md) | Flare-native architecture and compliance |
| [PRODUCT.md](./PRODUCT.md) | Product direction and copy rules |
| [docs/HONESTY.md](./docs/HONESTY.md) | Runtime honesty flags (FCC / TEE) |

---

## Architecture overview

Three product surfaces (see `ARCHITECTURE_AUDIT.md`):

| Surface | Route / role |
|---------|----------------|
| **Flow** | Chat OS: swap, bridge, research, signals, portfolio, risk, yield, FAssets, x402 micropays |
| **Agent Jobs** | `/flow/desk`: paid AI generation with escrow + receipt |
| **Safe** | `/flow/security`: create personal Safe, fund once, set policy; **per-wallet** balance for agent spends and jobs |

### Payment paths (Agent Jobs)

**Primary (Beacon Safe):** create personal Safe → fund once (EIP-3009 deposit) → owner sets policy → `POST /v1/jobs/:id/approve-safe` (wallet + payAuth) → `vault.execute(transfer->escrow)` → `escrow.lockPrepaid` → generate → acceptance → release or refund to **that** vault.

**Fallback (wallet EIP-3009):** user signs `TransferWithAuthorization` -> `escrow.lockWithAuthorization` -> generate -> release or refund to wallet.

Beacon Safe is a personal `BeaconAgentVault` per wallet, created via `BeaconSafeFactory`. It is **not** Flare Smart Accounts (those are XRPL personal accounts).

FCC on live Coston2 is **simulated TEE** (`SIMULATED_TEE=true`, `FCC_MODE=simulated`). Do not claim a hardware enclave.

### Runtime shape

```
apps/web          Vite React desk (Vercel in production)
apps/api          Fastify API; embeds pipeline + settler when Redis is available
services/orchestrator   Standalone job pipeline worker
services/settler        Standalone escrow settle / refund worker
packages/*        Shared libs, x402, quote, pipeline, contracts, ->
```

---

## Folder structure

```
beacon/
  apps/
    api/              Fastify API (`npm run api`)
    web/              Vite desk (`npm run web`)
  services/
    orchestrator/     Job pipeline loop (`npm run orchestrator`)
    settler/          Escrow settle / refund loop (`npm run settler`)
  packages/
    shared/           Env, vault, agents, FTSO, desks
    x402/             Facilitator / EIP-3009 helpers
    quote/            Job quotes
    execution/        Execution helpers
    acceptance/       Acceptance judge
    pipeline/         Generation pipeline
    receipts/         Receipt builder
    fdc/              FDC-related helpers
    smart-accounts/   Registry / Smart Accounts config
    contracts/        Foundry contracts + forge scripts
    remotion-pack/    Optional Remotion pack
  db/migrations/      SQL migrations (`npm run db:migrate`)
  scripts/            verify-env, e2e, deploy helpers
  fce-beacon/         FCC / confidential-compute scaffold (separate)
  api/ai/             Vercel AI proxy route (production AgentRouter hop)
  .env.example        Root / API / worker env names
  apps/web/.env.example Frontend Vite env names
```

---

## Requirements

- **Node.js 20+** (`engines.node` in root `package.json`)
- npm (workspaces)
- Postgres (`DATABASE_URL` / `DATABASE_URL_DIRECT`) for API and workers
- Upstash Redis REST (`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`) for job locks and settle queue
- MetaMask (or another EIP-1193 wallet) for Coston2 testing
- **Foundry** (optional): only needed for `forge test` / contract deploy scripts under `packages/contracts`

---

## Installation

From the monorepo root (`beacon/`):

```bash
npm install
```

Optional env check (requires a filled root `.env`):

```bash
npm run verify:env
```

Optional DB migrate:

```bash
npm run db:migrate
```

---

## Environment variables

**Never commit real secrets.** Copy examples, fill locally, keep `.env` out of git.

### Root `.env` (API, workers, scripts)

Copy from [`.env.example`](./.env.example). Groups:

| Group | Names (see `.env.example`) |
|-------|----------------------------|
| App | `NODE_ENV`, `APP_NAME`, `APP_URL`, `API_URL`, `API_PORT`, `WEB_PORT`, `LOG_LEVEL`, `SESSION_SECRET`, `ANALYTICS_SALT`, `CHAIN_ID`, `NETWORK_NAME` |
| Coston2 | `COSTON2_RPC_URL`, `COSTON2_WSS_URL`, `COSTON2_EXPLORER_URL`, `COSTON2_FAUCET_URL`, `FLARE_CONTRACT_REGISTRY`, `EXPECTED_*` |
| Keys | `DEPLOYER_PRIVATE_KEY`, `DEPLOYER_ADDRESS`, `SETTLER_PRIVATE_KEY`, `SETTLER_ADDRESS`, `DEPLOYMENT_PRIVATE_KEY`, `INITIAL_OWNER`, `PROXY_PRIVATE_KEY` |
| Data | `DATABASE_URL`, `DATABASE_URL_DIRECT`, `DATABASE_SSL`, `REDIS_URL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |
| AI | `AI_BASE_URL`, `AI_API_KEY`, `AI_PROXY_URL`, `AI_PROXY_SECRET`, `AI_MODEL_*`, `AI_REQUIRE_REAL`, OpenAI/Anthropic mirrors |
| Billing contracts | `X402_TOKEN_ADDRESS`, `X402_FACILITATOR_ADDRESS`, `X402_PAYEE_ADDRESS`, `BEACON_JOB_REGISTRY`, `BEACON_ESCROW`, `BEACON_CREDIT`, `BEACON_AGENT_VAULT_ADDRESS`, `VAULT_EXECUTOR`, `BEACON_SWAP_DESK_ADDRESS` |
| FCC | `FCC_MODE`, `SIMULATED_TEE`, `LOCAL_MODE`, `EXT_PROXY_URL`, -> |
| Feature flags | `ENABLE_API`, `ENABLE_FCC`, `ENABLE_PIPELINE`, `ENABLE_SETTLER`, `ENABLE_FUNDING`, `ENABLE_WEB` |

`npm run verify:env` treats these as required when checking: `NODE_ENV`, `API_PORT`, `CHAIN_ID`, `COSTON2_RPC_URL`, `DATABASE_URL`, `DATABASE_URL_DIRECT`, `SESSION_SECRET`.

Defaults in code (when unset): `APP_URL=http://localhost:5173`, `API_URL=http://localhost:3001`, `API_PORT=3001`, `CHAIN_ID=114`, public Coston2 RPC.

### Frontend `apps/web/.env`

Copy from [`apps/web/.env.example`](./apps/web/.env.example):

| Name | Purpose |
|------|---------|
| `VITE_API_URL` | API base (local `http://localhost:3001` or production Render URL) |
| `VITE_RPC_URL` | Coston2 RPC |
| `VITE_X402_TOKEN_ADDRESS` | MockUSDT0 |
| `VITE_X402_FACILITATOR_ADDRESS` | X402Facilitator |
| `VITE_X402_PAYEE_ADDRESS` | Payee / settler address |
| `VITE_BEACON_JOB_REGISTRY` | Job registry |
| `VITE_BEACON_ESCROW` | Escrow (must match root `BEACON_ESCROW`) |
| `VITE_BEACON_SAFE_FACTORY_ADDRESS` | Personal Safe factory |
| `VITE_BEACON_AGENT_VAULT_ADDRESS` | Legacy shared vault (optional) |

Keep `VITE_BEACON_ESCROW` aligned with root `BEACON_ESCROW`. Current prepaid escrow in `ARCHITECTURE_AUDIT.md` / web defaults is `0xE68c22621314977f00c85D89e4f5b10573C51C7E`. Older example files may list a previous escrow; prefer the audit / live env.

---

## Flare Coston2 setup

| Field | Value |
|-------|--------|
| Network | Flare Testnet Coston2 |
| Chain ID | `114` |
| RPC | `https://coston2-api.flare.network/ext/C/rpc` |
| Explorer | `https://coston2-explorer.flare.network` (also `https://coston2.testnet.flarescan.com` in some Safe/desk links) |
| Faucet | `https://faucet.flare.network/coston2` |
| Dev tools | https://dev.flare.network/network/developer-tools?network=coston2 |

### MetaMask

1. Add network: Coston2, chain ID `114`, RPC above, explorer above.
2. Fund the wallet with **C2FLR** from the faucet (gas).
3. For x402 / Safe / Agent Jobs, use Beacon **MockUSDT0** (`0x6fd8a72a972040f3153894BBd0d829a58f1Fe86c`), not only faucet USDT0. Faucet USDT0 may lack EIP-3009 `transferWithAuthorization`.
4. Stay on chain **114**. Product agent Safe swaps are Coston2-only; SparkDEX Mainnet (14) is not the default desk path.

---

## Deploy contracts (Foundry)

Contracts live in `packages/contracts` (`foundry.toml` RPC alias `coston2` = `${COSTON2_RPC_URL}`).

Install Foundry separately, then from `packages/contracts`:

```bash
# Unit tests (also: npm run test:contracts from monorepo root)
forge test
```

Scripts under `packages/contracts/script/`:

| Script | Purpose | Env used by script |
|--------|---------|---------------------|
| `Deploy.s.sol` | Full stack: MockUSDT0, Facilitator, JobRegistry, Escrow, AgentVault | `DEPLOYMENT_PRIVATE_KEY`, `X402_PAYEE_ADDRESS`, optional `INITIAL_OWNER`, `VAULT_EXECUTOR` |
| `DeployEscrowPrepaid.s.sol` | Redeploy prepaid `BeaconEscrow` on existing token | `DEPLOYMENT_PRIVATE_KEY`, `X402_TOKEN_ADDRESS`, `X402_PAYEE_ADDRESS`, optional `INITIAL_OWNER` |
| `DeployAgentVault.s.sol` | Vault only on existing token | `DEPLOYMENT_PRIVATE_KEY`, `X402_TOKEN_ADDRESS`, optional `INITIAL_OWNER`, `VAULT_EXECUTOR` |
| `DeploySwapDesk.s.sol` | Coston2 MockUSDT0->FXRP swap desk | `DEPLOYMENT_PRIVATE_KEY`, `X402_TOKEN_ADDRESS`, `EXPECTED_FXRP_TOKEN`, optional owner/operator/rate/fee |

Example broadcast (loads `[rpc_endpoints].coston2` from `foundry.toml`):

```bash
cd packages/contracts
forge script script/Deploy.s.sol:Deploy --rpc-url coston2 --broadcast
forge script script/DeployEscrowPrepaid.s.sol:DeployEscrowPrepaid --rpc-url coston2 --broadcast
forge script script/DeployAgentVault.s.sol:DeployAgentVault --rpc-url coston2 --broadcast
forge script script/DeploySwapDesk.s.sol:DeploySwapDesk --rpc-url coston2 --broadcast
```

After deploy, set the printed addresses into root `.env` and matching `VITE_*` values. Do not redeploy casually against production without updating Render + Vercel env.

### Current Coston2 addresses (from `ARCHITECTURE_AUDIT.md`)

| Component | Address |
|-----------|---------|
| MockUSDT0 | `0x6fd8a72a972040f3153894BBd0d829a58f1Fe86c` |
| X402Facilitator | `0x1f409a809cE6e8A4467C1fD40943aC40169f4779` |
| BeaconEscrow (prepaid) | `0xE68c22621314977f00c85D89e4f5b10573C51C7E` |
| BeaconSafeFactory | `0x9e88ADFB4dA7530675acC520cC9a0a818543c4F2` |
| BeaconAgentVault (legacy shared) | `0xc7C6C06Dd59173dBAf8382627d6A483Ca53AAF33` |
| Executor / escrow owner / payee | `0xBDfCeE82Bd42FEfA58ee850B3709636a8B6b0034` |
| Job registry (web default) | `0x100a3E24909DE25B9CAe75Ba665Be6F893b98889` |

---

## Run locally

Use four terminals from the monorepo root after `npm install` and env setup.

### Frontend

```bash
npm run web
```

Runs `npm run dev -w @beacon/web` (Vite). Point `VITE_API_URL` at local API or production Render.

### API

```bash
npm run api
```

Runs `tsx apps/api/src/index.ts`. Listens on `PORT` or `API_PORT` (default `3001`).

If Upstash Redis is configured, the API **embeds** pipeline + settler loops (`ENABLE_PIPELINE` / `ENABLE_SETTLER` default on unless set to `false`). If Redis is missing, jobs will not advance until workers run elsewhere.

### Workers (standalone)

```bash
npm run orchestrator
npm run settler
```

- `orchestrator` -> `tsx services/orchestrator/src/index.ts` (AUTHORIZED -> generate -> accept)
- `settler` -> `tsx services/settler/src/index.ts` (settle / refuse escrow from Redis `q:settle`)

For local isolation you can run standalone workers and disable embedded ones with `ENABLE_PIPELINE=false` / `ENABLE_SETTLER=false` on the API process. Do not run duplicate settlers against the same queue without understanding lock behavior.

### Useful checks

```bash
npm run typecheck
npm test
npm run test:contracts
npm run web:build
npm run ci
```

---

## Production

From `history.md` / `ARCHITECTURE_AUDIT.md` / `PRODUCTION_AUDIT.md`:

| Surface | Host | URL |
|---------|------|-----|
| Desk (Vercel `beacon-desk`) | Vercel | https://beacon-desk.vercel.app |
| API (`beacon-api`) | Render | https://beacon-api-97gl.onrender.com |

Notes:

- Web build: `vercel.json` -> `npm run build -w @beacon/web`, output `apps/web/dist`.
- API image: `Dockerfile` -> `npx tsx apps/api/src/index.ts` (embedded workers when Redis is set).
- Production AI egress uses Vercel Node proxy: `AI_PROXY_URL` -> `https://beacon-desk.vercel.app/api/ai/proxy` (see history / production audit). Do not point live Render at localhost or ephemeral tunnels.
- `render.yaml` documents the `beacon-api` service shape (Coston2 `CHAIN_ID=114`, `SIMULATED_TEE=true`).

---

## Verify deployments / explorer links

1. **API health:** `GET https://beacon-api-97gl.onrender.com/health` (and FCC status endpoints when enabled; see `docs/HONESTY.md`).
2. **Desk:** open https://beacon-desk.vercel.app (Flow, Jobs / Agent Jobs, Safe).
3. **On-chain:** open contract or tx on  
   https://coston2-explorer.flare.network  
   or  
   https://coston2.testnet.flarescan.com  
   Confirm bytecode at `BEACON_ESCROW` / `BEACON_AGENT_VAULT_ADDRESS` matches env.
4. **x402 smoke:** unpaid agent resource returns HTTP **402** with Coston2 / MockUSDT0 / facilitator fields (see history).
5. **Env alignment:** root `BEACON_ESCROW` == `VITE_BEACON_ESCROW` == live prepaid escrow.

Example explorer bases:

- Tx: `https://coston2-explorer.flare.network/tx/<hash>`
- Address: `https://coston2-explorer.flare.network/address/<address>`

---

## Common errors

| Symptom | Likely cause | What to check |
|---------|--------------|---------------|
| Jobs stuck AUTHORIZED / no progress | Redis missing or workers off | Upstash env; API log `[workers]`; or run `npm run orchestrator` / `npm run settler` |
| ->Not charged-> after Safe pay | Generation aborted -> escrow refund (not quality FAIL) | AI proxy/key; `AI_REQUIRE_REAL`; job events `generation_failed` (see history / Agent Jobs research) |
| `BEACON_ESCROW not configured` | Missing escrow env | Set `BEACON_ESCROW` (and matching `VITE_*`) |
| Safe balance / policy wrong or empty | Vault unset or wrong address | `BEACON_AGENT_VAULT_ADDRESS` / `VITE_BEACON_AGENT_VAULT_ADDRESS` |
| MetaMask wrong network / Mainnet switch | Not on Coston2 114 | Add/switch chain 114; Safe path stays Coston2 |
| EIP-3009 / deposit fails on faucet USDT0 | Token lacks authorization | Use Beacon MockUSDT0 for x402 rails |
| Settler / approve fails | Missing `SETTLER_PRIVATE_KEY` or `DEPLOYER_PRIVATE_KEY` | Key must own escrow / have gas (C2FLR) |
| AI hard fail with `AI_REQUIRE_REAL` | Proxy/key/WAF | Production uses Vercel `AI_PROXY_URL`; local needs working `AI_*` |
| FCC honesty mismatch | Claiming hardware TEE | Keep `SIMULATED_TEE=true` / `FCC_MODE=simulated` unless you run a real enclave path |

---

## Security best practices

- Never commit `.env`, `.env.local`, or private keys. Use `.env.example` names only in docs.
- Treat `SETTLER_PRIVATE_KEY` / `DEPLOYER_PRIVATE_KEY` / `DEPLOYMENT_PRIVATE_KEY` as production secrets (escrow owner, vault executor gas, deploys).
- Keep `SESSION_SECRET` and `AI_PROXY_SECRET` long and unique per environment.
- Do not forge EIP-3009 ->as-> the Safe. Safe jobs use `vault.execute` + `lockPrepaid` only.
- Align escrow/vault addresses across Render, Vercel, and local before testing pays.
- Prefer official Flare RPC/explorer/faucet URLs.
- Production: no laptop tunnels for AI/API. Render + Vercel only (see history).
- Pause Safe / tighten policy when demoing with a funded vault.

---

## Further reading

- [BEACON_MASTER.md](./BEACON_MASTER.md)
- [history.md](./history.md)
- [ARCHITECTURE_AUDIT.md](./ARCHITECTURE_AUDIT.md)
- [docs/HONESTY.md](./docs/HONESTY.md)
- Flare x402: https://dev.flare.network/fxrp/token-interactions/x402-payments
- Flare gasless / EIP-3009: https://dev.flare.network/network/guides/gasless-usdt0-transfers

