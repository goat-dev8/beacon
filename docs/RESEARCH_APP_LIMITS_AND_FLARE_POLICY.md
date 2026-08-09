# Research: App Limits, Safe Caps, and Flare Spend Rails

Date: 2026-08-09
Network: Flare Testnet Coston2 (chain 114)

## Incident

Flow showed:

`Per-job limit is 0.1 USDT0; this job is 1.00.`

while the user attempted `Swap 1 MockUSDT0 → FXRP from Beacon Safe`.

This message was correct for the active **server App limits** policy. It was not an on-chain Safe failure and not a MetaMask failure.

## Two separate policy layers

| Layer | Where | What it gates | Default after this fix |
|-------|-------|---------------|------------------------|
| App limits | Redis `security:policy:{wallet}` via `/v1/security/policy` | API spends for Jobs, Safe swap, agent bridge | 10 USDT0 per action / 50 daily |
| On-chain Safe | `BeaconAgentVault` factory seed | `vault.execute` per-tx + rolling budget | 10 MockUSDT0 per tx / 50 rolling (7d) |

App limits sit in front of the executor API. On-chain caps still fail closed even if App limits are raised.

## Root cause

1. Backend `DEFAULT_SECURITY_POLICY` was `daily=5`, `perJob=0.1`.
2. Frontend `DEFAULT_SAFE_POLICY` already showed larger demo values, so Safe UI and API could disagree until a save.
3. Flare Coston2 demos and Smart Account swap guides commonly use **1 USDT0** as the default spend size. A 0.1 per-job app gate blocked the first real Flow swap.

## Flare documentation findings

### x402 / MockUSDT0

Flare’s x402 guide uses MockUSDT0 + EIP-3009 `transferWithAuthorization`. Beacon Jobs/Safe rails stay on MockUSDT0 until FXRP (or faucet USDT0) has matching EIP-3009 support in the official guide.

Source: https://dev.flare.network/fxrp/token-interactions/x402-payments

### Smart Accounts USDT0 → FXRP

Official Coston2 Smart Account guide uses:

- faucet USDT0 `0xC1A5…71F`
- SparkDEX router `0x8a1E…2781`
- `DEFAULT_AMOUNT_IN_UNITS = 1`

Beacon Safe’s Coston2 swap path is different: personal `BeaconAgentVault` + `BeaconCoston2SwapDesk` with FTSO-synced MockUSDT0→FXRP. SparkDEX Mainnet bytecode is not used for Safe auto-spend on Flow.

Source: https://dev.flare.network/smart-accounts/guides/typescript-viem/control-usdt0-ts#swap-usdt0-to-fxrp

### FAssets swap / redeem

Official FAssets swap-redeem paths use routers + AssetManager redemption. They require approvals and are not the Beacon Safe prepaid MockUSDT0 desk.

Source: https://dev.flare.network/fassets/developer-guides/fassets-swap-redeem

### Developer tools / LayerZero

Coston2 tools list RPCs, bridges, and OFTs. LayerZero Flare Testnet deployments matter for Beacon’s FXRP OFT bridge only; they do not remove App limits or Safe caps.

Sources:

- https://dev.flare.network/network/developer-tools?network=coston2
- https://docs.layerzero.network/v2/deployments/chains/flare-testnet

### Product direction (policy-controlled agent spend)

Strong Flare builder signal for agent products: owner-funded vault, agent never holds the key, spend rules (per payment / rolling budget / allowlist) evaluated before settlement. Beacon mirrors that shape with:

- personal factory Safe (owner wallet, executor settler)
- one wallet-bound Agent session for API auth
- App limits + on-chain vault policy as defense in depth

FCC/TEE private policy evaluation remains a future honesty upgrade; current App limits are server-enforced Redis gates and must be labeled that way.

## Fix shipped

1. API defaults → `perJob=10`, `daily=50` (aligned with factory on-chain demo caps).
2. Frontend Safe App limits defaults → same `10` / `50`.
3. Legacy Redis policies exactly matching old `5` / `0.1` (and not emergency-paused) auto-migrate and persist on load.
4. Policy rejection copy names **App limits** and points users to Safe.
5. Flow Safe swap error UI links to `/flow/security` when App limits block a spend.

## Honesty constraints

- App limits are not FCC enclave evaluation.
- Raising App limits does not raise on-chain `maxSpendPerTx`.
- Intentional custom tight policies (for example `0.5`) are not auto-rewritten.
- MockUSDT0 remains the Safe/Jobs payment asset on Coston2.
