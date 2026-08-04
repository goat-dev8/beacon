# Beacon — Engineering History (memory)

Living log of what was done. No secrets in this file.

---

## 2026-08-05 — Flagship Flare OS upgrade (hackathon winner mode)

**Problem:** Flow felt prototype-y; Security Center was UI-only; FCC/Smart Accounts risked being over-claimed; chat lacked creative briefing.

**Root cause / research:** Re-verified via DevHub MCP + skills. FCC is **not fully public production** yet. Smart Accounts are XRPL→PersonalAccount, not MetaMask session keys. Closest popup reduction = x402/EIP-3009. SparkDEX remains approve+swap with receipts. See `FLAGSHIP_FLARE_OS_RESEARCH.md` + `FLOW_PRODUCTION_RESEARCH.md`.

**Fix**
- Policy engine `apps/api/src/securityPolicy.ts` — enforce pause / allowlist / per-job / daily spend on desk **approve** + agent **chat/x402**; record daily spend in Redis
- Authorization Receipt in Security Center (`/flow/security`) — budget remaining, spent today
- Conversational video/image brief (15/30/60 + aspect/style) before Bound Work
- Trade desk FTSO-driven swap / hold suggestion
- Bound Work quote honesty: MockUSDT0 vs SparkDEX USDT0 + Security link
- Conversation engine: Thinking → Beacon + Powered by Claude/GPT; real SparkDEX receipt UX (prior)

**Verification**
- `vitest` `flareAgents.test.ts` (amount parser + model labels)
- Coston2 probe: FTSO live, FXRP `0x0b6A…`, swap prepare `1 USDT0` → est FXRP
- `npm run build -w @beacon/web` succeeds

**Commit:** (this push)

---

## 2026-08-05 — Production conversation engine (Flow redesign)

**Research:** `FLOW_PRODUCTION_RESEARCH.md` (DevHub Smart Accounts, SparkDEX USDT0→FXRP, x402/EIP-3009, LayerZero Flare testnet, FAssets, honesty on session keys).

**Shipped**
- Multi-turn agent chat: clarify → quote → confirm → prepare (never one-shot calldata)
- Fixed amount parser so `USDT0` no longer yields `amountIn=0`
- AI errors sanitized (no HTML/405 dumps); UI shows **Thinking…** → **Beacon** + subtle **Powered by Claude Opus 5 / GPT-5.6** (never AgentRouter brand)
- Real SparkDEX path: approve + swap, `waitForTransactionReceipt`, explorer links, balance refresh via `GET /v1/agents/balances`
- Security Center `/flow/security` + `GET/PUT /v1/security/policy` + `POST /v1/security/revoke` (Redis when configured)
- Conversation `state` round-tripped on `/v1/agents/chat`

**Honesty**
- MetaMask still required for SparkDEX EOA swaps (1–2 txs) — Flare Smart Accounts ≠ MetaMask session keys
- Best popup reduction for Beacon services remains **x402 / EIP-3009**
- MockUSDT0 (desk/x402) ≠ SparkDEX Coston2 USDT0

---

## 2026-08-04 — Beacon Flow (Anvita-style Flare agents)

**Research:** `AGENT_FLOW_RESEARCH.md` (skills + DevHub MCP + flare-foundation + LayerZero + FAssets + USDT0↔FXRP docs + Anvita Flow UX).

**Shipped**
- `/flow` multi-agent chrome (rooms: general, signals, swap, bridge, pay, trade, desk)
- API: `GET /v1/agents`, `GET /v1/agents/signals`, `POST /v1/agents/swap/prepare`, `POST /v1/agents/chat` (+ optional x402 settle)
- Shared: `ftso.ts` (live `getFeedsById`), `flareAgents.ts` (tool router + action cards)
- Real FTSO on Coston2; SparkDEX USDT0→FXRP prepare (user signs); x402 for premium trade/bridge; honest LZ bridge planner; desk deep-link

**Honesty:** Beacon MockUSDT0 ≠ Coston2 SparkDEX USDT0 — labeled in cards/UI.

---

## Status snapshot (2026-08-04)

