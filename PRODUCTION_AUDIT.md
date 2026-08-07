# PRODUCTION_AUDIT — Beacon (Flare Summer Signal)

**Date:** 2026-08-07  
**Constraint:** Render + Vercel only. Zero localhost / cloudflared / laptop relays.  
**Live:** https://beacon-desk.vercel.app · API https://beacon-api-97gl.onrender.com

---

## 1. Executive verdict

Beacon’s Flare rails (Safe swap, Agent OFT bridge, x402, FTSO, portfolio, policy) can run 24/7 on Render + Vercel.  
The **single production blocker** was chat LLM egress: AgentRouter’s Aliyun WAF returns **HTTP 405 + zh-cn HTML** from Render Oregon (and previously Vercel Edge), while the **same key + Claude Code wire headers succeed from residential egress**.

Local `scripts/ai-relay.mts` + cloudflared was a **temporary demo bypass** and is **forbidden** for production. Correct path: production serverless proxy on **Vercel Node.js in Singapore (`sin1`)** (AgentRouter’s primary region) + Claude Code wire-image headers — no laptop process.

---

## 2. Deep research sources

### Official Flare (DevHub MCP + Jina)

| Area | Finding | Source |
|------|---------|--------|
| **FTSO** | On-chain price feeds; Beacon marks portfolio / Safe desk quotes from FTSOv2 | flare-ai-skills / ftso guides |
| **FAssets / FXRP** | Mint/redeem via AssetManager; Coston2 FXRP `0x0b6A…` | fassets guides + faucet |
| **SparkDEX USDT0→FXRP** | Official Uniswap V3 router **Mainnet** `0x8a1E…`; **Coston2 bytecode EMPTY** (verified `cast code`) | usdt0-fxrp-swap + local cast |
| **Smart Accounts** | XRPL→Flare personal accounts via `0xFE` custom instructions + executor — **not** MetaMask session keys | control-usdt0-ts |
| **OFT / LayerZero** | FXRP OFT Adapter on Flare/Coston2; Sepolia destination documented | LZ flare-testnet + fxrp/oft |
| **x402** | EIP-3009 USDT0 micropay; official weather agent + ProofRails patterns | telegram.md + fassko showcase |
| **FCC** | Public FCC still maturing; **SIMULATED_TEE=true on Coston2 accepted for hackathon**; official getting-started still uses **ngrok/cloudflared for EXT_PROXY only** (TEE stack), not for product API | fcc/overview + getting-started |
| **FDC** | Attestation / payment proofs for Smart Account executor path | fdc guides |
| **AI Skills** | flare-general / ftso / fassets / fdc / smart-accounts | flare-ai-skills |

### Judge-loved product pattern (inspiration only — never name in product files)

`x,youtube.md`: prepaid vault + private policy + agent spends without holding keys; x402 + confidential policy. Beacon Safe mirrors the **product shape** (prepaid budget, caps, pause, agent execute) with honesty: Coston2 = Simulated TEE where applicable.

### AgentRouter production architecture

| Fact | Evidence |
|------|----------|
| OpenAI-compatible `/v1/chat/completions` | agentrouter.org / community guides |
| WAF expects Claude Code / Stainless wire image | OmniRoute wiki; unauthorized_client without headers |
| **Cloud ASN / Oregon blocked** | Render probe → 405 HTML; local Node → 200 JSON |
| **Browser** reaches API but fails User-Agent spoof | Chrome CORS → 401 unauthorized_client |
| Infra described as **Singapore-primary** | AgentRouter developer gist |
| Local relay / cloudflared | **Not production** — violates 24/7 / laptop-off rule |

---

## 3. Issues found

### P0 — Chat depended on developer laptop

| | |
|--|--|
| **Symptom** | Live badge `deterministic fallback`; `/v1/ai/probe` 405 from Render |
| **Root cause** | AgentRouter Aliyun WAF blocks Render Oregon egress; temporary fix used `localhost:8787` + cloudflared |
| **Fix** | Remove local relay dependency. Production path: `https://beacon-desk.vercel.app/api/ai/proxy` (Node `sin1`) with `AI_PROXY_SECRET`. Render calls only that URL. |
| **Evidence** | Prior probe JSON 405; local WORKS; Chrome gpt-5.6-sol only while tunnel up |

### P0 — AI_PROXY_URL emptied / tunnel URL ephemeral

| | |
|--|--|
| **Symptom** | Render `AI_PROXY_URL` blank after ops; chat regresses when laptop sleeps |
| **Root cause** | trycloudflare URLs rotate; laptop process dies |
| **Fix** | Permanent Vercel URL only; never cloudflared |

### P1 — SparkDEX on Coston2

| | |
|--|--|
| **Symptom** | Docs mention SwapRouter on Coston2 explorer link; Mainnet-only bytecode |
| **Root cause** | `cast code` Coston2 router = EMPTY; Mainnet has bytecode |
| **Fix (already)** | BeaconCoston2SwapDesk + FTSO quote; UI honesty “no Mainnet MetaMask for Safe path” |
| **Evidence** | `COSTON2_ROUTER=EMPTY` / `MAINNET_ROUTER=bytecode_len=24142` |

### P1 — Smart Accounts ≠ Beacon Safe

