# Beacon demo shoot plan — you run every tx

Record on **Coston2 (114)** at https://beacon-desk.vercel.app  
Wallet (owner): `0xBDfC…0034` · Safe: `0xc7D9…d5ac` · Available **5 USDT0** · Per-trade cap **3 USDT0** · Rolling **50**

Story: **Intent → Policy → Hardware TEE → Flare data/proof → Execution → Receipt.**

This take is **live**. Do not cut to old explorer hashes. After each action, open the **new** link on the card (Hardware FCC, spend, fulfill, LayerZero Scan, Jobs, x402). Expect **8–12 minutes** if you wait for LayerZero **DELIVERED**.

Wait up to **~40 seconds** after ALLOW / DENY prompts. The hardware TEE must sign on-chain. Do not refresh.

If Flow says **Security session expired after 24h**, hard-refresh and send the prompt again (server session now renews). You do not need to re-save App limits.

---

## Exact FCC prompts (this order)

**ALLOW** (under the 3 USDT0 per-trade cap — also under your 5 USDT0 Safe balance):

```
Swap 0.01 USDT0 to FXRP from Beacon Safe
```

Wait for the green strip **Hardware TEE · ALLOW status 1** and **Open FCC instruction**.  
Then **Confirm swap** → **Execute from Beacon Safe**. Open the **new** spend + fulfill hashes from that card.

**DENY** (over the 3 cap, still under Safe balance — this is the real policy violation, not “not enough USDT0”):

```
Swap 4 USDT0 to FXRP from Beacon Safe
```

Wait for **Hardware FCC DENY** / **status 0** and **Open FCC instruction**.  
Do **not** Execute. No money moves.

Do **not** use `Swap 12 USDT0…` or `Swap 100 USDT0…` for this Safe. 12 and 100 are over the **5 USDT0** balance, so Flow would show a balance miss instead of a cap DENY. **4** is the clean DENY: 4 > 3 cap, 4 < 5 balance.

---

## Scenes

### Intent

| | |
|---|---|
| **Do** | Open landing. Pause on the hero. Click **Get Started**. |
| **Type** | nothing |
| **Show** | “Where intent becomes proof.” Wallet `0xBDfC…0034` · Coston2 114. |
| **Say** | “Beacon is the Flare AI OS. An agent does not get a hot wallet. Intent goes in. Policy and hardware compute gate spend. Flare executes. You get a receipt.” |

### Policy (Safe)

| | |
|---|---|
| **Do** | Click **SAFE**. Scroll the policy row once. |
| **Show** | Banner **Confidential policy (hardware TEE)**. Safe `0xc7D9…d5ac`. Available **5 USDT0**. Per-trade **3**. Rolling **50**. Paused **No**. Owner/executor `0xBDfC…0034`. |
| **Open** | The Safe address explorer link from the card (live). |
| **Say** | “Budget lives in Beacon Safe. Three USDT0 per trade. Fifty rolling. The Safe is the spend boundary — FCC cannot move funds.” |

### Hardware ALLOW — then you execute

Stay on **FLOW**. Badge must read **Confidential policy (hardware TEE)**.

1. Paste: `Swap 0.01 USDT0 to FXRP from Beacon Safe`
2. Send. **Wait** for the quote **and** the green **Hardware TEE · ALLOW status 1** strip.
3. Click **Open FCC instruction** — that tab is **this take’s** ALLOW tx (status 1). Leave it open.
4. Back on Flow: **Confirm swap**.
5. **Execute from Beacon Safe**. Wait until Safe spend + desk fulfill show confirmed.
6. Open **both new hashes** from the card (spend, then fulfill). FXRP received.

Say: “Under the cap. Hardware TEE signs ALLOW — status 1. Then the Safe spends. Explorer receipt.”

### Hardware DENY — you do not execute

