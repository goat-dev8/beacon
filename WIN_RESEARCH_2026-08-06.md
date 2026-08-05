# Beacon Win Research — 2026-08-06

Living research file for the Flare Summer Signal mission. No secrets. Honesty over hype.

---

## Sources (read this session)

| Source | Finding |
| --- | --- |
| DevHub MCP `llms.txt` + FAssets / FTSO / FDC / network | Coston2 is the app track; registry `0xaD67…6019` |
| [FAssets reference](https://dev.flare.network/fassets/reference) | **Coston2: only AssetManager Testnet XRP** → FTestXRP. No FBTC/FDOGE managers on Coston2 |
| `AssetManagerController.getAssetManagers()` on Coston2 | Returns **1** manager: `0xc1Ca…bDFA` (FXRP test) |
| [SparkDEX V3 docs](https://docs.sparkdex.ai/…) | Factory `0x8A25…E652`, SwapRouter `0x8a1E…2781` |
| `eth_getCode` Coston2 vs Flare | Router/Factory/Quoter = **empty on Coston2**; **deployed on Flare Mainnet** |
| Mainnet factory `getPool` scan | Liquid pools: USDT0/FXRP fee 500 (+3000/10000 thin); WNAT/FXRP & WNAT/USDT0 across tiers |
| [USDT0↔FXRP guide](https://dev.flare.network/fxrp/token-interactions/usdt0-fxrp-swap) | Addresses labeled **Flare Mainnet** |
| [control-usdt0-ts](https://dev.flare.network/smart-accounts/guides/typescript-viem/control-usdt0-ts) | Coston2 guide reuses mainnet router address — **docs mismatch**; do not ship silent dead swaps |
| LayerZero Flare testnet | FXRP OFT adapter on Coston2 has code; `peers(eid)` discovery already shipped |
| FCC / Confidential Compute | Not a public production primitive for this product path → keep **simulated** labels only |
| Local skills (`flare-fassets-skill`, FTSO scripts) | Settings/lot size + FTSO XRP/USD are real read paths |
| Product knowledge (`history.md`, discord/telegram/x notes) | Judges love real rails + vault-grade honesty; no clone of prediction markets |

---

## Hard constraints (do not violate)

1. **Never fake SparkDEX on Coston2.** Preflight `getCode(router)`. If empty → block execute on 114; offer **Flare Mainnet (14)** prepare + chain switch.
2. **Never invent FAssets.** On Coston2 show only managers returned by controller. FBTC/FDOGE = documented elsewhere / not mintable here → status “not on Coston2”.
3. **No Polymarket / betting UI.** AI Market Intelligence = FTSO + balances + liquidity + LLM reasoning with probability/confidence/risk — not markets.
4. **No incomplete Voice / Video stubs in Flow agents.** Bound Work video pipeline may remain if Remotion path is real; Flow `@video` / desk voice catalog entry removed or redirected.
5. **FCC:** only simulated policy labels unless a real FCC API is integrated (it is not).

---

## Architecture that stays

```
Intent → Clarify → Quote → Policy → Pay → Execute → Observe → Receipt → History → Resume
```

Every agent uses the same pipeline. Paid paths use x402 + Security Center policy.

---

## Ship list (this cycle)

| # | Feature | Reality proof |
| --- | --- | --- |
| 1 | SparkDEX dynamic pairs | Mainnet factory scan; fee tiers; bidirectional prepare |
| 2 | Swap honesty gate | Coston2 cannot execute dead router; Mainnet can |
| 3 | FAssets desk | Controller managers + FXRP settings + FTSO lot value |
| 4 | Portfolio agent | Live FTSO + wallet USDT0/FXRP/WNat balances |
| 5 | Market Intelligence | FTSO heuristic + LLM; no odds markets |
| 6 | Bridge | Keep on-chain OFT peer discovery (already live) |
| 7 | Remove Flow voice + soft video agent | Quality over placeholders |
| 8 | Primitive badges | Every card names FTSO / SparkDEX / LZ / FAssets / x402 |

---

## Network map (Beacon)

| Capability | Network | Why |
| --- | --- | --- |
| FTSO feeds | Coston2 (also works mainnet registry) | Hackathon default 114 |
| x402 / MockUSDT0 / Bound Work | Coston2 | Deployed Beacon stack |
| FXRP OFT bridge | Coston2 | Adapter + peers live |
| FAssets status / FXRP token | Coston2 | Registry AssetManagerFXRP |
| SparkDEX swap | **Flare Mainnet** | Only place router+pools exist |

UI must make this map obvious to judges.

---

## Decisions log

- **2026-08-06:** Discovered SparkDEX bytecode absent on Coston2. Prior Beacon swap prepare targeted a non-contract — treat as critical honesty fix.
- **2026-08-06:** “Discover ALL pairs” = scan known token set (USDT0, FXRP, WNat) × Uniswap V3 fee tiers via factory; emit only pools with `liquidity > 0`. Do not invent tokens.
- **2026-08-06:** “Discover ALL OFT assets” on Coston2 today = FXRP OFT adapter + dynamic EIDs. Other OFTs only if we can resolve adapters on-chain; do not hardcode fake assets.
- **2026-08-06:** Market Intelligence ≠ betting.
