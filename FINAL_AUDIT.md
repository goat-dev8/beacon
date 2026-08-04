# Beacon Final Audit — Hackathon Win Mode (2026-08-05)

| Feature | Status | Evidence |
|---|---|---|
| Fixed ChatGPT layout | **Working** | `FlowPage` `h-dvh overflow-hidden`; fixed rail + history sidebar + header + composer; messages-only scroll |
| Wallet identity | **Working** | Connect / soft restore; all Flow APIs keyed by `0x` wallet |
| Postgres conversations | **Working** | `002_flow_persistence.sql` + `flowStore.ts` + `/v1/flow/conversations*` |
| Resume on reconnect | **Working** | Auto-load latest conversation when wallet restores |
| Rename / pin / archive / search | **Working** | Sidebar UI + PATCH endpoint |
| Intent auto-detect | **Working** | `detectIntent` keywords from General before agent pills |
| Swap SparkDEX | **Working** | Prior e2e approve+swap + explorer (Coston2) |
| Bridge OFT routes | **Working** | Documented peers BSC/Sepolia/Hyperliquid; plan card with amount |
| Bridge on-chain send | **Partial** | Planner + history; OFT `send` requires funded FXRP + quoteSend — no fake fill |
| Image clarify→quote→x402→generate | **Working** | Brief chips → x402 → `generateProImage` after settle (prior screenshot proof) |
| Research clarify→quote | **Working** | Scope prompts then `$0.75` research brief resource |
| Video | **Partial** | Clarify → Bound Work escrow (honest; no fake instant video) |
| Trade / FTSO | **Working** | Live feeds + narrative bias |
| x402 resources | **Working** | FTSO pack / logo / research — provider, reason, ETA, EIP-3009 |
| Security Center | **Working** | Redis policy, budget receipt, emergency revoke |
| Activity history | **Working** | `flow_activity` on swap/media/payment |
| Demo refresh restore | **Working** | Requires connected wallet + API schema ensure on boot |

## Blocked / honesty

- FCC (confidential compute): not public production — not claimed
- Smart Accounts as MetaMask session keys: not claimed
- Invented bridge fees: blocked by design

## Deploy checklist

1. Push `main` → Vercel desk + Render API
2. Confirm `GET /v1/flow/conversations?wallet=0x…` returns `{ ok: true }`
3. Connect wallet on `/flow` → New chat → message → refresh → history restored