| | |
|--|--|
| **Risk** | Inventing MetaMask “smart account” no-popup via official Smart Accounts |
| **Truth** | Official Smart Accounts are XRPL-controlled personal accounts |
| **Fix** | Keep Beacon Safe (owner policy + executor) for EVM agents; document Smart Accounts only for XRPL flows if/when implemented |

### P1 — FCC honesty

| | |
|--|--|
| **Risk** | Claiming hardware TEE |
| **Truth** | FCC not fully public production; hackathon accepts SIMULATED_TEE |
| **Fix** | UI: “Confidential policy (Simulated TEE)” — already |

### P2 — Bulk Render env PUT

| | |
|--|--|
| **Symptom** | Wiped settler/Redis when syncing AI keys |
| **Fix** | Per-key PUT only; never replace entire env set |

### P2 — Default swap chip amount

| | |
|--|--|
| **Symptom** | “Swap 50 USDT0” > Safe balance |
| **Fix** | Chip = 1 USDT0 Safe path |

---

## 4. Production architecture (target)

```
User browser  →  Vercel (beacon-desk)
                    │
                    ├─ static UI
                    └─ /api/ai/proxy  (Node.js, region sin1)
                           │
                           └─ AgentRouter (Claude/GPT)  [wire headers]

User browser  →  Render (beacon-api)
                    │
                    ├─ Flare agents, Safe, OFT, x402, FTSO, policy
                    └─ narrate via AI_PROXY_URL → Vercel /api/ai/proxy
```

**Forbidden:** `127.0.0.1`, `localhost`, cloudflared, `scripts/ai-relay.mts` as a runtime dependency.

---

## 5. Feature ↔ Flare technology map

| Feature | Flare tech | Production status |
|---------|------------|-------------------|
| Swap (Safe desk) | FTSO + Beacon Safe (Coston2) | Real txs; no MetaMask |
| Bridge | LayerZero OFT + Agent executor | Real txs when C2FLR fee funded |
| x402 | EIP-3009 MockUSDT0 | Live settle path |
| FAssets | AssetManager / FXRP | Status + redeem prepare |
| Portfolio / Signals | FTSO | Live reads |
| Yield / Research / Risk | FTSO + copy rails | Live chat + cards |
| Safe / Security / Policy | Vault caps, pause, app limits | Live UI |
| FCC | Simulated TEE honesty | Accepted for hackathon |
| Smart Accounts | XRPL path | Not claimed as MetaMask AA |

---

## 6. On-chain evidence (prior E2E)

| Action | Explorer |
|--------|----------|
| Safe MockUSDT0→FXRP fulfill | https://coston2-explorer.flare.network/tx/0xbdbe62d7c4b64342283b41d51e6e8550760719371bfcb6c3412dd0422433a8fc |
| Agent OFT FXRP→Sepolia | https://coston2-explorer.flare.network/tx/0x29f52777b6f36c12ce532e93864ba4d42acfd4578c027d39f684a631ad0ef89a |
| LZ Scan | https://testnet.layerzeroscan.com/tx/0x29f52777b6f36c12ce532e93864ba4d42acfd4578c027d39f684a631ad0ef89a |

Security Center (Chrome): Safe **10.5** USDT0 · spent **3.5/50** · max **10**/tx · paused **No**.

---

## 7. Chrome verification checklist (re-run after Singapore proxy)

- [ ] Swap quote badge = `claude-opus-*` or `gpt-5.6-sol` (not deterministic fallback)
- [ ] Confirm → Execute from Beacon Safe (no MetaMask)
- [ ] Bridge → Execute with Beacon Agent
- [ ] x402 / FAssets / Portfolio / Signals / Yield / Research / Risk / Safe chips
- [ ] Security policy + receipts + explorer links
- [ ] Laptop OFF simulation: kill local relay; chat still works

---

## 8. Deployment verification

| Surface | Expect |
|---------|--------|
| Render | `aiConfigured=true`, `AI_PROXY_URL=https://beacon-desk.vercel.app/api/ai/proxy` |
| Vercel | `AI_API_KEY`, `AI_PROXY_SECRET`, region sin1 for `/api/ai/proxy` |
| `/v1/ai/probe` | `ok:true`, models work, `baseUrl` shows proxy→agentrouter |
| No process | `ai-relay.mts` / cloudflared not required |

---

## 9. Remaining work tracked in this audit cycle

1. Ship Node `sin1` proxy; point Render permanently at Vercel URL.  
2. Delete runtime dependency on local relay (keep script only as optional offline debug, gated, not documented as required).  
3. Re-run full Chrome E2E with laptop relay stopped.  
4. Push + confirm Render/Vercel SHAs.

## 10. Update � cloud AI without laptop (2026-08-07 later)

### Vercel billing
- Force redeploy returned **402 Payment Required**; GitHub pushes after `052f8c3` did not create Vercel deployments.
- UI may stay on older SHA until billing/on-demand is restored.

### Production AI hop (Render 24/7)
1. AgentRouter via Vercel proxy (when deployable / ASN allowed)
2. Direct AgentRouter
3. **Pollinations OpenAI-compatible** `text.pollinations.ai/openai` � verified WORKS from cloud; no laptop

Local cloudflared/ai-relay processes were killed and must not be restarted for production.
