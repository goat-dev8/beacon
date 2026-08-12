import { z } from "zod";

const optionalString = z.string().optional().default("");
const optionalBool = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => {
    if (v === undefined) return false;
    if (typeof v === "boolean") return v;
    return v.toLowerCase() === "true" || v === "1";
  });

const optionalInt = (fallback: number) =>
  z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === "") return fallback;
      const n = typeof v === "number" ? v : Number.parseInt(v, 10);
      return Number.isFinite(n) ? n : fallback;
    });

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_NAME: optionalString,
  APP_URL: z.string().url().default("http://localhost:5173"),
  API_URL: z.string().url().default("http://localhost:3001"),
  API_PORT: optionalInt(3001),
  WEB_PORT: optionalInt(5173),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  SESSION_SECRET: z.string().min(8).default("dev-session-secret"),
  ANALYTICS_SALT: optionalString,
  CHAIN_ID: optionalInt(114),
  NETWORK_NAME: z.string().default("coston2"),

  COSTON2_RPC_URL: z.string().url().default("https://coston2-api.flare.network/ext/C/rpc"),
  COSTON2_WSS_URL: z.string().default("wss://coston2-api.flare.network/ext/C/ws"),
  COSTON2_EXPLORER_URL: optionalString,
  COSTON2_FAUCET_URL: optionalString,
  FLARE_CONTRACT_REGISTRY: optionalString,

  EXPECTED_ASSET_MANAGER_FXRP: optionalString,
  EXPECTED_MASTER_ACCOUNT_CONTROLLER: optionalString,
  EXPECTED_FXRP_TOKEN: optionalString,
  EXPECTED_FDC_HUB: optionalString,
  EXPECTED_FDC_VERIFICATION: optionalString,
  EXPECTED_CORE_VAULT_XRPL: optionalString,
  EXPECTED_OPERATOR_XRPL: optionalString,
  EXPECTED_FIRST_VOTING_ROUND_START_TS: optionalInt(0),
  EXPECTED_VOTING_EPOCH_DURATION_SECONDS: optionalInt(90),

  DEPLOYER_PRIVATE_KEY: optionalString,
  DEPLOYER_ADDRESS: optionalString,
  SETTLER_PRIVATE_KEY: optionalString,
  SETTLER_ADDRESS: optionalString,
  DEPLOYMENT_PRIVATE_KEY: optionalString,
  INITIAL_OWNER: optionalString,
  PROXY_PRIVATE_KEY: optionalString,

  FDC_VERIFIER_XRP_URL: optionalString,
  FDC_VERIFIER_EVM_URL: optionalString,
  FDC_API_KEY: optionalString,
  DA_LAYER_URL: optionalString,
  DA_LAYER_API_URL: optionalString,

  XRPL_NETWORK: z.string().default("testnet"),
  XRPL_WSS_URL: optionalString,
  XRPL_WSS_FALLBACK: optionalString,
  XRPL_JSON_RPC_URL: optionalString,
  XRPL_FAUCET_URL: optionalString,
  XRPL_EXPLORER_URL: optionalString,

  XUMM_API_KEY: optionalString,
  XUMM_API_SECRET: optionalString,
  XUMM_API_ORIGIN: optionalString,
  XUMM_WEBHOOK_URL: optionalString,
  XUMM_ORIGINS: optionalString,

  DATABASE_URL: optionalString,
  DATABASE_URL_DIRECT: optionalString,
  DATABASE_SSL: optionalBool,

  REDIS_URL: optionalString,
  UPSTASH_REDIS_REST_URL: optionalString,
  UPSTASH_REDIS_REST_TOKEN: optionalString,

  SIMULATED_TEE: optionalBool,
  FCC_MODE: optionalString,
  LOCAL_MODE: optionalBool,
  MODE: optionalInt(1),
  TEE_PROXY_URL: optionalString,
  NORMAL_PROXY_URL: optionalString,
  EXT_PROXY_URL: optionalString,
  EXT_PROXY_PORT: optionalInt(6674),
  CHAIN_URL: optionalString,
  LANGUAGE: z.string().default("go"),
  TEE_NODE_VERSION: optionalString,
  EXTENSION_PORT: optionalInt(8080),
  GOVERNANCE_SIGNERS: optionalString,
  GOVERNANCE_THRESHOLD: optionalInt(1),
  EXTENSION_ID: optionalString,
  INSTRUCTION_SENDER: optionalString,
  /** TEE machine address registered on FlareTeeManager (optional probe). */
  TEE_ID: optionalString,
  /** FlareTeeManager diamond (Coston2 default used when unset). */
  FLARE_TEE_MANAGER: optionalString,

  COSTON2_INDEXER_DB_HOST: optionalString,
  COSTON2_INDEXER_DB_PORT: optionalInt(3306),
  COSTON2_INDEXER_DB_NAME: optionalString,
  COSTON2_INDEXER_DB_USERNAME: optionalString,
  COSTON2_INDEXER_DB_PASSWORD: optionalString,

  AI_BASE_URL: optionalString,
  AI_API_KEY: optionalString,
  /** Vercel Edge proxy — bypasses AgentRouter WAF blocks on Render egress (405). */
  AI_PROXY_URL: optionalString,
  AI_PROXY_SECRET: optionalString,
  AI_MODEL_GENERATOR: optionalString,
  AI_MODEL_JUDGE: optionalString,
  AI_MODEL_QUOTE: optionalString,
  AI_MODEL_ACCEPTANCE: optionalString,
  AI_MODEL_PROMPT_ENGINEER: optionalString,
  AI_REQUIRE_REAL: optionalBool,
  OPENAI_BASE_URL: optionalString,
  OPENAI_API_KEY: optionalString,
  ANTHROPIC_BASE_URL: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_AUTH_TOKEN: optionalString,

  OPENMONTAGE_ROOT: optionalString,
  VIDEO_TOOLKIT_ROOT: optionalString,
  REMOTION_ENABLED: optionalBool,

  /** pollinations | agentrouter | comfyui | huggingface | svg | auto */
  IMAGE_PROVIDER: optionalString,
  /** remotion | pollinations-stills | storyboard | comfyui | auto */
  VIDEO_PROVIDER: optionalString,
  POLLINATIONS_IMAGE_BASE: optionalString,
  POLLINATIONS_MODEL: optionalString,
  POLLINATIONS_API_KEY: optionalString,

  COMFYUI_URL: optionalString,
  COMFYUI_API_KEY: optionalString,
  COMFYUI_WORKFLOW_PATH: optionalString,
  COMFYUI_WORKFLOW_JSON: optionalString,

  HF_TOKEN: optionalString,
  HUGGINGFACE_API_KEY: optionalString,
  HF_IMAGE_MODEL: optionalString,
  /** Skip AgentRouter prompt engineering (heuristic prompts) for faster media. */
  MEDIA_FAST: optionalString,

  /** Cloudflare Workers AI (free daily Neurons — FLUX.1-schnell) */
  CF_ACCOUNT_ID: optionalString,
  CF_API_TOKEN: optionalString,
  CLOUDFLARE_API_TOKEN: optionalString,
  CF_IMAGE_MODEL: optionalString,

  /** Fail API boot unless Flare Coston2 rails are present */
  FLARE_REQUIRED: optionalString,

  X402_TOKEN_ADDRESS: optionalString,
  X402_FACILITATOR_ADDRESS: optionalString,
  X402_PAYEE_ADDRESS: optionalString,
  BEACON_JOB_REGISTRY: optionalString,
  BEACON_ESCROW: optionalString,
  BEACON_CREDIT: optionalString,
  /** Optional until BeaconAgentVault is deployed on Coston2. Legacy shared vault only. */
  BEACON_AGENT_VAULT_ADDRESS: optionalString,
  /** Personal Safe factory — wallet → BeaconAgentVault mapping. */
  BEACON_SAFE_FACTORY_ADDRESS: optionalString,
  /** Coston2 USDT0→FXRP desk for Safe executor spends (not SparkDEX; SparkDEX is mainnet). */
  BEACON_SWAP_DESK_ADDRESS: optionalString,

  S3_ENDPOINT: optionalString,
  S3_BUCKET: optionalString,
  S3_ACCESS_KEY: optionalString,
  S3_SECRET_KEY: optionalString,
  S3_REGION: optionalString,

  ENABLE_API: optionalBool,
  ENABLE_FCC: optionalBool,
  ENABLE_FCC_SHADOW: optionalBool,
  ENABLE_FDC: optionalBool,
  ENABLE_PIPELINE: optionalBool,
  ENABLE_SETTLER: optionalBool,
  ENABLE_FUNDING: optionalBool,
  ENABLE_WEB: optionalBool,
  ENABLE_SMART_ACCOUNTS: optionalBool,
  ENABLE_FTSO_GUARD: optionalBool,
});

