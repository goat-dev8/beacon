# Beacon Win Research — 2026-08-05

Research-first brief for Flare Summer Signal · Bounty 1 (Interoperable Asset Products).
Sources: DevHub MCP, installed Flare skills, LayerZero Flare testnet docs, product audits, community notes. No competitor names.

---

## Direct answer: "Settled for this service"

**Wrong as a permanent lock.**

Official x402 (DevHub): each EIP-3009 authorization uses a **unique nonce**; idempotency is per payment, not per catalog SKU. Paying Research / FTSO / Logo again is valid and expected (fresh signature → settle → new delivery).

| State | Meaning | Should allow Pay again? |
|---|---|---|
| Unpaid | No delivery for this service in this chat yet | Yes · Pay & run |
| Last run settled | Prior `media_result` exists for this `serviceId` | **Yes · Pay again** |
| Policy blocked | Server `assertPolicyAllows` failed | No settle · show Authorization Receipt |

Security Center remaining budget (e.g. 48.25 / 50) is unrelated to the Settled badge. Settled ≠ out of budget.

**Fix shipped:** badge → "Last run settled"; CTA → **Pay again**; copy explains fresh nonce; execution drawer no longer sticks on the wrong catalog row.

---

## Official Flare stack (what Beacon must show)

| Protocol | Status on Beacon | Judge story |
|---|---|---|
| **FTSO V2** | Real live feeds | Signals + paid deep pack |
| **SparkDEX** | Real USDT0→FXRP | Hero-adjacent DeFi leg |
| **FAssets / FXRP** | Real token + redeem awareness | Asset product core |
| **LayerZero OFT** | Real `quoteSend` + source send; dest fill via LZ Scan only | Hero bridge demo · honest |
| **x402 + EIP-3009** | Real MockUSDT0 + Facilitator on Coston2 | Machine-native micropay |
| **Security policy** | Server-enforced (Redis); FCC **simulated** (DevHub: FCC not public yet) | Authorization Receipt |
| **Smart Accounts** | XRPL→Flare path; not MetaMask session keys | Label honestly · do not over-claim |
| **FDC** | Scaffold / skills present | Attestation future · not fake |
| **Escrow Bound Work** | Real BeaconEscrow | Large jobs vs Flow micropay |

Addresses (Coston2) stay in product rails / health — verify on explorer every demo.

---

## Installed skills (repo)

Under `beacon/.cursor/skills/`:

- `flare-general-skill`
- `flare-ftso-skill`
- `flare-fassets-skill`
- `flare-fdc-skill`
- `flare-fcc-skill` (experimental · not public prod)
- `flare-smart-accounts-skill`

Plus FCE scaffold under `beacon/fce-beacon/` for future TEE extensions when FCC is public.

---

## Community / judge patterns (anonymized)

What wins demos (from discord / telegram / social notes):

1. Real Coston2 txs with explorer links — not protocol tourism.
2. One signature journey where possible (x402 gasless payer).
3. Private / server spend rules; show **blocked** and **allowed** receipts.
4. Micropay → artifact → receipt (no second fake catalog after pay).
5. Owner-controlled budget; agent never holds the user's key.
6. Complete product flow in ≤3 minutes.

---

## Prediction markets / Polymarket?

**No betting UI. No Polymarket clone.**

Researched [Polymarket Predictions APIs](https://docs.polymarket.com/api-reference/predictions/overview) (Gamma / CLOB / Data). For Bounty 1 (Interoperable Asset Products) an external prediction venue dilutes the Flare hero story (FXRP · SparkDEX · LZ OFT · x402 · FTSO).

If market odds are ever useful later: only as **labeled external evidence** beside FTSO in Research, never as a trading venue and never presented as guarantees.

**This ship:** live FTSO strip in Flow + dynamic on-chain OFT peer discovery instead.

---

## Work page

**Keep** Bound Work under ProductShell (`/flow/desk`). Flow = instant x402 / swap / bridge. Work = escrow creative jobs. Shared wallet + desk draft persistence. Do not merge into chat; do not orphan `/app`.

---

## Persistence

| Data | Status |
|---|---|
| Flow chats + messages | Postgres · wallet-keyed |
| Activity strip | Postgres |
| Wallet restore | ProductWalletProvider + localStorage hint |
| Settled service IDs | Inferred from `media_result` (not a lock) |
| Policy | Redis |
| Desk draft | sessionStorage |

---

## Highest-ROI ship order (this session + next)

1. **Pay again** after settle (done) — demo loops without New chat.
2. **Execution drawer** prefers unpaid / latest delivery (done).
3. **Authorization Receipt** card when policy blocks pay (done).
4. Richer **FTSO deep pack** content after settle (done).
5. Next: bridge dest honesty + LayerZero Scan UX; policy demo script (cap $0.50 → block $0.75 research); ensure chat models use Agent Router Claude/GPT roles; video Remotion only when wired for real.

---

## 3-minute judge script

1. Swap 1 USDT0→FXRP → explorer receipt.
2. `@pay` → Research or FTSO → Pay & run → real artifact → Pay again once.
3. Refresh → wallet restore → chat history back.
4. Policy: lower daily/per-job → attempt pay → Authorization Receipt BLOCKED.
5. Bridge FXRP OFT → source tx + LayerZero Scan · never invent dest fill.
6. Close on Flare-only stack: FTSO · SparkDEX · FAssets · LZ · x402 · policy.

---

## Honesty lines (never drop)

- MockUSDT0 ≠ mainnet USDT0; used for x402 / escrow demos.
- FCC policy evaluation is **simulated** until Flare FCC is public.
- Bridge destination fill only when LayerZero Scan shows Delivered.
- Smart Accounts are XRPL-instruction driven — not “invisible MetaMask”.
