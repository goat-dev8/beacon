# Beacon · Flare Summer Signal Feasibility Report

**Date:** 2026-08-07  
**Scope:** FCC real vs simulated, Agent Safe, production 24/7, judge alignment  
**Sources:** Flare DevHub MCP (`fcc/overview`, `fcc/guides/getting-started`, `fcc/guides/sign-extension`, Smart Accounts USDT0 guide, Flare AI Skills), `telegram.md`, `x,youtube.md`, live Render probes, GitHub `flare-foundation/*` tips  
**Constraint:** Evidence only. No invented capabilities.

---

## 1. Current architecture (production)

```
Browser (Vercel desk)
  └─ VITE_API_URL → Render beacon-api (Oregon)
        ├─ Flare agents, Safe, OFT bridge, x402, FTSO, FAssets, policy
        ├─ Coston2 RPC (public)
        └─ AI narrate hops:
              1) AgentRouter direct (often WAF 405 from Render)
              2) Pollinations gen.pollinations.ai (live OK)
              3) Vercel /api/ai/proxy sin1 → AgentRouter (billing may block redeploy)
```

| Rail | Chain | Signer | MetaMask? |
|------|-------|--------|-----------|
| Beacon Safe swap MockUSDT0→FXRP | Coston2 114 | Executor | No |
| Agent OFT bridge FXRP→Sepolia | Coston2 | Executor | No (if inventory+fee) |
| x402 EIP-3009 | Coston2 | User sign + settler | Sign only |
| SparkDEX USDT0→FXRP | **Mainnet 14 only** | User EOA | Yes — bytecode empty on Coston2 |
| FCC policy honesty | Coston2 SIMULATED_TEE | N/A | N/A |

**Live probe (2026-08-07):**
- `fccMode=simulated`, `simulatedTee=true`
- Vault `0xc7C6…AF33` balance **10.5** MockUSDT0, paused=false, sessionActive=true
- Desk `0x36c17…dF29` FXRP inventory **~1.63**
- Chat “Swap 0.5 USDT0 to FXRP” → `mode=beacon_safe`, `chain=114`, **no Mainnet switch**
- AI probe OK via Pollinations (`gpt-5.6-sol`, `claude-opus-5`)

---

## 2. Research Goal #1 — FCC feasibility (evidence)

### Official status

| Claim | Evidence |
|-------|----------|
| FCC not fully public production | DevHub overview warning: *“in the final stages of development and is not yet a fully public production system”* |
| Builders can start now | Same page + getting-started / sign-extension guides publish Coston2 deploy flows |
| Hackathon accepts SIMULATED_TEE | `telegram.md`: *“Simulated TEE mode on Coston2 is fully accepted for judging. You do not need a real GCP Confidential Space deployment.”* |

### Can Beacon use a real FCC extension?

**Yes — as a custom Flare Compute Extension (FCE) on Coston2**, following official scaffolds:

