# Bound Work Flagship Research (2026-08-08)

## Design read

Bound Work is a **multi-step product UI** (not a marketing landing). Language: Linear/Cursor density on Beacon’s existing dark canvas + signal green accent. Motion restrained; information dense where budgets and rails matter.

## Official Flare rails (cited)

| Primitive | Official role | Beacon usage |
|-----------|---------------|--------------|
| **EIP-3009** | `transferWithAuthorization` for gasless token pulls ([Gasless USD₮0](https://dev.flare.network/network/guides/gasless-usdt0-transfers), [x402](https://dev.flare.network/fxrp/token-interactions/x402-payments)) | Bound Work escrow lock + Safe deposit + Flow x402 |
| **x402** | HTTP 402 + facilitator settle of EIP-3009 auth | Flow paid resources; Bound Work uses **escrow lock** (related, not identical) |
| **Coston2 (114)** | Testnet for demos | Only product chain |
| **FTSO** | Prices | Safe SwapDesk FXRP quotes |
| **LayerZero / OFT** | Cross-chain | Agent FXRP bridge (Flow), not Bound Work |
| **FAssets** | FXRP mint/redeem | Flow FAssets agent, not Bound Work |
| **FCC** | Confidential compute | Simulated TEE story on Safe only |
| **FDC** | Data connector | Not used in Bound Work path |
| **Smart Accounts** | XRPL personal accounts | Not MetaMask AA; not Beacon Safe |

## Verdict: Can Beacon Safe pay Bound Work without MetaMask?

**No — not with current Flare-official EIP-3009 + BeaconEscrow architecture, and not without new contracts.**

### Why (code + docs)

1. **EIP-3009 requires the token holder’s signature.** Official Flare x402/MockUSDT0 path: signer must equal `from` (`transferWithAuthorization`). Docs: [x402 Step 2 EIP-3009](https://dev.flare.network/fxrp/token-interactions/x402-payments#step-2-test-eip-3009-directly).
2. **BeaconEscrow.lockWithAuthorization** pulls MockUSDT0 from `payer` via that authorization — not from BeaconAgentVault balance (`BeaconEscrow.sol`).
3. **Beacon Safe `execute()`** is allowlisted for swap desk `transfer` only (`safeSwap.ts`). Escrow is not an allowed target/selector.
4. Official Flare **Smart Accounts** are XRPL personal accounts — they do not replace MetaMask EIP-3009 for MockUSDT0 escrow.

### Closest production architecture (honest)

| Step | Who | MetaMask? |
|------|-----|-----------|
| Fund Beacon Safe | Owner/funder EIP-3009 deposit | Once |
| Set policy / pause / revoke | Owner | When changing admin |
| Safe swap / agent OFT | Executor key | No |
| Bound Work job lock | Payer EIP-3009 → Escrow | **Once per job** (required today) |
| Escrow release/refund | Settler | No (server) |

**Future (new contracts, not faked):** vault-funded escrow (allowlist `BeaconEscrow` + selector that spends vault balance into lock) or delegated session key. Out of scope until deployed and audited.

## Product implications for this ship

1. Keep one honest MetaMask signature on Bound Work Approve; explain it as EIP-3009 escrow lock.
2. Surface **live Safe + escrow context** on every Bound Work step so the Flare story is visible.
3. Premium Result experience (syntax, copy, download, meta, rails).
4. Video → Coming Soon (no fake gen).
5. Never claim FDC/LayerZero/FAssets on Bound Work unless wired.

## Evidence sources

- Code exploration: Workspace, wallet.ts, BeaconEscrow.sol, BeaconAgentVault.sol, vaultClient.ts, safeSwap.ts
- Flare DevHub MCP: x402 + gasless USDT0 pages
- Prior: `SUMMER_SIGNAL_PRODUCTION_RESEARCH_2026-08-08.md`, `FINAL_FIX_REPORT.md`
