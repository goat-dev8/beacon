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

Coston2 faucet USDT0 (`0xC1A5…E71F`) is the live Beacon payment token (ERC-20, 6 decimals). It has no EIP-3009. Fixture MockUSDT0 is tests-only.

AgentRouter 401: generation/judge AI is skipped until auth works; L1/L3 and on-chain escrow still real.

Live TEE `0x2ebC…6506` (v0.1.3, codeHash `0xb112…9333be`, status 2). Previous `0xA5E9…646d` is paused. Hardware signs ALLOW (status 1) and over-cap DENY (status 0).

Evidence: `docs/evidence/hardware-fcc/STATUS.json` (historical v0.1.2) and `docs/evidence/closure-fcc-hardware-allow.json` / `docs/evidence/closure-fcc-hardware-deny.json` (v0.1.3).
