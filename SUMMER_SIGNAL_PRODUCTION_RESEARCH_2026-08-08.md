# Summer Signal production research (2026-08-08)

Single synthesis of Flare docs, Beacon architecture, MCP/skills, and live product constraints for Flare Summer Signal.

## Product truth

Beacon is a **Coston2-only (chain 114)** Flare AI OS:

| Surface | What it is |
|---------|------------|
| Bound Work (`/flow/desk`) | Escrow creative jobs: EIP-3009 → BeaconEscrow lock → generate → acceptance → release/refund |
| Beacon Flow (`/flow`) | Chat agents: signals, Safe swap, OFT bridge, x402 micropay, FAssets, portfolio |
| Beacon Safe (`/flow/security`) | On-chain prepaid budget + policy + pause/revoke for **agent executor spends** |

Live: desk `https://beacon-desk.vercel.app` · API `https://beacon-api-97gl.onrender.com`.

## Flare primitives (what judges should see)

- **Coston2 (114)** — only network for Beacon product txs. Never Mainnet (14) in UI/SDK paths.
- **x402** — HTTP 402 + EIP-3009 MockUSDT0 + facilitator settle (docs path). Not ERC-20 Approve-only weather demos.
- **FTSO** — price narrative / mid for Safe desk FXRP quotes.
- **FAssets / FXRP** — Coston2 FXRP + OFT adapter routes (LayerZero Flare testnet).
- **LayerZero** — OFT bridge FXRP Coston2 → Sepolia when executor funded.
- **FCC** — Confidential policy story; **SIMULATED_TEE** accepted for judging on Coston2 (hardware TEE optional).
- **Smart Accounts (Flare docs)** — XRPL personal accounts; **not** MetaMask account abstraction and **not** Beacon Safe.
- **Beacon Safe** — BeaconAgentVault + SwapDesk: owner funds / sets policy; **executor** auto-spends allowlisted targets within caps.

## Agent Safe vs Bound Work signatures

| Flow | Who signs | Why |
|------|-----------|-----|
| Safe deposit (EIP-3009) | Funder wallet | Pull MockUSDT0 into vault |
| Safe setPolicy / pause / revoke | **Owner** | On-chain admin |
| Safe MockUSDT0→FXRP | **Executor key** (server) | Policy-controlled; no MetaMask per trade |
| Bound Work escrow lock | **Job payer EOA** | BeaconEscrow + EIP-3009 design: one auth locks job budget |
| Flow x402 resource | Payer EOA | Micropay for paid resource |

If MetaMask appears on Bound Work Approve, that is the **required one-time job lock**, not a Safe regression. Safe swaps must never ask Mainnet.

## Critical bug map (research → fix)

1. **Agent Safe MetaMask** — SparkDEX Mainnet fallback asked chain switch; Safe path must win on 114.
2. **Mainnet after deposit/swap** — SparkDEX bytecode Mainnet-only; product must hard-block chain 14.
3. **Spending policy “disabled”** — Owner-gated UI; vault owner must match connected wallet.
4. **Emergency feel broken** — Same owner gate + weak live status.
5. **$10+ quotes** — Old cent formula; replace with micro AI token economics (~$0.005–$0.08).
6. **Coding unsupported** — Sealed Fit AI invented NO_FIT; catalog must always FIT for listed services.
7. **x402 UX** — Real rails existed; Bound Work needed clearer settlement timeline.
8–11. **Explainers / Work UI** — Why Flare + FCC + premium progress already partly on landing/Security; desk progress upgraded.

## Env / chain audit rules

- `CHAIN_ID=114` only for product.
- All RPC defaults → Coston2.
- `ensureFlareMainnet` / SparkDEX execute path **throw** in web wallet.
- Agent swap: if Safe fails on 114, return “Stay on Coston2” — never SparkDEX Mainnet cards as primary.
- Security app policy Redis: `allowedChains: [114]`.

## References

- https://dev.flare.network/ · Coston2 tools · FCC · FAssets · Smart Accounts · AI skills
- https://docs.layerzero.network/v2/deployments/chains/flare-testnet
- https://github.com/flare-foundation
- Beacon prior: `SUMMER_SIGNAL_FEASIBILITY_REPORT.md`, `history.md`

## Honesty for judges

Ship **real** Coston2 escrow, Safe, x402, FTSO-backed Safe desk. Label FCC as simulated TEE unless hardware is wired. Do not claim SparkDEX Coston2 pools. Do not claim Bound Work is paid from Safe without new contracts.
