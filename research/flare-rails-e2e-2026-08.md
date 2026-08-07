# Flare rails deep research → Beacon feature map (2026-08-07)

Sources: Flare DevHub MCP (`docs_search` / `docs_fetch`), [dev.flare.network](https://dev.flare.network), LayerZero Flare testnet deployments, flare-foundation GitHub patterns, Coston2 faucet / developer-tools.

**Honesty rule:** SparkDEX Uniswap V3 USDT0→FXRP guides target **Flare Mainnet** router `0x8a1E…2781` + mainnet USDT0 `0xe7cd…`. Smart-Accounts Coston2 guide lists USDT0 `0xC1A5…E71F` + same router. Beacon live MockUSDT0 is **EIP-3009** `0x6fd8…Fe86c` (no approve/transferFrom). Coston2 Safe spend therefore uses **BeaconCoston2SwapDesk**, not empty SparkDEX bytecode claims.

## Judge-aligned product shape (inspire only; never name peers in product copy)

- Prepaid agent budget under owner policy (per-tx + rolling caps, pause/revoke).
- Agent executor signs spends; user does not MetaMask-confirm every agent action.
- x402 micropay + on-chain receipt for research/intel.
- FTSO / FAssets / OFT as the Flare primitives judges can verify in one demo.

## Rail map

| Beacon chip | Flare primitive | Coston2 truth | Agent path (no MetaMask popup) |
|-------------|-----------------|---------------|--------------------------------|
| **Swap** | FTSO-synced desk / SparkDEX Mainnet | Desk `0x36c1…dF29` Safe MockUSDT0→FXRP | `mode=beacon_safe` vault.execute + desk.fulfill |
| **Bridge** | LayerZero OFT FXRP | OFT adapter + quoteSend native fee | `mode=beacon_agent` executor approve+send |
| **x402** | EIP-3009 + facilitator | MockUSDT0 transferWithAuthorization | Settler / API settle; receipt on explorer |
| **FAssets** | AssetManager redeem / mint docs | FTestXRP / FXRP status honesty | Desk status + documented steps (no fake redeem) |
| **Portfolio** | FTSO mark + balances | Live desk balances | Read-only |
| **Signals** | FTSOv2 feeds | Live snapshot | Read-only |
| **Yield** | Vaults / liquidity honesty | No invented APY | Status + next steps |
| **Research** | x402 paid brief | $0.75 MockUSDT0 path | Pay → brief |
| **Risk** | FTSO + liquidity narrative | Prefer Safe/@swap on Coston2 | Read-only + CTA |
| **Safe** | BeaconAgentVault policy | Caps, pause, deposit EIP-3009 | Owner policy; agent spends pool |

## Key docs anchors

- x402: https://dev.flare.network/fxrp/token-interactions/x402-payments
- USDT0→FXRP SparkDEX: https://dev.flare.network/fxrp/token-interactions/usdt0-fxrp-swap
- Smart Accounts USDT0 control: https://dev.flare.network/smart-accounts/guides/typescript-viem/control-usdt0-ts
- OFT automint / autoredeem: https://dev.flare.network/fxrp/oft/fxrp-automint · https://dev.flare.network/fxrp/oft/fxrp-autoredeem
- LayerZero Flare testnet: https://docs.layerzero.network/v2/deployments/chains/flare-testnet
- Faucet: https://faucet.flare.network/coston2

## Addresses (Beacon Coston2)

| Role | Address |
|------|---------|
| Safe | `0xc7C6C06Dd59173dBAf8382627d6A483Ca53AAF33` |
| Swap desk | `0x36c17ca6Aa2b61b13f7c4B5A59629320a8B4dF29` |
| MockUSDT0 | `0x6fd8a72a972040f3153894BBd0d829a58f1Fe86c` |
| FXRP | `0x0b6A3645c240605887a5532109323A3E12273dc7` |
| OFT adapter | `0xCd3d2127935Ae82Af54Fc31cCD9D3440dbF46639` |
| Executor | `0xBDfCeE82Bd42FEfA58ee850B3709636a8B6b0034` |

## Chat models

AgentRouter (`ANTHROPIC_BASE_URL`): generator `claude-opus-5`, judge/acceptance `claude-opus-4-8`, fallbacks include `gpt-5.6-sol`.
