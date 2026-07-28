# Beacon — Product Spec (Final Direction)

**Date:** 4 August 2026  
**Product:** Beacon  
**One line:** Finish AI work. Pay only when it passes. Open it every day.

---

# 1. What the user feels (non-negotiable)

Users never think about protocols, chains, or cryptography.

They feel this:

```
Choose Service
    → Describe Job
    → Instant Quote
    → Approve Once
    → Live Progress
    → Receive Result
    → Automatic Payment
    → Beautiful Receipt
```

**First 20 seconds must deliver the wow:**

1. Land on a clean desk of services (Video, Image, Voice, Deck, Code, Research, Docs).  
2. Tap **Video**. Drop a clip. Type one sentence.  
3. See a price in under ~3 seconds.  
4. Tap **Approve**.  
5. Watch progress bars that feel alive.  
6. Play finished work.  
7. See a receipt that looks like a premium invoice — not a block explorer.

If anything in those 20 seconds mentions wallets, networks, or “compute,” the product failed UX.

---

# 2. Product vision

Beacon is the **daily AI work desk**.

You describe what you need. Beacon finishes it. You pay only when quality checks pass. If a brand rule fails, you are not charged.

We are the platform. We own the model APIs (Claude Opus 5, GPT-5.x, image, video, voice). Users never bring keys. Users never pick vendors. Users never see our margins.

**Bigger problem than generation:** people pay for attempts and hope. Beacon sells **finished, checked work**.

---

# 3. Services (catalog)

| Service | What users get |
|---|---|
| Video | Ads, social packs, captioned cuts |
| Image | Creatives, thumbnails, product shots |
| Voice | Narration, multilingual VO |
| Presentations | Decks from brief + assets |
| Coding | UI variants, docs, review summaries |
| Research | Trading / prediction / competitor packs |
| Documents | Reports, SOPs, proposals |
| Agent API | Same catalog over HTTP for autonomous buyers |

### Video production path

Not “one prompt → hope”:

1. Plan stages from the brief  
2. Generate assets via our APIs where needed  
3. Compose with **Remotion** (captions, packing, brand frames)  
4. Orchestrate with an **OpenMontage-class** stage pipeline  
5. Quality-check before charge  

Exact Remotion / OpenMontage version pins: **VALIDATE FIRST** at build time.

---

# 4. Consumer copy dictionary

| User sees | Never show |
|---|---|
| Work credit | Mint, bridge, FXRP, gas |
| Add credit | Smart Accounts, Core Vault |
| Quote | Bound Offer, 402, authorization |
| Approve | Sign typed data, facilitator |
| Preparing your job | Sealed Fit, capability matrix |
| Generating | Model routing, TEE |
| Checking quality | Acceptance Engine, LLM-as-judge |
| Needs a quick look | Human-in-the-loop gate |
| Done | Settled, attested |
| Not charged | REJECT / FAIL |
| Receipt | Merkle root, TEE signature |

Optional deep link on receipt: **“How this was verified”** — plain language only. Technical detail stays in docs for builders/judges.

---

# 5. Screen-by-screen UX

### Landing

- Brand: **Beacon**  
- One line: Finish AI work. Pay only when it passes.  
- One CTA: **Start a job**  
- No stats strip. No protocol badges in the hero.

### Home (signed-in)

- **New job**  
- **Closed today**  
- **Needs a look**  
- Credit balance as a quiet number (“$42.10 credit”)

### New job

1. Choose service (large tiles)  
2. Describe + upload  
3. Optional: style / brand pack (saved once)  
4. Instant quote card: price, ETA, what’s included  
5. **Approve** (primary) · Edit brief (secondary)

### Live job

Progress stages in human language:

- Preparing  
- Generating  
- Composing  
- Checking quality  
- Finishing  

Cancel available until generation commits costs (policy: **VALIDATE** refund rules per stage).

### Result

- Preview / download pack  
- If auto-pass: “Paid $X · Receipt”  
- If needs look: Accept / Reject  
- If auto-fail: “Not charged — here’s why” (one sentence)

### Receipt

Looks like Stripe/Linear invoice:

- What was delivered  
- Price  
- Time  
- Brief summary  
- “Quality checks passed” / “You accepted”  
- Download PDF / share link  

Secondary: “Verification details” (collapsed).

### Add credit (one-time friction)

- “Pay with XRP” (beachhead) or “Pay with card/stable balance” (EVM path)  
- One confirmation in familiar wallet UI  
- Credit appears. Never ask again per job beyond **Approve**.

---

# 6. Invisible trust layers (architecture names only)

These exist for engineering and judging. They are **not** product UI.

| Layer | Job | When |
|---|---|---|
| Sealed Fit | Privately confirm we can fulfill this brief; lock price + quality rules | Before work |
| Bound Offer | Cryptographic lock of brief hash, price, SLA, rubric version | At quote approve |
| Execution | Run owned pipelines; keep keys private | During work |
| Acceptance Engine | Objective checks → constrained judge → private brand rules → optional external facts → confidence look | After work |
| Settlement | Charge only on PASS (or explicit user accept) | After accept |
| Receipt bind | Link payment ↔ brief ↔ quality report | On close |

