# Research: Agent Safe Sessions, Job Truth, and Flare Rails

Date: 2026-08-09
Network: Flare Testnet Coston2 (chain 114)

## Decision

Beacon Safe uses two separate authorization layers:

1. **Wallet-bound Agent session (off-chain):** the owner signs one short-lived login challenge. The API returns a 24-hour Bearer session stored for the browser tab. This proves who requested a Job, Safe swap, or agent bridge; it does not move tokens.
2. **BeaconAgentVault policy (on-chain):** the allowlisted executor submits transactions and pays gas. The vault enforces pause, session expiry, target and selector allowlists, per-transaction caps, rolling budget, and replay nonces.

This removes the misleading per-job `personal_sign` prompt without exposing funded Safes through unauthenticated public execution endpoints.

## Why “no signature at all” is unsafe

`BeaconAgentVault.execute` correctly authorizes the configured executor, but a public API still needs to authenticate the user asking that executor to act. Accepting only an `ownerWallet` string lets any caller name somebody else’s funded Safe and repeatedly trigger allowed spends.

The previous Jobs route avoided this with a job-specific signature. Flow Safe swap and agent bridge execution routes did not have equivalent caller authentication. A reusable, wallet-bound session is the safer product model:

- one wallet signature per browser session instead of one per job;
- token custody remains in the contract, not in the session token;
- recipient is forced to equal the authenticated wallet for Safe swaps and agent bridges;
- session expiry is independent from, and weaker than, the vault’s on-chain controls;
- pause, revoke, policy limits, target/selector checks, and contract expiry still fail closed.

## Flare documentation findings

### x402 and EIP-3009

Flare’s x402 guide uses `MockUSDT0`, EIP-712 `TransferWithAuthorization`, and a relayer/facilitator. “Gasless” means the payer signs an off-chain authorization while the server pays transaction gas. It does **not** mean the wallet never signs.

Beacon’s wallet fallback follows that pattern. Beacon Safe is a different prepaid path: the owner signs when funding/unlocking, then the vault executor spends under policy.

Source: https://dev.flare.network/fxrp/token-interactions/x402-payments

### Smart Accounts and custom instructions

Flare Smart Accounts are XRPL-controlled personal accounts. Custom instructions commit to an EIP-4337-style `PackedUserOperation` through an XRPL payment memo; an executor relays the operation to Flare, and nonce/hash checks prevent substitution and replay.

This supports Beacon’s product direction—owner authorization, pinned executor, nonce protection, and recovery—but Beacon Safe remains a separate EVM vault for MetaMask/Reown users. It must not be marketed as Flare Smart Accounts.

Sources:

- https://dev.flare.network/smart-accounts/custom-instruction
- https://github.com/flare-foundation/flare-smart-accounts
- https://github.com/flare-foundation/developer-hub
- https://github.com/flare-foundation/flare-ai-skills

### Flare session-key precedent

The Flare Foundation FCE orderbook includes a locally held session key that is bound once to a Personal Account and then signs scoped off-chain operations. Beacon’s implementation is intentionally simpler: a server-verifiable wallet session authenticates API requests, while the existing vault contract remains the signing and custody boundary.

Source: https://github.com/flare-foundation/fce-orderbook

### FAssets, swaps, and FXRP

The official swap/redeem guides use real deployed routers and AssetManager/FAssets paths. They require token approvals and are separate from Beacon’s MockUSDT0 Safe rail.

Beacon’s Coston2 Safe swap uses `BeaconCoston2SwapDesk`, because the product’s Safe asset is MockUSDT0 and the documented SparkDEX USDT0/FXRP path is not the same token/rail. The desk rate is synchronized from FTSO, and FXRP inventory must be funded.

Sources:

- https://dev.flare.network/fassets/developer-guides/fassets-swap-redeem
- https://dev.flare.network/smart-accounts/guides/typescript-viem/control-usdt0-ts#swap-usdt0-to-fxrp
- https://dev.flare.network/network/developer-tools?network=coston2

### LayerZero

LayerZero’s Flare Testnet deployment is relevant to Beacon’s FXRP OFT bridge only. It does not make Safe spending or Jobs escrow gasless. The executor still needs FXRP and C2FLR for the OFT send and native messaging fee.

Source: https://docs.layerzero.network/v2/deployments/chains/flare-testnet

## Job lifecycle truth audit

- **Escrow locked / Starting pipeline:** `AUTHORIZED` is reached only after the payment lock; `PREPARING` is a short worker transition with no separate tool-provisioning phase.
- **Generating & composing:** real pipeline work. Generation, service-specific composition, and normalization run inside `runPipeline`; the UI now avoids pretending every artifact uses one hard-coded model.
- **Deliverable ready:** `COMPOSING` is a short pass-through after the pipeline returns and before artifacts advance to acceptance; composition work already ran inside the pipeline.
- **Checking quality:** real acceptance execution.
- **L1 objective:** real format, deliverable, duration/schema, and anti-scaffold checks.
- **L3 brand/format:** real deterministic gate.
- **L2 AI judge:** real only when AI is configured and not intentionally skipped. A judge-only rejection becomes `NEEDS_LOOK`; it is not always an automatic refund.
- **Finishing:** the settler calls `releaseToPayee` on pass or `refund` on failure/refusal.
- **Done:** the job closes and an application receipt is persisted.

## Payment timeline truth audit

- **Beacon Safe funded:** real MockUSDT0 balance and policy are read from the wallet’s factory-created vault.
- **`vault.execute(token.transfer)`**: real Coston2 transaction signed by the configured executor.
- **`BeaconEscrow.lockPrepaid`**: real second Coston2 transaction, owner/settler-only.
- **Refund to Safe:** real when the escrow lock’s payer is the vault address.
- **Release to payee:** real `BeaconEscrow.releaseToPayee`.
- **Receipt:** real database record containing acceptance and payment evidence plus transaction hashes.

Important limitations:

- Safe transfer and `lockPrepaid` are currently **two transactions**, not one atomic call. UI/docs must not call them atomic.
- The receipt links on-chain transactions but is not itself an on-chain “sealed receipt.”
- The exact generation model/provider is artifact-specific. Text Jobs prefer `gpt-5.6-sol`; image/video services may use their configured media cascade.
- FCC on the current Coston2 deployment is simulated when reported as `simulated`; it must not be described as verified hardware TEE execution.

## Flow failure diagnosis and remediation

The screenshot showed a connected wallet and live balances, but the generic `insufficient` card always rendered a **Connect** button. The actual swap failure was low desk FXRP inventory, not wallet disconnection.

Fixes:

- connected users no longer see a false Connect action;
- chat waits for wallet restoration before sending, and stale connect cards offer a retry using the live wallet;
- inventory failures explicitly identify desk liquidity and offer Retry;
- Safe quote preparation resolves the connected wallet's factory-created personal Safe rather than the legacy environment vault;
- Safe execution routes require the wallet-bound Agent session;
- Safe swap/bridge recipients must match the authenticated wallet;
- the official Coston2 faucet funded the swap desk with 10 FXRP, raising live inventory from `0.67358` to `10.67358` FXRP.

## Model routing

- Jobs generator/quote: AgentRouter `gpt-5.6-sol` preferred.
- Acceptance/judge: configured Claude model preferred, with explicit fallback behavior.
- `/v1/ai/probe` now probes the unique generator, quote, judge, and acceptance models rather than only the generator.

UI copy must display the actual model returned by the provider or artifact metadata and must label deterministic fallback honestly.