1. **New chat** (so the ALLOW card is not the live surface).
2. Paste: `Swap 4 USDT0 to FXRP from Beacon Safe`
3. Send. **Wait** for **Hardware FCC DENY** / **BLOCKED** / **status 0**.
4. Click **Open FCC instruction** — that tab is **this take’s** DENY tx (status 0).
5. Optional 1s flash: https://coston2-systems-explorer.flare.network/tee/extensions/65925  
   TEE `0x2ebC…6506` · GCP_AMD_SEV · status **2**.
6. Do **not** Execute.

Say: “Four versus a three USDT0 cap. Balance is enough. The cap is not. Hardware signed status zero. No execution. No money moved.”

### Flare data (FTSO)

| | |
|---|---|
| **Do** | FLOW → chip **Signals**. |
| **Type** | `Show FTSO signals for FXRP` |
| **Show** | Live XRP/USD (same feed that guarded the swap). |
| **Open** | https://coston2-systems-explorer.flare.network/price-feeds?tab=block-latency |
| **Say** | “Flare prices the move. Block-latency FTSO.” |

### Flare proof (FDC) — you submit from Beacon

Do **not** start on the systems-explorer homepage (feeds + validators). That is not FDC.

Stay on **FLOW**. Chip **FDC** (or paste the prompt). Beacon submits a real AddressValidity request to **FdcHub** on Coston2. Wait — this is an on-chain tx, ~10–20s.

**Prompt**

```
Prove XRPL address with FDC
```

(Uses Flare’s test XRPL address `rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe`. You can paste any `r…` address after the prompt.)

| | |
|---|---|
| **Do** | Send the prompt. Wait for **FDC submitted** + voting round number. |
| **Open from the card** | **Open FdcHub tx** (this take’s submit). Then **Open FDC round** (tab **FDC**, wait until **FINALIZED** — often 90s–3min). |
| **Then** | Back on Flow, tap **Check FDC proof**. Card must read **VERIFIED** (`verifyAddressValidity` true). |
| **Say** | “Beacon asked Flare Data Connector to attest an XRPL address. FdcHub took the request. The round finalized. The DA proof verified on-chain. We did not fake a mint button.” |

If the round is still pending, stay on the FDC tab until FINALIZED, then check again. Do not cut to an old round number.

Direct URLs (only after the card gives you a round id):  
https://coston2-systems-explorer.flare.network/attestation-request  
https://coston2-systems-explorer.flare.network/voting-round/YOUR_ROUND?tab=fdc  
Nav if you get lost: **FDC** dropdown on systems explorer — not the homepage search.

### Execution: LayerZero (you send)

| | |
|---|---|
| **Do** | FLOW → chip **Bridge**. |
| **Type** | `Bridge FXRP to Sepolia` |
| **Then** | Confirm / Execute. Wait for source tx on the card. |
| **Open** | LayerZero Scan from the card. Wait until **DELIVERED**. Then open the dest Sepolia hash. |
| **Say** | “Same story across chains. Source message. Destination fill. We do not stop at in-flight.” |

Use a small FXRP size (e.g. 0.01–0.05) so inventory and gas stay comfortable.

### Receipt: Agent Jobs (you create both)

Open https://beacon-desk.vercel.app/flow/desk → **New job**.

**Success**

- Service: coding (or image).
- Brief: a tiny real task, e.g. `Write a tiny TypeScript function add(a: number, b: number).`
- Pay from Beacon Safe. Wait until **Done** / **Paid** / quality passed.
- Open the **new** settle hash from the job.

**Fail + refund**

- **New job** again.
- Brief **must include** the exact token:  
  `BEACON_E2E_GENERATION_FAIL Write a tiny TypeScript function add(a: number, b: number).`
- Pay from Beacon Safe. Wait until **Generation failed. You were not charged.** / **$0.00**.
- Open the **new** refund hash.

Say: “Work passed, escrow released. Work failed, refund to the Safe.”

### Receipt: x402 (you pay)

