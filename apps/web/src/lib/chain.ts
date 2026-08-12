export const NETWORK = {
  chainId: 114,
  name: "Flare Testnet Coston2",
  rpc: import.meta.env.VITE_RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc",
  explorer: "https://coston2-explorer.flare.network",
  faucet: "https://faucet.flare.network/coston2",
} as const;

export const CONTRACTS = {
  token: (import.meta.env.VITE_X402_TOKEN_ADDRESS ??
    "0xC1A5B41512496B80903D1f32d6dEa3a73212E71F") as `0x${string}`,
  escrow: (import.meta.env.VITE_BEACON_ESCROW ??
    "0x59F9E2471BE3747b00fD53E0Cea828227345399C") as `0x${string}`,
  facilitator: (import.meta.env.VITE_X402_FACILITATOR_ADDRESS ??
    "0x1506f2177769EcB8Fa4903160c896E68f5d15747") as `0x${string}`,
  jobRegistry: (import.meta.env.VITE_BEACON_JOB_REGISTRY ??
    "0x100a3E24909DE25B9CAe75Ba665Be6F893b98889") as `0x${string}`,
  payee: (import.meta.env.VITE_X402_PAYEE_ADDRESS ??
    "0xBDfCeE82Bd42FEfA58ee850B3709636a8B6b0034") as `0x${string}`,
  /** Personal Safe factory — wallet → BeaconAgentVault (official Coston2 USDT0). */
  safeFactory: (import.meta.env.VITE_BEACON_SAFE_FACTORY_ADDRESS ||
    "0x8250e3946fFAD7C3306E7286Cf82131E79038106") as `0x${string}`,
  /** Legacy shared vault (pre-personal Safes). Unused when the factory is configured. */
  agentVault: (import.meta.env.VITE_BEACON_AGENT_VAULT_ADDRESS || "") as `0x${string}`,
} as const;
