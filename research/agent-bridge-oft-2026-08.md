# Beacon Agent Bridge + Safe research — 2026-08-07

## Why Bridge used MetaMask (and Safe did not)

Beacon Safe (`BeaconAgentVault`) is a **single-token** prepaid pool of **MockUSDT0**.  
LayerZero FXRP OFT `send` requires:

1. **FXRP** approve + lock on OFT Adapter `0xCd3d…`
2. **Native C2FLR** as `msg.value` (messaging fee from live `quoteSend`, often ~20+ C2FLR)

The vault `execute()` only measures MockUSDT0 balance delta and cannot attach native value.  
So MetaMask was correct for the **EOA** path (user’s FXRP + user’s C2FLR).

## Fix: Beacon Agent OFT (no MetaMask)

| Piece | Detail |
| --- | --- |
| Module | `packages/shared/src/agentBridge.ts` |
| API | `POST /v1/agents/bridge/execute` · `GET /v1/agents/bridge/agent-ready` |
| Signer | Same executor as Safe spend (`SETTLER`/`DEPLOYER`) |
| Optional | If executor FXRP low → Safe MockUSDT0→desk FXRP top-up to executor, then OFT |
| UI | **Execute with Beacon Agent** when `mode=beacon_agent` |

### Smoke (real tx)

- **1 FXRP → Sepolia**, executor-signed, no MetaMask  
- Approve `0x727eeccd…` · Send `0xae7fdcaa…`  
- Explorer: https://coston2-explorer.flare.network/tx/0xae7fdcaacb486b8d13c6e0a6f86e46328e1b7542fcfacf87dcc0f8860da84a6b  
- LZ Scan: https://testnet.layerzeroscan.com/tx/0xae7fdcaacb486b8d13c6e0a6f86e46328e1b7542fcfacf87dcc0f8860da84a6b  

## Product split (honest)

| Rail | Asset | Who signs | MetaMask? |
| --- | --- | --- | --- |
| Safe swap desk | MockUSDT0 → FXRP | Executor | No |
| Agent OFT bridge | FXRP + C2FLR fee | Executor | No |
| EOA OFT fallback | User FXRP + C2FLR | User wallet | Yes |

## Docs anchors

- https://dev.flare.network/fxrp/oft/fxrp-automint  
- https://dev.flare.network/fxrp/oft/fxrp-autoredeem#discovering-available-bridge-routes  
- https://docs.layerzero.network/v2/deployments/chains/flare-testnet  
- https://dev.flare.network/network/developer-tools?network=coston2  

Prepaid agent spend pattern (fund pool / policy / agent executes without user re-signing each trade) applied to Swap + Bridge without naming third-party demos in product copy.