**Settlement rule:**

```
CHARGE only if quote still valid
  AND quality PASS
  AND (no look required OR user Accept)

Else: DO NOT CHARGE
```

---

# 7. Acceptance Engine (who decides “done”)

Not “the model said it’s fine.”

1. **Objective checks** — duration, format, schema, build exit codes…  
2. **Constrained judge** — different model family when possible; binary rubrics + evidence; calibrate κ (target ≥ 0.6; actual **UNKNOWN** until gold set)  
3. **Private brand rules** — forbidden names, disclaimers, style anchors  
4. **External facts** when brief requires them — attested, not scraped by us alone  
5. **Needs a look** when confidence is low  

Rubric version is locked at quote time so rules cannot quietly soften after Approve.

---

# 8. Money (user view vs system view)

### User view

- Add work credit once  
- Approve each job’s quote  
- Auto-charge on pass  
- Free on fail  

### System view (docs / judges)

- Beachhead funding: XRPL → Flare Smart Accounts → FXRP → USDT0 work credit  
- Per-job: HTTP-native payment with EIP-3009 USDT0 (x402 pattern on Flare)  
- Official Flare guide: USDT0 has EIP-3009 path; FXRP x402 awaits EIP-3009 on FXRP — **VALIDATE** current mainnet/testnet token behavior before shipping  
- Coston2 faucet can mint test FXRP / USDT0 / C2FLR for development  

Hold-until-accept vs settle-on-access: standard x402 demos settle on resource fetch. Beacon requires outcome pricing → **VALIDATE FIRST** escrow or delayed-settle design (see IMPLEMENTATION.md).

---

# 9. Why users open Beacon every day

| Who | Trigger |
|---|---|
| Creators | Every publish cycle |
| Agencies | Every client request |
| Founders | Decks, landings, research |
| Marketing | Continuous creative throughput |
| Developers | Docs / review packs |
| Analysts | Daily research jobs |
| Agents | Scheduled API jobs |

Home is work inbox, not a dashboard of chain metrics.

---

# 10. Why Flare (judge / architecture)

Beacon both produces and grades work. Ordinary SaaS is pure vendor trust.

| Need | Mechanism |
|---|---|
| Private briefs + private quality rules + private model keys | Flare Confidential Compute extension |
| Per-job machine payments | x402 + USDT0 EIP-3009 |
| XRPL users fund without learning EVM gas | Smart Accounts |
| XRP → work credit | FAssets (FXRP) |
| Funding proofs + external “done” facts | FDC |

Remove any one and either trust, beachhead, or billing collapses. Details and honesty constraints: IMPLEMENTATION.md.

FCC is not yet fully public production ([FCC overview](https://dev.flare.network/fcc/overview)). Hackathon path: Coston2 + attested extension architecture; simulated TEE only where official scaffolds allow — never fake deliverables; `/health` must tell the truth.

---

# 11. Competitive honesty (short)

| Player | Gap vs Beacon |
|---|---|
| Spend-policy vaults | Stop bad spends; do not finish creative work |
| Payment receipt tools | Prove pay happened; do not prove brief satisfied |
| Official weather showcase | Pattern demo; not a daily work catalog |
| Consumer AI studios | Attempt billing; soft quotes; vendor self-grade |
| Pay-per-call video on other L2s | Attempts; no XRPL beachhead; no sealed quote→accept loop |

---

# 12. Demo script (product)

**0:00–0:20**  
Choose Video → drop clip → one sentence → quote → Approve → Done → play three ads.

**0:20–0:30**  
Show a failed variant: **Not charged — CompetitorCo detected.**

**0:30–0:45**  
Open receipt. Collapsed “How this was verified” in plain language. No jargon on the happy path.

---

# 13. Kill tests (product)

| # | Test | Kill if |
|---|---|---|
| A | 10 users complete a job with zero protocol words | &lt;7 can retell the flow |
| B | First 20 seconds filmed | Viewer cannot say what Beacon does |
| C | Free reject demo | Users shrug |
| D | Ask who decides quality | Answer is only “AI” with no checks |
| E | Real testnet job, real media, real charge/no-charge | Any mock step |

---

# 14. Success criteria

- [ ] Magical path works without crypto coaching  
- [ ] At least one free reject + one paid pass on Coston2  
- [ ] Receipt feels like a product, not an explorer  
- [ ] 5 external testers finish a job  
- [ ] Judges say some form of: “Of course this should exist.”

---

# 15. Final statement

Beacon is Bound Work sold as a calm consumer desk.

**Users see:** Choose → Describe → Quote → Approve → Progress → Result → Pay → Receipt.  
**Systems enforce:** sealed quote → checked delivery → charge only on pass.

Protocol complexity lives in IMPLEMENTATION.md — never in the first 20 seconds.

---

*Moved to project root: `beacon/PRODUCT.md`.*