export type BeaconEnv = z.infer<typeof envSchema>;

let cached: BeaconEnv | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): BeaconEnv {
  if (cached && source === process.env) return cached;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Environment validation failed: ${issues}`);
  }
  if (source === process.env) cached = parsed.data;
  return parsed.data;
}

export function resetEnvCache(): void {
  cached = null;
}

export function requireEnv<K extends keyof BeaconEnv>(
  env: BeaconEnv,
  key: K,
): NonNullable<BeaconEnv[K]> {
  const value = env[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing required environment variable: ${String(key)}`);
  }
  return value as NonNullable<BeaconEnv[K]>;
}

export type FccMode = "simulated" | "unavailable" | "verified";

/**
 * Resolve FCC honesty mode.
 * Explicit FCC_MODE wins; otherwise default to `simulated` when SIMULATED_TEE=true
 * (official Coston2 hackathon path), else `unavailable`.
 */
export function resolveFccMode(
  source: NodeJS.ProcessEnv = process.env,
  simulatedTee?: boolean,
): FccMode {
  const raw = (source.FCC_MODE ?? "").toLowerCase().trim();
  if (raw === "verified") return "verified";
  if (raw === "simulated") return "simulated";
  if (raw === "unavailable") return "unavailable";
  const tee =
    simulatedTee ??
    (typeof source.SIMULATED_TEE === "string"
      ? source.SIMULATED_TEE.toLowerCase() === "true" || source.SIMULATED_TEE === "1"
      : Boolean(source.SIMULATED_TEE));
  return tee ? "simulated" : "unavailable";
}

