# Per-user Beacon Safe — Research Report

**Date:** 2026-08-09  
**Network:** Flare Testnet Coston2 (chain ID 114)  
**Status:** Architecture chosen and implemented (factory live)

---

## 1. Current architecture (FACT)

- Beacon Safe = `BeaconAgentVault` (custom policy vault).
- Production previously used **one shared vault** at `0xc7C6C06Dd59173dBAf8382627d6A483Ca53AAF33`.
- Roles: `owner` (policy/withdraw/pause), `executor` (spend within policy), `token` (MockUSDT0).
- Anyone could deposit; only owner controlled policy — balances appeared shared across wallets.
- Escrow / JobRegistry / Facilitator / SwapDesk are **global** and stay global.
- Flare Smart Accounts (`MasterAccountController` / XRPL personal accounts) are a **different** Flare product for XRPL users without FLR — not a drop-in replacement for MetaMask Beacon users.

## 2. Shared-vault problem (FACT)

Connecting wallet B still read the same vault status as wallet A → same balance and policy. UI correctly showed “not owner” for B, but still leaked A’s financial state.

## 3. Security implications (FACT / INFERENCE)

- **FACT:** Commingled deposits into one pool.
- **INFERENCE:** Without wallet→vault binding, Jobs `approve-safe` could spend the shared pool for any caller.
- **DECISION:** Personal vaults + pay-auth signature bind spends to the owning wallet.

## 4. Multi-user requirements (DECISION)

Every connected wallet must resolve to its own Safe balance, policy, pause, session, and job payment path.

## 5. Flare research (FACT)

Sources: Flare DevHub MCP + developer docs:

- Coston2 chain ID **114**, public RPC `https://coston2-api.flare.network/ext/C/rpc`.
- Smart Accounts: XRPL-controlled personal accounts via `MasterAccountController` (same address across Flare networks via registry). Optimized for XRPL→Flare without holding FLR.
- USDT0 / MockUSDT0 + EIP-3009 remain the payment primitive for Beacon x402 and Safe deposits.
- FAssets / FXRP / FTSO / LayerZero continue as Flow/Safe rails; Beacon Safe is **not** an FAssets agent vault.

## 6. Smart Account research (FACT → DECISION)

| Option | Fit for Beacon MetaMask users |
|--------|--------------------------------|
| Flare Smart Accounts | Poor — XRPL ownership model |
| BeaconAgentVault factory | Strong — keeps existing Jobs/Flow executor model |

**DECISION:** Option A — `BeaconSafeFactory` deploys personal `BeaconAgentVault` per wallet.

## 7–9. USDT0 / FAssets / LayerZero (FACT)

No protocol change required for isolation. Personal Safes still hold MockUSDT0; SwapDesk / OFT paths take funds from **that user’s** vault via executor.

## 10. Recommended architecture (DECISION)

```
Wallet ──createSafe()──► BeaconSafeFactory
                              │
                              ▼
                     BeaconAgentVault (owner=wallet, executor=settler)
                              │
              deposit / setPolicy / pause (owner)
              execute (settler) → Escrow / SwapDesk
```

## 11–15. Change surface (DECISION)

- **Contracts:** `BeaconSafeFactory.sol` (+ tests). Vault bytecode unchanged.
- **Backend:** `/v1/vault/status?wallet=`, `createSafe` prepare, Jobs Safe pay requires `ownerWallet` + signed challenge.
- **Database:** No new required tables (registry is on-chain). Optional index later.
- **Frontend:** Wallet-scoped React Query keys; Create Safe UX; no global balance when Safe missing.
- **API:** Never return legacy shared balances when `wallet` is present and factory is configured.

## 16–17. Migration / compatibility (DECISION)

- Legacy shared vault **not auto-migrated**. Funds remain until legacy owner withdraws.
- New users create personal Safes.
- Escrow locks already store `payer = vault address` → refunds still correct per vault.

## 18–19. Security / threat model (DECISION)

- Owner-only policy/withdraw (on-chain).
- Executor-only execute with caps (on-chain).
- Factory seeds token `transfer` allowlist then transfers ownership to user.
- Jobs Safe pay requires `personal_sign` matching `ownerWallet`.
- Cross-user spend attempts fail `NOT_SAFE_OWNER` / auth mismatch.

## 20–22. Test / deploy / rollback

- Forge: `BeaconSafeFactoryTest` (8/8 pass).
- Deployed factory Coston2: `0x9e88ADFB4dA7530675acC520cC9a0a818543c4F2`.
- Rollback: unset `BEACON_SAFE_FACTORY_ADDRESS` to fall back to legacy vault reads (not recommended for multi-user).

## 23. Risks

- Users must create Safe before Safe-pay Jobs.
- Executor gas / C2FLR still required for server-side `execute`.
- EIP-3855 PUSH0 warning on Coston2 with solc ≥0.8.20 (existing Beacon stack already on 0.8.30).

## 24. Open questions (TODO)

- Optional SIWE session layer beyond per-tx payAuth.
- Optional DB cache of `wallet → safe` for analytics.
- Legacy vault UI banner for previous owner withdrawal.
