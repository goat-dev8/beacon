# Beacon — Product Flagship Research

**Date:** 2026-08-06  
**Product:** Beacon Flare AI OS  
**Hackathon:** Flare Summer Signal  

---

## 1. Mentor recommendations (Quantic / Kristaps / Tim)

Synthesized guidance from Flare mentors and DevRel (Quantic / FlareDevHub orbit, Kristaps, Tim) for what wins judging — not private competitor names.

| Theme | Recommendation | Beacon implication |
|---|---|---|
| **Product clarity** | Judges must grasp the product in one breath — not a feature dump | Lead with Beacon Safe + Flow story, not “developer dashboard” chrome |
| **Real Flare use today** | Prefer live rails on Coston2 / Mainnet over vapor or cloned dashboards | FTSO, SparkDEX (Mainnet), OFT, FAssets FTestXRP, x402 MockUSDT0, on-chain Safe |
| **FCC `SIMULATED_TEE` accepted** | Official hackathon path is simulated TEE on Coston2; do not fake hardware Confidential Space | Default `FCC_MODE=simulated` when `SIMULATED_TEE=true`; label honestly |
| **FAssets redeem-any-amount** | Surface redeem that matches real AssetManager behavior (not lot-only theater where product supports any amount) | Honest FAssets desk: live managers only; redeem prepare aligned to protocol |
| **Avoid DeBank clone** | Portfolio scanners without Flare-native loops lose | Do not ship a generic wallet portfolio; own signal → policy → pay → execute → receipt |

**Signal judges reward:** clear Flare primitive badges, complete loops, honesty about simulated vs attested.

---

## 2. Official FCC stance (hackathon path)

| Setting | Hackathon-correct | Notes |
|---|---|---|
| `SIMULATED_TEE` | `true` | Simulated attestation — accepted for Summer Signal demos |
| `LOCAL_MODE` | `false` | Real Coston2 chain, not offline-only stub |
| Hardware TEE / Confidential Space | **Not public yet** | Never claim hardware-attested FCC in live UI |
| `FCC_MODE` | `simulated` when `SIMULATED_TEE=true` | Saying `unavailable` while running simulated TEE is **wrong** and confuses judges |

Sources: DevHub FCC overview/guides; official FCE scaffolds (`fce-weather-insurance-x402-agent`, `fce-beacon` proxy `/info`); Beacon `flare-fcc-skill`.

---

## 3. Product decision — rename Agent Vault → **Beacon Safe**

| Layer | Name |
|---|---|
| User-facing UI / landing / receipts | **Beacon Safe** |
| On-chain Solidity | Keep `BeaconAgentVault` (contract identity unchanged) |
| Internal types | `AgentVaultStatus` etc. may remain; optional alias exports |

**Rule:** Never name competitor projects in product copy. Beacon Safe is the prepaid policy budget; Bound Work escrow remains a separate per-job lock.

---

## 4. Product story (demo spine)

```
Deposit → Policy → Talk → Reason → FCC verify (simulated) → Execute → Receipt → History
```

1. **Deposit** — fund Beacon Safe (USDT0 on Coston2)  
2. **Policy** — daily / per-tx limits, allowlists, pause  
3. **Talk** — agent chat in Flow  
4. **Reason** — FTSO / desk cards / quotes (network-honest)  
5. **FCC verify (simulated)** — confidential policy check labeled simulated TEE  
6. **Execute** — swap / bridge / pay / redeem under policy  
7. **Receipt** — Authorization Receipt + explorer links  
8. **History** — conversation + execution trail  

---

## 5. Judge weaknesses of current UI (fix targets)

| Weakness | Why it hurts | Fix direction |
|---|---|---|
| **Developer dashboard** | Looks like an internal console, not a product OS | Consumer-grade Safe + Flow; one job per section |
| **Jargon** | Nonces, windows, FCC unavailable, agent IDs front-and-center | Friendly labels; hide protocol details behind status |
| **Empty chat** | Cold Flow with no story on first open | Seeded welcome + clear next actions |
| **`fccMode: unavailable` wrong** | Mentors accept simulated TEE; UI denied the official path | Default simulated when `SIMULATED_TEE=true`; badge “Confidential policy (simulated TEE)” |

---

## 6. Honesty locks

1. Never invent APY or SparkDEX liquidity on Coston2.  
2. Never claim hardware-attested Confidential Space while `SIMULATED_TEE=true`.  
3. Never present fallback OFT peers as live routes.  
4. Beacon Safe ≠ Bound Work escrow — keep the distinction in copy.

---

*Living product north star for flagship ship work on 2026-08-06.*
