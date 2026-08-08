# Per-user Beacon Safe — Architecture

## Model

Each MetaMask/Rabby wallet owns exactly one `BeaconAgentVault` created through `BeaconSafeFactory`.

| Role | Who |
|------|-----|
| Owner | Connected wallet (policy, withdraw, pause) |
| Executor | Global Beacon settler (`0xBDfC…0034`) |
| Token | MockUSDT0 on Coston2 |

## Contracts (Coston2)

| Contract | Address |
|----------|---------|
| **BeaconSafeFactory** | `0x9e88ADFB4dA7530675acC520cC9a0a818543c4F2` |
| Legacy shared vault | `0xc7C6C06Dd59173dBAf8382627d6A483Ca53AAF33` (not migrated) |
| Escrow / Registry / Facilitator / SwapDesk | Unchanged (global) |

## Resolution order

1. Explicit `address` override (admin/debug)
2. `factory.safeOf(wallet)` personal Safe
3. Legacy env vault only when no wallet + no factory personal path

When `wallet` is present and factory is configured, API **never** returns another user’s legacy shared balance.

## User flow

Connect → `GET /v1/vault/status?wallet=` → if `SAFE_NOT_CREATED` → `prepare createSafe` → user signs → fund → set policy → Flow / Jobs.

## Jobs Safe pay

Requires `ownerWallet` + `personal_sign` challenge:

```
Beacon Safe pay
job:{id}
offer:{id}
amount:{display}
```

Then `vault.execute(transfer→escrow)` + `lockPrepaid` on **that** vault.

## Env

```
BEACON_SAFE_FACTORY_ADDRESS=0x9e88…
VITE_BEACON_SAFE_FACTORY_ADDRESS=0x9e88…
```

Legacy `BEACON_AGENT_VAULT_ADDRESS` retained for rollback / owner withdrawal only.