export function honestyMessage(simulatedTee: boolean, mode?: FccMode): string {
  if (simulatedTee || mode === "simulated") {
    return "FCC path uses SIMULATED_TEE on Coston2 (hackathon-accepted), not hardware-attested Confidential Space. Spend policy and receipts remain server/on-chain enforceable.";
  }
  if (mode === "verified") {
    return "FCC path uses hardware-backed GCP Confidential Space (AMD SEV) on Coston2. Beacon Safe remains the spend boundary; FCC cannot move funds (canMoveFunds: false).";
  }
  return "FCC / confidential compute is unavailable in this deployment. Spend policy and receipts are server and on-chain only.";
}

export type FccProxyProbe = {
  proxyReachable: boolean;
  extensionId?: string;
  endpointTried?: string;
  error?: string;
};

/** Probe EXT_PROXY_URL `/info` (preferred) or `/health` when configured. */
export async function probeExtProxy(
  extProxyUrl: string | undefined | null,
  timeoutMs = 2500,
): Promise<FccProxyProbe> {
  const base = (extProxyUrl ?? "").replace(/\/$/, "");
  if (!base) {
    return { proxyReachable: false, error: "EXT_PROXY_URL not configured" };
  }

  const paths = ["/info", "/health"] as const;
  for (const path of paths) {
    const endpoint = `${base}${path}`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(endpoint, { signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) continue;
      let extensionId: string | undefined;
      try {
        const json = (await response.json()) as Record<string, unknown>;
        const id =
          json.extensionId ??
          (json.machineData as Record<string, unknown> | undefined)?.extensionId ??
          json.id;
        if (id != null && String(id).length > 0) extensionId = String(id);
      } catch {
        /* /health may be non-JSON */
      }
      return { proxyReachable: true, extensionId, endpointTried: endpoint };
    } catch (err) {
      if (path === "/health") {
        return {
          proxyReachable: false,
          endpointTried: endpoint,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  }
  return { proxyReachable: false, error: "EXT_PROXY_URL /info and /health unreachable" };
}
