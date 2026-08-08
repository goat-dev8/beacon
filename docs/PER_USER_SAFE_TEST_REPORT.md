# Per-user Beacon Safe — Test Report

**Date:** 2026-08-09

## Contract tests (Forge)

`BeaconSafeFactoryTest` — **8/8 passed**

- create isolates Alice/Bob owners + executors
- reject duplicate create
- balances isolated
- policy isolated
- Bob cannot withdraw/set Alice policy
- predictSafe matches create
- allowlists seeded (token + transfer)

## Deployment

- Factory deployed Coston2: `0x9e88ADFB4dA7530675acC520cC9a0a818543c4F2`
- defaultExecutor: `0xBDfCeE82Bd42FEfA58ee850B3709636a8B6b0034`
- Broadcast: `packages/contracts/broadcast/DeploySafeFactory.s.sol/114/run-latest.json`

## Integration coverage (implemented)

| Scenario | Status |
|----------|--------|
| Wallet-scoped `/v1/vault/status` | Implemented |
| Create Safe prepare + UI | Implemented |
| Jobs Safe pay auth + owner check | Implemented |
| Flow vault balance via personal Safe | Implemented |
| Query key isolation on wallet | Implemented |
| Two-wallet browser E2E on production | Pending post-deploy verification |

## Notes

- Legacy shared vault funds were **not** moved.
- New wallets must Create Safe before seeing a personal balance (empty by design).
