# Beacon Architecture Audit — 100% Flare-native

**Date:** 2026-08-08  
**Network:** Flare Testnet Coston2 (chain ID **114**)  
**Product rename:** Bound Work → **Agent Jobs** (nav: Jobs)

This audit records protocol compliance against **official Flare documentation only**. No invented protocols. No forged EIP-3009.

---

## 1. Current architecture

### 1.1 Product surfaces

| Surface | Role |
|--------|------|
| **Flow** | Chat OS: swap, bridge, research, signals, portfolio, risk, yield, FAssets, x402 micropays |
| **Agent Jobs** (`/flow/desk`) | Paid AI generation with escrow + receipt |
| **Safe** (`/flow/security`) | Fund once, set policy, pause/resume; shared balance for agent spends + jobs |

### 1.2 On-chain rails (Coston2)

| Component | Address (current) | Role |
|-----------|-------------------|------|
| MockUSDT0 | `0x6fd8a72a972040f3153894BBd0d829a58f1Fe86c` | EIP-3009 token (official x402 demo pattern) |
| X402Facilitator | `0x1f409a809cE6e8A4467C1fD40943aC40169f4779` | Settles EIP-3009 for Flow x402 |
| BeaconEscrow (prepaid) | `0xE68c22621314977f00c85D89e4f5b10573C51C7E` | Job lock / release / refund |
| BeaconAgentVault | `0xc7C6C06Dd59173dBAf8382627d6A483Ca53AAF33` | Policy Safe (executor spends) |
| Executor / escrow owner / payee | `0xBDfCeE82Bd42FEfA58ee850B3709636a8B6b0034` | Settler key |

### 1.3 Agent Jobs payment paths

**Primary (Beacon Safe — no MetaMask per job):**

```
Fund Safe once (EIP-3009 deposit)
  → Owner sets spending policy
  → POST /v1/jobs/:id/approve-safe
  → vault.execute(token.transfer(escrow, amount))
  → escrow.lockPrepaid(jobId, vault, amount)   // onlyOwner = settler
  → Generate → acceptance
  → releaseToPayee | refund(to vault)
  → Receipt
```

**Fallback (wallet EIP-3009 — official Flare gasless pattern):**

```
User signs TransferWithAuthorization (from = wallet)
  → escrow.lockWithAuthorization(...)
  → Generate → release | refund(to wallet)
```

---

## 2. Protocol compliance review

### 2.1 Why “Safe signs EIP-3009 as the Safe” is impossible

Official EIP-3009 / Flare gasless docs require the signature to recover to the `from` address:

- [EIP-3009: Transfer with Authorization (Flare)](https://dev.flare.network/network/guides/gasless-usdt0-transfers#eip-3009-transfer-with-authorization)
- [x402 Payment Protocol](https://dev.flare.network/fxrp/token-interactions/x402-payments)

`transferWithAuthorization` only succeeds if the EIP-712 signature matches `from`. A contract Safe cannot produce that signature without a private key for the Safe address. Forging a wallet signature while setting `from = Safe` would **violate EIP-3009**.

**Verdict:** Per-job “zero signature forever via forged EIP-3009 from Safe” is **protocol-illegal**. Beacon does **not** implement it.

### 2.2 Closest fully compliant design (shipped)

Use the same **policy vault spend** model as chat Safe swaps:

1. User funds Safe once with real EIP-3009 (or transfer).
2. Executor calls `vault.execute` with allowlisted `transfer(escrow, amount)`.
3. Escrow `lockPrepaid` records the lock against prepaid balance (no signature forgery).
4. Refunds return to `payer = vault`.

This preserves EIP-3009 semantics for funding and for wallet-path jobs, and mirrors official Flare x402 settlement honesty for chat micropays.

---

## 3. Flare compliance review

| Rail | Official meaning | Beacon usage | Status |
|------|------------------|--------------|--------|
| **Coston2** | Testnet chain 114 | All live product rails | Compliant |
| **x402 + EIP-3009** | HTTP 402 + signed auth + facilitator settle | Flow micropays via Facilitator; Safe funding; wallet job fallback | Compliant |
| **MockUSDT0** | Official demo token until FXRP has EIP-3009 | Job + Safe + x402 asset | Compliant ([docs note](https://dev.flare.network/fxrp/token-interactions/x402-payments)) |
| **FAssets / FXRP** | Mint/redeem / swap guides | Flow FAssets + Safe FXRP desk swaps | Compliant (Flow) |
| **LayerZero** | OFT / bridge on Flare testnet | Flow bridge intents | Compliant (Flow) |
| **FTSO** | On-chain prices | Safe swap desk pricing | Compliant (Safe swaps) |
| **FDC** | Data connector | Flow attestation paths only — not claimed on Jobs desk | Honest |
| **FCC** | Confidential compute | `SIMULATED_TEE` / `FCC_MODE=simulated` — not claimed as hardware enclave | Honest |
| **Smart Accounts** | XRPL personal accounts via XRPL memos | Documented as **different product**; MetaMask users use BeaconAgentVault | Correct separation |

Official Smart Accounts overview: [Flare Smart Accounts](https://dev.flare.network/smart-accounts/overview) — XRPL-controlled personal accounts, **not** MetaMask account-abstraction for Bound Work / Agent Jobs.

---

## 4. x402 compliance review

Official flow ([x402 payments](https://dev.flare.network/fxrp/token-interactions/x402-payments#architecture)):

1. Client requests resource → **402** with requirements  
2. Client signs EIP-712 `TransferWithAuthorization`  
3. Server `settlePayment` on Facilitator → `transferWithAuthorization`  
4. Resource + payment receipt  

Beacon Flow chat x402 follows this pattern (Facilitator + MockUSDT0 + Coston2).

Agent Jobs escrow is a **product extension** (lock until acceptance), not a replacement for Facilitator. Wallet path still uses real EIP-3009 into BeaconEscrow. Safe path uses prepaid ERC-20 transfer + `lockPrepaid` (no fake x402 headers).

---

## 5. Smart Accounts review

| Claim | Reality |
|-------|---------|
| “Beacon Safe = Flare Smart Account” | **False** if implying XRPL MasterAccountController personal accounts |
| BeaconAgentVault | Custom policy vault for MetaMask/agent executor on Coston2 |
| Official Smart Accounts | XRPL memo → personal account ([reference](https://dev.flare.network/smart-accounts/reference)) |

**Action taken:** UI and audit docs state Smart Accounts ≠ Beacon Safe. Flow may still surface FAssets/Smart Account educational paths where relevant; Jobs use Beacon Safe.

---

## 6. FCC review

- Live: **simulated TEE** on Coston2 (`SIMULATED_TEE=true`, `FCC_MODE=simulated`).
- Do **not** claim hardware Confidential Space / verified enclave.
- Aligns with Flare Summer Signal showcase honesty (x402 + TEE composition demos).

---

## 7. Safe review

| Control | Behavior |
|---------|----------|
| Balance | Shared MockUSDT0 pool |
| `maxSpendPerTx` | Enforced on `execute` and Safe job lock |
| Rolling window budget | Enforced |
| Session / pause | Blocks spends when paused or session inactive |
| Allowlist | Token target + `transfer(address,uint256)` selector required for job lock |
| Deposit | EIP-3009 / transfer into vault |
| Jobs | Same pool; spender = executor; payer on escrow = vault address |

---

## 8. Security review

| Risk | Mitigation |
|------|------------|
| Forged EIP-3009 | Not used; Safe path is transfer + `lockPrepaid` |
| Double spend escrow | `lockedTotal` + `freeBalance()` gate prepaid locks |
| Unauthorized lock | `lockPrepaid` / release / refund `onlyOwner` (settler) |
| Overspend | Vault policy + API policy `assertPolicyAllows` |
| Wrong escrow | Redeployed prepaid escrow; env `BEACON_ESCROW` / `VITE_BEACON_ESCROW` must match `0xE68c…1C7E` |
| Secrets in git | `.env` never committed; deploy scripts merge env |

---

## 9. UX review

| Change | Why |
|--------|-----|
| Rename **Bound Work → Agent Jobs** | Clearer for judges: paid AI jobs under agent policy |
| Primary CTA **Pay from Beacon Safe** | Matches chat funding model |
| Secondary **Pay with wallet** | Compliant EIP-3009 fallback |
| DeskContextStrip | Live Safe + escrow + Flare rail labels |
| Security footer | Safe funds Agent Jobs (not “escrow is separate”) |
| Settlement timeline | Five-step honest path |

---

## 10. Every change made (this mission)

| Change | Why |
|--------|-----|
| `BeaconEscrow.lockPrepaid` + `lockedTotal` / `freeBalance` | Compliant Safe→escrow without forging EIP-3009 |
| Redeploy escrow `0xE68c…1C7E` (owner = settler) | Old escrow lacked prepaid API |
| `packages/shared/src/safeJobLock.ts` (fresh unused nonce) | Shared Safe spend + lock; matches safeSwap nonce pattern |
| `POST /v1/jobs/:id/approve` `mode=safe` + `approve-safe` | API for Safe-funded jobs |
| Workers settle/refund on `mode=beacon_safe` / `lockTxHash` | Release prepaid locks |
| Workspace primary Safe pay | Product architecture match |
| Nav/copy → Agent Jobs | Product naming |
| Forge tests for `lockPrepaid` | Regression safety |
| This audit + `history.md` | Required deliverable |

---

## 11. Official documentation references

- [x402 Payment Protocol](https://dev.flare.network/fxrp/token-interactions/x402-payments)
- [Gasless USDT0 / EIP-3009](https://dev.flare.network/network/guides/gasless-usdt0-transfers#eip-3009-transfer-with-authorization)
- [Smart Accounts overview](https://dev.flare.network/smart-accounts/overview)
- [Smart Accounts reference](https://dev.flare.network/smart-accounts/reference)
- [Smart Accounts TypeScript/viem](https://dev.flare.network/smart-accounts/guides/typescript-viem)
- [Control USDT0 / swap USDT0→FXRP](https://dev.flare.network/smart-accounts/guides/typescript-viem/control-usdt0-ts#swap-usdt0-to-fxrp)
- [FAssets swap/redeem](https://dev.flare.network/fassets/developer-guides/fassets-swap-redeem)
- [Developer tools Coston2](https://dev.flare.network/network/developer-tools?network=coston2)
- [LayerZero Flare testnet](https://docs.layerzero.network/v2/deployments/chains/flare-testnet)
- [flare-foundation GitHub](https://github.com/flare-foundation)

---

## 12. Remaining protocol limitations

1. **EIP-3009 cannot authorize spends “as” a contract Safe** without the Safe’s key — prepaid transfer is the compliant substitute.
2. **Flare Smart Accounts** are XRPL-native; MetaMask Agent Jobs do not become Smart Accounts by renaming.
3. **FXRP EIP-3009** is not live in the official x402 guide yet — MockUSDT0 remains the documented payment asset.
4. **FCC** remains simulated TEE until a verified enclave deployment is available.
5. **Safe job lock** still requires executor gas (C2FLR) and allowlisted `transfer` — not “zero on-chain forever,” but **zero MetaMask per job** after funding + policy.

---

## 13. Acceptance criteria mapping

| Criterion | Result |
|-----------|--------|
| Safe funds Agent Jobs like chat | Yes (`execute` + `lockPrepaid`) |
| No forged EIP-3009 | Yes |
| Wallet fallback remains | Yes |
| Rename for judges | **Agent Jobs** |
| Audit doc | This file |
| Deploy only when green | Escrow live; env + CI/E2E required before push |