- [fce-extension-scaffold](https://github.com/flare-foundation/fce-extension-scaffold) (Hello World) — tip `ffb6c4c` **2026-08-07**
- [fce-sign](https://github.com/flare-foundation/fce-sign) — tip `6df972c` 2026-07-28
- [tee-node](https://github.com/flare-foundation/tee-node) — tip `86f2ee6` 2026-08-06
- [tee-proxy](https://github.com/flare-foundation/tee-proxy) — tip `d9c2c0f` (main merged develop) 2026-07-29
- Weather + x402 reference: [fce-weather-insurance-x402-agent](https://github.com/flare-foundation/fce-weather-insurance-x402-agent)

On-chain path is **real Coston2**: `TeeExtensionRegistry` / `TeeMachineRegistry` (addresses in scaffold `config/coston2/deployed-addresses.json`), `sendInstructions`, fee in C2FLR.

### What can run inside a TEE (extension process)

Per getting-started + sign-extension:

- Custom Go/Python/TS handlers (`POST /action`, `GET /state`)
- Private key storage + ECDSA sign (`fce-sign` UPDATE/SIGN)
- Confidential policy evaluation / private payloads (AgentVault-style inspiration)
- Weather / API secrets kept in enclave (Kristaps weather showcase pattern)
- Results signed by TEE identity; callers poll extension proxy

### What must remain simulated / outside hardware TEE

| Piece | Why |
|-------|-----|
| **SIMULATED_TEE=true attestation** | Official getting-started: develop without Confidential VM hardware; simulated `codeHash` `0x194844cf…` |
| **Product API on Render** | TEE stack is Docker `extension-tee` + `ext-proxy` + Redis — not the Node API |
| **SparkDEX / OFT / x402 facilitator** | On-chain EVM rails; not TEE-hosted |
| **Hardware attestation (GCP AMD SEV)** | Requires Confidential Space VM per sign-extension production notes; FCC not fully public |

### Blockers for “hardware-real FCC” in Beacon product

1. **Indexer DB credentials** (hackathon shared `hackathon_user_57` on `34.38.42.208`) — required for local/cloud `ext-proxy`
2. **Public `EXT_PROXY_URL`** — docs use ngrok/cloudflared to host **6674**; conflicts with “no laptop” unless proxy is hosted 24/7 on a VM
3. **GCP Confidential Space** for non-simulated attestation
4. **Coston2 redeploys** wipe registrations — telegram: pull latest scaffolds after redeploy
5. Live status today: `proxyReachable=false` because Render still has a **dead trycloudflare** `EXT_PROXY_URL`

### Is SIMULATED_TEE only for development?

**No — it is the accepted judge path.** Telegram + official docs: run against **live Coston2** with `LOCAL_MODE=false` and `SIMULATED_TEE=true`. That is a **real FCC demo** (real registries, real instructions, simulated attestation). Hardware Confidential Space is optional / post-hackathon polish.

### Recommended Beacon FCC posture

| Ship now | Later |
|----------|-------|
| Keep `FCC_MODE=simulated` + honest UI badge | Host `ext-proxy` + `extension-tee` on a always-on VM (not laptop) |
| Document extension ID + InstructionSender if registered | Optional `fce-sign` / policy signer inspired by mentor AgentVault *shape* (do not name competitor in product) |
| Clear dead tunnel URLs from Render | Hardware TEE when FCC public + GCP available |

**Verdict:** Beacon **cannot honestly claim hardware Confidential Space today**. Beacon **can and should** ship SIMULATED_TEE FCC on Coston2 as judge-accepted real FCC integration. Do not block 1st place on GCP SEV.

---

## 3. Research Goal #2 — Agent Safe

### Why swap asked for Mainnet

SparkDEX SwapRouter/QuoterV2 have **bytecode on Flare Mainnet (14) only**; Coston2 published addresses are empty (`cast code` / prior audits). Any path that calls `prepareSparkDexSwap` sets `requiresChainSwitch` when `CHAIN_ID=114`.

Safe path skips SparkDEX when `BEACON_SWAP_DESK_ADDRESS` + vault exist and pair is MockUSDT0→FXRP.

**Live today:** chat returns `beacon_safe` / chain 114 — Mainnet ask is **not** the default when desk env is set.

### Why agent might not execute after funding

| Cause | Mitigation |
|-------|------------|
| Desk FXRP inventory low | Seed desk; live ~1.63 FXRP |
| Caps / pause / session | Live: maxSpend 10, budget 50, paused false |
| Missing `SETTLER_PRIVATE_KEY` on Render | Must stay set (per-key PUT only) |
| Spend succeeds / fulfill fails | Manual recovery path in `safeSwap.ts` |
| Empty allowlist RPC query | `ensureSafeSwapPolicy()` sets on execute |

### Can funded agent execute directly?

**Yes.** Executor signs `vault.execute` + `desk.fulfill` on Coston2. User MetaMask is only needed for recipient address / deposits — not for Safe swap signing.

### Can Smart Accounts or FCC remove MetaMask approvals?

| Mechanism | Reality |
|-----------|---------|
| **Flare Smart Accounts** | XRPL-controlled **personal accounts** + 0xFE custom instructions. Official USDT0→FXRP swap guide still targets SparkDEX router `0x8a1E…` — **same Mainnet router address**. Does **not** give MetaMask-less EVM agent spend for Beacon’s MockUSDT0 vault. Requires XRPL wallet + FDC executor flow — different product. |
| **FCC / fce-sign** | Can hold keys in TEE and sign when policy passes (mentor pattern). Does **not** replace Coston2 Safe desk today; optional future for private policy. |
| **x402 EIP-3009** | Removes approve+transfer for **paid resources**; one signature for micropay. |
| **Beacon Safe** | Correct Coston2 architecture for agent spend without Mainnet MetaMask. |

**Never fake:** Smart Accounts ≠ Beacon Safe. FCC ≠ automatic MetaMask removal for SparkDEX.

---

## 4. Research Goal #3 — Production 24/7

| Dependency | Status |
|------------|--------|
| Render API + Coston2 rails | Live |
| Vercel desk | Live; redeploy may hit **402 Payment Required** (billing) |
| `AI_PROXY_URL` → Vercel sin1 | Configured; AgentRouter often still via Pollinations hop |
| `scripts/ai-relay.mts` / cloudflared | DEV-ONLY — must not restart for prod |
| `EXT_PROXY_URL=*.trycloudflare.com` | **Blocker for FCC status honesty** — clear on Render |
| `deploy-render.mjs` bulk PUT | Risk: syncs tunnel URL, omits AI_PROXY / Pollinations / desk |

**Forbidden for live users:** localhost, cloudflared, laptop relay.

---

## 5. Research Goal #5 — Judge / mentor alignment

From `telegram.md` + `x,youtube.md` (fassko / Quantic / DevHub):

1. **Ship real, useful products** — not theoretical demos  
2. **SIMULATED_TEE accepted** — latest scaffolds / develop→main tee stack  
3. **x402 + FCC** combination strongly liked (weather showcase, AgentVault *shape*)  
4. **FAssets** — direct mint, redeem-any-amount, destination tags  
5. Clear Flare integration (FTSO, OFT, Safe policy, x402 receipts)  
6. Working Coston2 demo + video + DoraHacks evidence of new work  

Beacon mapping: Safe prepaid policy + x402 + FTSO desk + OFT bridge + simulated FCC honesty + multi-rail AI OS.

---

## 6. Required code / ops changes

### P0 (do now)

1. Clear Render `EXT_PROXY_URL` dead tunnel (or point only when a 24/7 proxy exists)  
2. Harden `deploy-render.mjs`: never sync trycloudflare/ngrok/localhost; include `AI_PROXY_*`, `POLLINATIONS_API_KEY`, `BEACON_*`, settler  
3. Keep Safe as default for USDT0→FXRP; treat Mainnet switch as regression  
4. Fix Vercel billing so sin1 proxy + desk stay current  

### P1

5. Optional always-on FCC stack (VM) with SIMULATED_TEE for judge demo beyond honesty badge  
6. Seed desk FXRP inventory for multi-swap demos  
7. Chrome E2E matrix all chips  

### P2

8. Hardware TEE only when FCC public + GCP  
9. XRPL Smart Accounts as separate rail (not swap replacement on Coston2 MockUSDT0)

---

## 7. Risk analysis

| Risk | Impact | Mitigation |
|------|--------|------------|
| Claiming hardware TEE | Judge credibility kill | Honest simulated badge |
| Mainnet switch on funded Safe | Confuses demo | Desk env + preferSafe |
| AI WAF / Vercel 402 | Chat fallback | Pollinations + billing fix |
| Bulk Render env PUT | Wipes settler/Redis | Per-key only |
| Desk FXRP drained | Safe swap fails | Inventory monitor |
| Competitor naming in product | Brand risk | Inspire only; no AgentVault name in repo UI |

---

## 8. Recommended implementation order

1. Ops: clear FCC tunnel URL; lock AI env keys  
2. Harden deploy scripts  
3. Chrome E2E all features; fix failures  
4. Judge copy: Safe / x402 / simulated FCC / Coston2-only story  
5. Optional: always-on SIMULATED_TEE extension VM  
6. Post-hackathon: hardware FCC + XRPL Smart Accounts if product needs them  

---

## 9. Remaining work checklist

- [ ] Render `EXT_PROXY_URL` cleaned  
- [ ] `deploy-render.mjs` hardened  
- [ ] Vercel billing / latest desk SHA  
- [ ] Full Chrome E2E green (chat, swap, bridge, x402, FAssets, portfolio, signals, yield, research, risk, Safe, security)  
- [ ] DoraHacks submission materials (demo video, new-work statement)  
- [ ] Optional hosted FCC extension for live instruction demo  

---

*This report supersedes guesswork. Update `history.md` when any P0/P1 item ships.*