**Product:** Beacon — Finish AI work. Pay only when it passes.  
**Production desk:** https://beacon-desk.vercel.app/  
**Production API:** https://beacon-api-97gl.onrender.com/ (`pipeline` caps `2026-08-04-pro-media-v1`)  
**Local desk:** `http://localhost:5173/` · API: `http://127.0.0.1:3001`  
**Network:** Flare Testnet Coston2 (chain 114)  
**Live contracts**
| Contract | Address |
|---|---|
| MockUSDT0 | `0x6fd8a72a972040f3153894BBd0d829a58f1Fe86c` |
| X402Facilitator | `0x1f409a809cE6e8A4467C1fD40943aC40169f4779` |
| BeaconJobRegistry | `0x100a3E24909DE25B9CAe75Ba665Be6F893b98889` |
| BeaconEscrow | `0x68E29567a9eC60D6ADb71901CE187C22Cc087138` |

Deployer/payee: `0xBDfCeE82Bd42FEfA58ee850B3709636a8B6b0034`  
Explorer: https://coston2-explorer.flare.network

### Media providers (live)
- **HF Inference** fine-grained token → fal-ai Flux.schnell via router (local JPEG proven)
- **Pollinations** API key present; Paid/Quest Pollen was **0** at capture — fail-fast on 402
- AgentRouter chat for prompt engineer / quote / judge (image models still 403 on AgentRouter)
- SVG fallback only when Comfy + HF + Pollinations all fail
- **`MEDIA_FAST=true`** on Render: skip Opus prompt eng + L2 judge hang; Flux still runs
- Proven Render Image e2e: job `b133b5f7…` → **CLOSED / Paid** · `image/jpeg` · escrow released `0x03d86bec…`

### Proven end-to-end (real wallet + escrow + settle)
| Job | Path | Result | Escrow | Lock / notes |
|---|---|---|---|---|
| `1de49605…` | **Vercel + MetaMask** Image | **Done / Paid $5.88** | released | SVG creative · lock `0xe55379a3…` · wallet `0x3be5…c794` |
| `a0071b85…` | deep-api Image (Render) | **CLOSED** PASS | released | `image/svg+xml` artifact proven |
| `517200e7…` | deep-api documents | **CLOSED** PASS | released | script |
| `484e48d1…` | deep-api documents | **CLOSED** PASS | released | script |
| `761a4e07…` | deep-api documents | **CLOSED** PASS | released | script |
| `a80ab71b…` | **Chrome + MetaMask** documents | **Done / Paid $10.63** | released | lock `0x3228aba2…` |
| `bd318f92…` | early video (pre-fix) | FAIL UI “Not charged” | stuck then manual refund `0xec7321a0…` | root-cause below |
| `c3c98334…` | Chrome mid-fix | FAIL / CLOSED | refunded | stale orchestrator race |
| `b9951543…` | deep-api | FAIL then refunded | refunded | L2 judge flake (later softened) |

### Production deploy notes (2026-08-04)
- GitHub `main` → Render `beacon-api` + Vercel `beacon-desk` (clean domain `beacon-desk.vercel.app`)
- **Pro media v1** (`2026-08-04-pro-media-v1`): Claude Opus / GPT-5.6 Sol **prompt engineer** → ComfyUI → Hugging Face **fal Flux.schnell** → Pollinations → SVG
- Commit `d65ba7f`: HF fal path + fail-fast Pollinations + video companion-only L1 fix- Pollinations anonymous Flux is **broken/paid** (402 insufficient Pollen) — not a quality path anymore
- For “best ever” raster/video: set `COMFYUI_URL` (Flux.2/Wan/LTX) and/or `HF_TOKEN`; OpenMontage/Remotion via `OPENMONTAGE_ROOT` / `VIDEO_TOOLKIT_ROOT`; video MP4 via `ffmpeg-static` zoom+xfade
- Skills/MCP: `MEDIA.md`; Pollinations + ComfyUI MCP in Cursor `mcp.json`; `/openmontage` `/agent-demo-video` `/remotion-create`
- Vercel SPA: root `vercel.json` rewrites so `/app` hard-refresh works

---

## What we built

