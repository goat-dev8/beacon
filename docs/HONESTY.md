# Honesty

Beacon claims must match runtime flags.

| Flag | Meaning |
|---|---|
| `SIMULATED_TEE=true` + `FCC_MODE=simulated` (default when TEE flag set) | SIMULATED_TEE on Coston2 (hackathon-accepted), **not** hardware-attested Confidential Space |
| `SIMULATED_TEE=false` + `MODE=0` | Hardware TEE path (requires devops Confidential Space; not public yet) |

`/health` and `GET /v1/fcc/status` return `simulatedTee`, `fccMode` / `mode`, and honesty copy.

Never advertise hardware-sealed TEE while simulated.

Coston2 MockUSDT0 is a test token for EIP-3009 (faucet USDT0 may lack transferWithAuthorization — VALIDATE before mainnet).

AgentRouter 401: generation/judge AI is skipped until auth works; L1/L3 and on-chain escrow still real.