| | |
|---|---|
| **Do** | FLOW → chip **x402**. |
| **Type** | `Pay using x402` |
| **Then** | Click **Pay $0.25**. Confirm in MetaMask. |
| **Open** | The **new** settlement hash on the card. |
| **Say** | “Agent hits a paid resource. Four-oh-two. USDT0 settlement. Receipt.” |

### FAssets (honest)

| | |
|---|---|
| **Do** | FLOW → chip **FAssets**. |
| **Type** | `Redeem FAssets` |
| **Show** | FTestXRP **live**. Mint = **docs_handoff**. Redeem = prepare. |
| **Open** | https://coston2-systems-explorer.flare.network/fassets |
| **Say** | “FXRP is live on Coston2. Minting is not an in-app USDT0 click — XRPL Testnet payment plus FDC proof. We do not fake a mint button.” |

### MCP

| | |
|---|---|
| **Do** | Click **AGENTS**. |
| **Show** | “Your agent never receives your private key.” Scopes. Expiry. **Revoke**. |
| **Say** | “Claude or Cursor can use Beacon tools through MCP. Short-lived token and scopes — never the key.” |

### Close

Landing → **Protect** / “Why each piece exists”. End on the hero.

Say: “Intent. Policy. Hardware confidential compute. Flare data and proof. Execution. Receipt. That is Beacon on Flare.”

---

## Tabs to keep open (recording surface + explorers)

You type only in Flow / Jobs / Safe. Other tabs are for the **new** links the UI gives you.

1. https://beacon-desk.vercel.app  
2. https://beacon-desk.vercel.app/start  
3. https://beacon-desk.vercel.app/flow/security  
4. https://beacon-desk.vercel.app/flow  ← **main recording surface** (wallet connected)  
5. https://beacon-desk.vercel.app/flow/desk  ← create Jobs here  
6. https://beacon-desk.vercel.app/flow/mcp  
7. https://coston2.testnet.flarescan.com/address/0xc7D9393EAe4C4391997B4Af28c023cCAf7c6d5ac  
8. https://coston2-systems-explorer.flare.network/tee/extensions/65925  
9. https://coston2-systems-explorer.flare.network/price-feeds?tab=block-latency  
10. https://coston2-systems-explorer.flare.network/fassets  
11. https://coston2-systems-explorer.flare.network/attestation-request  ← FDC list (not the homepage)  
12. Blank explorer tab — paste each **new** FCC / FDC / spend / fulfill / LZ / Jobs / x402 hash from the UI  

---

## If something looks wrong

| What you see | What it means | What to do |
|---|---|---|
| `Safe balance … < 12` or `< 100` | Wrong DENY prompt (balance miss, not cap) | Use **4 USDT0**, not 12 or 100 |
| `Security session expired after 24h` | Stale server App-limits clock (not the on-chain Safe session) | Hard-refresh Flow and retry. Saving spending policy also refreshes the server session. |
| `Amount exceeds maxSpendPerTx` **without** Hardware TEE strip | Old API (no FCC on Flow) | Hard-refresh after deploy; wait the full TEE round-trip |
| ALLOW quote with no green strip after ~40s | TEE submit/poll failed; swap can still execute | Retry ALLOW once; if strip missing, still Execute and say policy ALLOW is on-chain Safe + server |
| DENY card **Hardware FCC DENY** + **Open FCC instruction** | Correct | Open that hash. Do not Execute |
| Jobs success says quality passed on **$0** | Wrong job / fail path | Success job must complete paid; fail brief must include `BEACON_E2E_GENERATION_FAIL` |
| Systems explorer homepage (feeds + horses banner) | That is **not** FDC | Use the **Open FDC round** link from the Flow card, or nav **FDC** → attestation requests |
| FDC card stuck on Requested with an error | Verifier/submit failed | Retry the prove prompt once; do not fake a round |

Live health (optional pre-roll):  
https://beacon-api-97gl.onrender.com/health · `/v1/fcc/status` → `hardwareClaim=true` · `simulatedTee=false` · `fccMode=verified`