### Backend
- Monorepo: shared, x402, quote, acceptance, pipeline, receipts, fdc, smart-accounts, orchestrator, settler, api, web
- Postgres (Supabase) + Redis (Upstash)
- API Fastify: create → quote → approve → SSE events → artifacts → look → receipts
- **Embedded workers** in API process (`apps/api/src/workers.ts`) — pipeline + settler (Render-friendly)
- `jobIdToBytes32` = sha256(utf8 jobId) shared; escrow lock/release/refund use same hash
- Video without Remotion: storyboard JSON + captions (no fake MP4)
- Acceptance: L1 mime/objective, L2 AI judge, L3 brand; hydrate file text for judge
- L2 alone no longer hard-FAILS (→ NEEDS_LOOK); objective L1/L3 still gate charge
- SSE route hijack + safe Redis log parse (fixed process crash on Live progress)
- Artifact **content** API: `GET /v1/jobs/:id/artifacts/:artifactId` (inline preview)
- Job receipt API: `GET /v1/jobs/:id/receipt`
- Documents compose now writes **real draft body** into `deliverable.md` (was URI list only)

### Frontend (`apps/web`)
- React 19 + Vite + Tailwind 4 + Motion + RQ + RHF + Zod + viem
- Greptile-inspired **light** desk: mint `#39e08a`, paper `#f4f3f1`, ink `#2a2735`
- Landing + `/app` Bound Work flow
- MetaMask: Coston2 connect, EIP-3009, `BeaconEscrow.lockWithAuthorization`, mint MockUSDT0
- Result panel: **agent-style transcript** (inline draft/document), artifact tabs, Flare rails timeline, receipt with lock/settle explorer links
- Progress: consumer timeline + **Flare rails · Coston2** (wallet → EIP-3009 → escrow lock → generate → acceptance → release/refund → receipt)
- `?job=<id>` restores Done/result view after refresh

### Contracts / Flare
- Forge tests 5/5; Coston2 deploy live
- Real steps shown in UI match: EIP-3009 → lockWithAuthorization → releaseToPayee / refund

### Design language
- Ditto/Greptile study for **language only** (no asset clone)
- Faceted CTAs, crosshair grid, Anybody + DM Sans + Space Mono

---

## Bugs found → fixed

1. **Queued → Not charged (video `bd318f92`)**  
   - Lock OK; Remotion missing → weak deliverable → L1 FAIL  
   - Settler used wrong job hash → refund missed lock → manual refund  
   - **Fix:** shared sha256 hash; storyboard path; FAIL refunds escrow

2. **Render API alone didn’t run workers** historically → jobs stuck Queued  
   - **Fix:** embed pipeline+settler in API

3. **SSE `JSON.parse("[object Object]")` crashed API** during Chrome progress  
   - **Fix:** hijack + safe parse

4. **Stale `services/orchestrator` raced embedded workers** → bad accepts  
   - **Fix:** kill standalone orchestrator; use embedded only

5. **Result “Open” did nothing** (`file://` temp paths blocked by Chrome)  
   - **Fix:** content API + inline agent transcript (no file://)

6. **Deliverable.md was only path list**  
   - **Fix:** compose copies draft markdown into deliverable

7. **Flaky L2 judge FAIL on good docs**  
   - **Fix:** L2 fail → NEEDS_LOOK; softer judge prompt

---

## Outstanding / known

- AgentRouter key historically **401** — generator/judge may skip AI; L1/L3 still gate. Re-check key for production Opus/GPT.
- Remotion CLI not installed → video = storyboard+captions until Remotion wired.
- Production web still needs static deploy; local `VITE_API_URL` points at `127.0.0.1:3001` for deep tests (Render API: `https://beacon-api-97gl.onrender.com` when redeployed with workers).
- FCC TEE: simulated mode honesty banner on `/health`.

---

## How to run (local)

```bash
# API + workers
npx tsx apps/api/src/index.ts

# Web
cd apps/web && npx vite --port 5173

# Scripted e2e (deployer key locks escrow)
npx tsx scripts/deep-api-job.ts
```

Desk: http://localhost:5173/app  
Reopen a finished job: http://localhost:5173/app?job=<uuid>

---

## Phase notes (earlier same day)

- Env verified: Postgres OK, Redis PONG, Coston2 114, deployer funded  
- DB migration `001_init.sql` applied  
- `fce-beacon` scaffold + FIT/JOB handlers  
- Frontend Greptile light redesign after dark UI rejected  
- Chrome MetaMask e2e: Documents → $10.63 → Approve → Done Paid

