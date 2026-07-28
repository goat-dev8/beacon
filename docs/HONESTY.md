# Honesty

Beacon claims must match runtime flags.

| Flag | Meaning |
|---|---|
| `SIMULATED_TEE=true` | Confidentiality demonstrated in simulation, **not** hardware-enforced |
| `SIMULATED_TEE=false` + `MODE=0` | Hardware TEE path (requires devops Confidential Space) |

`/health` returns:
```json
{
  "simulatedTee": true,
  "honesty": "Confidentiality is demonstrated in simulation mode, not hardware-enforced."
}
```

Never advertise hardware-sealed TEE while simulated.

Coston2 MockUSDT0 is a test token for EIP-3009 (faucet USDT0 may lack transferWithAuthorization — VALIDATE before mainnet).

AgentRouter 401: generation/judge AI is skipped until auth works; L1/L3 and on-chain escrow still real.
