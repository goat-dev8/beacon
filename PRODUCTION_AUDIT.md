# Beacon — Production Audit

**Date:** 2026-08-05  
**Network:** Flare Testnet Coston2 (114)  
**Desk:** https://beacon-desk.vercel.app  
**API:** https://beacon-api-97gl.onrender.com  

| Feature | Status | Reason | Evidence |
|---|---|---|---|
| FTSO Signals | **Working** | Live `getFeedsById` | API `/v1/agents/signals`; Flow cards |
| SparkDEX Swap | **Working** | Approve + exactInputSingle + receipts | User screenshots: txs `0x2afe0c62…`, `0xdba481f1…` + explorer |
| Trade desk | **Partial** | FTSO bias + swap invite | Chat path; needs memory |
| Bridge routes | **Partial → shipping** | OFT peers documented | Docs peers: BSC/Sepolia/Hyperliquid |
| x402 micropay | **Partial → shipping** | Rails real; product was generic $0.10 | Facilitator on Coston2 |
| Bound Work escrow | **Working** | EIP-3009 lock → pipeline → release | Desk `/app` e2e history |
| Image small | **Partial → shipping** | Was always Bound Work | Instant quote+x402 path |
| Image/Video large | **Working** | Bound Offer + escrow | Desk services |
| Security Center | **Partial** | Enforce on approve/chat | `/flow/security`; needs wallet persist |
| Smart Accounts | **Honest stub** | XRPL-only official path | Credit prepare memo |
| FCC | **Honest / planned** | Not public prod | `/health` simulatedTee honesty |
| FDC | **Scaffold** | Client only | packages/fdc |
| Wallet session | **Partial → shipping** | Forced reconnect | localStorage + eth_accounts |
| Conversation memory | **Partial → shipping** | Lost on refresh | per-wallet local history |

**Production Ready** only after this pass’s e2e: swap (already), bridge route list, x402 service quote, small-image pay path, wallet restore.
