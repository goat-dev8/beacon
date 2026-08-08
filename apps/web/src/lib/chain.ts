export const NETWORK = {
  chainId: 114,
  name: "Flare Testnet Coston2",
  rpc: import.meta.env.VITE_RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc",
  explorer: "https://coston2-explorer.flare.network",
  faucet: "https://faucet.flare.network/coston2",
} as const;

export const CONTRACTS = {
  token: (import.meta.env.VITE_X402_TOKEN_ADDRESS ??
    "0x6fd8a72a972040f3153894BBd0d829a58f1Fe86c") as `0x${string}`,
  escrow: (import.meta.env.VITE_BEACON_ESCROW ??
    "0xE68c22621314977f00c85D89e4f5b10573C51C7E") as `0x${string}`,
  facilitator: (import.meta.env.VITE_X402_FACILITATOR_ADDRESS ??
    "0x1f409a809cE6e8A4467C1fD40943aC40169f4779") as `0x${string}`,
  jobRegistry: (import.meta.env.VITE_BEACON_JOB_REGISTRY ??
    "0x100a3E24909DE25B9CAe75Ba665Be6F893b98889") as `0x${string}`,
  payee: (import.meta.env.VITE_X402_PAYEE_ADDRESS ??
    "0xBDfCeE82Bd42FEfA58ee850B3709636a8B6b0034") as `0x${string}`,
  /** Personal Safe factory — wallet → BeaconAgentVault. */
  safeFactory: (import.meta.env.VITE_BEACON_SAFE_FACTORY_ADDRESS ||
    "0x9e88ADFB4dA7530675acC520cC9a0a818543c4F2") as `0x${string}`,
  /** Legacy shared vault (pre-personal Safes). Prefer factory lookup. */
  agentVault: (import.meta.env.VITE_BEACON_AGENT_VAULT_ADDRESS ||
    "0xc7C6C06Dd59173dBAf8382627d6A483Ca53AAF33") as `0x${string}`,
} as const;
