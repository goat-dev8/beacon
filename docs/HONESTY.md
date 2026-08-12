# Honesty

Beacon claims must match runtime flags and live `/info` evidence.

| Flag | Meaning |
|---|---|
| `SIMULATED_TEE=false` + `FCC_MODE=verified` | Production hardware path. `/v1/fcc/status` reports `hardwareClaim: true` only when ext-proxy `/info` shows `GCP_AMD_SEV`, a measured `codeHash`, FlareTeeManager status 2, and a stable HTTPS proxy. |
| `SIMULATED_TEE=true` + `FCC_MODE=simulated` | Historical Coston2 simulated-attestation path (hackathon-accepted). **Not** hardware Confidential Space. Kept as documented rollback/evidence only. |

`/health` and `GET /v1/fcc/status` return `simulatedTee`, `fccMode` / `mode`, `hardwareClaim` (boolean), and honesty copy.

Never advertise hardware-sealed TEE while `SIMULATED_TEE=true`.

Never set `hardwareClaim: true` by hardcoding `GCP_AMD_SEV` — parse it from the TEE `/info` response.

FCC cannot move funds (`canMoveFunds: false`). Beacon Safe remains the spend boundary.

Coston2 MockUSDT0 is a test token for EIP-3009 (faucet USDT0 may lack transferWithAuthorization — VALIDATE before mainnet).

AgentRouter 401: generation/judge AI is skipped until auth works; L1/L3 and on-chain escrow still real.

Evidence: `docs/evidence/hardware-fcc/STATUS.json`.
