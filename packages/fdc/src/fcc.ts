import { Contract, JsonRpcProvider, Wallet, getBytes, toUtf8Bytes, Interface } from "ethers";
import { honestyMessage, loadEnv, type BeaconEnv } from "@beacon/shared";

/** Registry instruction fee used by official scaffold tools (wei). */
const INSTRUCTION_FEE_WEI = 1_000_000n;

const SENDER_ABI = [
  "function sendSayHello(bytes _message) payable",
  "function sendEvaluateFit(bytes _payload) payable",
  "function sendAccept(bytes _payload) payable",
  "function getExtensionId() view returns (uint256)",
];

/** Minimal ABI for interface detection */
const SENDER_DETECT_ABI = [
  "function sendSayHello(bytes) payable",
  "function sendEvaluateFit(bytes) payable",
  "function sendAccept(bytes) payable",
  "function getExtensionId() view returns (uint256)",
];

export interface FccContractCapabilities {
  hasBytecode: boolean;
  hasSendSayHello: boolean;
  hasSendEvaluateFit: boolean;
  hasSendAccept: boolean;
  hasGetExtensionId: boolean;
  extensionId: string | null;
  detectedMethods: string[];
}

export interface FccExtensionConfig {
  rpcUrl: string;
  privateKey: string;
  instructionSender: string;
  extProxyUrl: string;
  simulatedTee: boolean;
  feeWei?: bigint;
}

export interface FccInstructionResult {
  instructionId: string;
  txHash: string;
  status: number;
  data: unknown;
  log?: string;
  honesty: string;
}

export function fccConfigFromEnv(env: BeaconEnv = loadEnv()): FccExtensionConfig {
  const pk = env.DEPLOYMENT_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY;
  if (!pk) throw new Error("DEPLOYMENT_PRIVATE_KEY / DEPLOYER_PRIVATE_KEY required for FCC");
  if (!env.INSTRUCTION_SENDER) throw new Error("INSTRUCTION_SENDER not set");
  if (!env.EXT_PROXY_URL) throw new Error("EXT_PROXY_URL not set");

  return {
    rpcUrl: env.CHAIN_URL || env.COSTON2_RPC_URL,
    privateKey: pk.startsWith("0x") ? pk : `0x${pk}`,
    instructionSender: env.INSTRUCTION_SENDER,
    extProxyUrl: env.EXT_PROXY_URL.replace(/\/$/, ""),
    simulatedTee: env.SIMULATED_TEE,
    feeWei: INSTRUCTION_FEE_WEI,
  };
}

export class FccExtensionClient {
  private readonly wallet: Wallet;
  private readonly sender: Contract;
  private readonly cfg: FccExtensionConfig;
  private readonly provider: JsonRpcProvider;
  private capabilitiesCache: FccContractCapabilities | null = null;

  constructor(cfg: FccExtensionConfig) {
    this.cfg = cfg;
    this.provider = new JsonRpcProvider(cfg.rpcUrl);
    this.wallet = new Wallet(cfg.privateKey, this.provider);
    this.sender = new Contract(cfg.instructionSender, SENDER_ABI, this.wallet);
  }

  honesty(): string {
    return honestyMessage(this.cfg.simulatedTee);
  }

  /**
   * Probe the InstructionSender contract to detect available methods.
   * This helps determine if sendEvaluateFit/sendAccept exist or only sendSayHello.
   */
  async probeContractCapabilities(): Promise<FccContractCapabilities> {
    if (this.capabilitiesCache) return this.capabilitiesCache;

    const result: FccContractCapabilities = {
      hasBytecode: false,
      hasSendSayHello: false,
      hasSendEvaluateFit: false,
      hasSendAccept: false,
      hasGetExtensionId: false,
      extensionId: null,
      detectedMethods: [],
    };

    try {
      const code = await this.provider.getCode(this.cfg.instructionSender);
      result.hasBytecode = code.length > 2;

      if (!result.hasBytecode) {
        this.capabilitiesCache = result;
        return result;
      }

      const iface = new Interface(SENDER_DETECT_ABI);
      const methodSelectors = {
        sendSayHello: iface.getFunction("sendSayHello")?.selector,
        sendEvaluateFit: iface.getFunction("sendEvaluateFit")?.selector,
        sendAccept: iface.getFunction("sendAccept")?.selector,
        getExtensionId: iface.getFunction("getExtensionId")?.selector,
      };

      for (const [name, selector] of Object.entries(methodSelectors)) {
        if (selector && code.includes(selector.slice(2))) {
          result.detectedMethods.push(name);
          if (name === "sendSayHello") result.hasSendSayHello = true;
          if (name === "sendEvaluateFit") result.hasSendEvaluateFit = true;
          if (name === "sendAccept") result.hasSendAccept = true;
          if (name === "getExtensionId") result.hasGetExtensionId = true;
        }
      }

      if (result.hasGetExtensionId) {
        try {
          const extId = await this.sender.getExtensionId();
          result.extensionId = `0x${BigInt(extId).toString(16).padStart(64, "0")}`;
        } catch {
          // Extension ID read failed — contract may revert
        }
      }
    } catch {
      // RPC or ABI error
    }

    this.capabilitiesCache = result;
    return result;
  }

  async proxyInfo(): Promise<unknown> {
    const response = await fetch(`${this.cfg.extProxyUrl}/info`);
    if (!response.ok) throw new Error(`proxy /info failed: ${response.status}`);
    return response.json();
  }

  async sendSayHello(name: string): Promise<FccInstructionResult> {
    return this.sendAndWait("sendSayHello", [toUtf8Bytes(JSON.stringify({ name }))]);
  }

  async sendEvaluateFit(payload: Record<string, unknown>): Promise<FccInstructionResult> {
    const caps = await this.probeContractCapabilities();
    if (!caps.hasSendEvaluateFit) {
      // Fall back to sendSayHello with policy payload for lifecycle smoke
      return this.sendSayHelloWithPolicyPayload(payload);
    }
    return this.sendAndWait("sendEvaluateFit", [toUtf8Bytes(JSON.stringify(payload))]);
  }

  async sendAccept(payload: Record<string, unknown>): Promise<FccInstructionResult> {
    const caps = await this.probeContractCapabilities();
    if (!caps.hasSendAccept) {
      // Fall back to sendSayHello with accept payload for lifecycle smoke
      return this.sendSayHelloWithPolicyPayload({ ...payload, _action: "accept" });
    }
    return this.sendAndWait("sendAccept", [toUtf8Bytes(JSON.stringify(payload))]);
  }

  /**
   * Fallback: use sendSayHello with JSON policy payload when sendEvaluateFit/sendAccept unavailable.
   * Labeled as PARTIAL lifecycle proof.
   */
  private async sendSayHelloWithPolicyPayload(payload: Record<string, unknown>): Promise<FccInstructionResult> {
    const wrappedPayload = {
      _fallback: true,
      _method: "policy_evaluate",
      ...payload,
    };
    const result = await this.sendAndWait("sendSayHello", [toUtf8Bytes(JSON.stringify(wrappedPayload))]);
    return {
      ...result,
      log: `[PARTIAL] Used sendSayHello fallback — sendEvaluateFit/sendAccept not detected on contract. ${result.log ?? ""}`,
      honesty: `${result.honesty} [PARTIAL lifecycle proof via sendSayHello fallback]`,
    };
  }

  private async sendAndWait(method: string, args: unknown[]): Promise<FccInstructionResult> {
    const fee = this.cfg.feeWei ?? INSTRUCTION_FEE_WEI;
    const tx = await this.sender[method](...args, { value: fee, gasLimit: 1_200_000n });
    const receipt = await tx.wait();
    const instructionId = extractInstructionId(receipt);
    if (!instructionId) {
      throw new Error(`No instruction id found in receipt ${receipt?.hash}`);
    }

    const action = await this.pollActionResult(instructionId);
    return {
      instructionId,
      txHash: receipt?.hash ?? tx.hash,
      status: Number(action.result?.status ?? -1),
      data: decodeResultData(action.result?.data),
      log: action.result?.log,
      honesty: this.honesty(),
    };
  }

  async pollActionResult(
    instructionId: string,
    attempts = 20,
    delayMs = 2000,
  ): Promise<{ result?: { status?: number; data?: unknown; log?: string } }> {
    let lastStatus = 0;
    for (let i = 0; i < attempts; i++) {
      const response = await fetch(`${this.cfg.extProxyUrl}/action/result/${instructionId}`);
      lastStatus = response.status;
      if (response.ok) {
        return (await response.json()) as {
          result?: { status?: number; data?: unknown; log?: string };
        };
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
    throw new Error(
      `Timed out waiting for action result ${instructionId} (last HTTP ${lastStatus})`,
    );
  }
}

function decodeResultData(data: unknown): unknown {
  if (data == null) return null;
  if (typeof data === "string") {
    try {
      if (data.startsWith("0x")) {
        return JSON.parse(Buffer.from(getBytes(data)).toString("utf8"));
      }
      return JSON.parse(data);
    } catch {
      return data;
    }
  }
  if (typeof data === "object") {
    try {
      const bytes = Uint8Array.from(data as ArrayLike<number>);
      return JSON.parse(Buffer.from(bytes).toString("utf8"));
    } catch {
      return data;
    }
  }
  return data;
}

/**
 * FlareTeeManager TeeInstructionsSent layout observed on Coston2:
 * topics[1]=extensionId, topics[2]=instructionId, topics[3]=round/aux
 */
function extractInstructionId(receipt: {
  hash?: string;
  logs?: Array<{ address?: string; topics?: readonly string[]; data?: string }>;
} | null): string | null {
  if (!receipt?.logs?.length) return null;

  for (const log of receipt.logs) {
    if (log.topics && log.topics.length >= 3 && log.topics[2]?.length === 66) {
      // Prefer the FlareTeeManager diamond log (4 topics).
      if (log.topics.length >= 4) return log.topics[2];
    }
  }

  for (const log of receipt.logs) {
    if (log.topics && log.topics.length >= 3 && log.topics[2]?.length === 66) {
      return log.topics[2];
    }
  }

  return null;
}

// -----------------------------------------------------------------------------
// FCC Lifecycle Status Helper
// -----------------------------------------------------------------------------

export interface FccLifecycleStatus {
  mode: "verified" | "simulated" | "unavailable";
  instructionSenderConfigured: boolean;
  instructionSenderAddress: string | null;
  instructionSenderHasBytecode: boolean;
  extensionIdConfigured: boolean;
  extensionId: string | null;
  extProxyConfigured: boolean;
  extProxyUrl: string | null;
  teeProxyAvailable: boolean;
  teeProxyUrl: string | null;
  canMoveFunds: false;
  hardwareClaim: false;
  contractCapabilities: FccContractCapabilities | null;
  honesty: string;
  blockers: string[];
  docs: string[];
}

/**
 * Get comprehensive FCC lifecycle status without requiring full FccExtensionClient config.
 * Useful for /v1/fcc/lifecycle endpoint.
 */
export async function getFccLifecycleStatus(env: BeaconEnv = loadEnv()): Promise<FccLifecycleStatus> {
  const blockers: string[] = [];

  const instructionSenderConfigured = Boolean(env.INSTRUCTION_SENDER);
  const extensionIdConfigured = Boolean(env.EXTENSION_ID);
  const extProxyConfigured = Boolean(env.EXT_PROXY_URL);

  let instructionSenderHasBytecode = false;
  let contractCapabilities: FccContractCapabilities | null = null;
  let teeProxyAvailable = false;

  // Check InstructionSender bytecode
  if (instructionSenderConfigured) {
    try {
      const provider = new JsonRpcProvider(env.CHAIN_URL || env.COSTON2_RPC_URL);
      const code = await provider.getCode(env.INSTRUCTION_SENDER!);
      instructionSenderHasBytecode = code.length > 2;

      if (instructionSenderHasBytecode) {
        // Probe capabilities
        const iface = new Interface(SENDER_DETECT_ABI);
        const caps: FccContractCapabilities = {
          hasBytecode: true,
          hasSendSayHello: false,
          hasSendEvaluateFit: false,
          hasSendAccept: false,
          hasGetExtensionId: false,
          extensionId: null,
          detectedMethods: [],
        };

        const methodSelectors = {
          sendSayHello: iface.getFunction("sendSayHello")?.selector,
          sendEvaluateFit: iface.getFunction("sendEvaluateFit")?.selector,
          sendAccept: iface.getFunction("sendAccept")?.selector,
          getExtensionId: iface.getFunction("getExtensionId")?.selector,
        };

        for (const [name, selector] of Object.entries(methodSelectors)) {
          if (selector && code.includes(selector.slice(2))) {
            caps.detectedMethods.push(name);
            if (name === "sendSayHello") caps.hasSendSayHello = true;
            if (name === "sendEvaluateFit") caps.hasSendEvaluateFit = true;
            if (name === "sendAccept") caps.hasSendAccept = true;
            if (name === "getExtensionId") caps.hasGetExtensionId = true;
          }
        }

        if (caps.hasGetExtensionId) {
          try {
            const sender = new Contract(env.INSTRUCTION_SENDER!, SENDER_ABI, provider);
            const extId = await sender.getExtensionId();
            caps.extensionId = `0x${BigInt(extId).toString(16).padStart(64, "0")}`;
          } catch {
            // ignore
          }
        }

        contractCapabilities = caps;
      }
    } catch {
      // RPC error
    }
  }

  // Check TEE proxy availability
  if (env.TEE_PROXY_URL) {
    try {
      const resp = await fetch(`${env.TEE_PROXY_URL}/info`, { method: "GET" });
      teeProxyAvailable = resp.ok;
    } catch {
      // Proxy unreachable
    }
  }

  // Identify blockers
  if (!instructionSenderConfigured) {
    blockers.push("INSTRUCTION_SENDER not configured");
  } else if (!instructionSenderHasBytecode) {
    blockers.push("INSTRUCTION_SENDER has no bytecode on-chain");
  }

  if (!extProxyConfigured) {
    blockers.push("EXT_PROXY_URL not configured — cannot poll instruction results");
  }

  // Determine mode
  let mode: "verified" | "simulated" | "unavailable" = "unavailable";
  if (env.SIMULATED_TEE) {
    mode = "simulated";
  } else if (blockers.length === 0 && instructionSenderHasBytecode && extProxyConfigured) {
    mode = "verified"; // Would be verified if hardware TEE was available
  }

  const honesty = mode === "simulated"
    ? "FCC mode is SIMULATED_TEE — hackathon-accepted for Coston2. NOT hardware-attested Confidential Space. canMoveFunds: false, hardwareClaim: false."
    : mode === "unavailable"
      ? `FCC unavailable: ${blockers.join("; ")}. Shadow authorization fail-closed.`
      : "FCC mode is verified — but Beacon does not verify hardware attestation chain. Do NOT trust as hardware TEE proof.";

  return {
    mode,
    instructionSenderConfigured,
    instructionSenderAddress: env.INSTRUCTION_SENDER ?? null,
    instructionSenderHasBytecode,
    extensionIdConfigured,
    extensionId: env.EXTENSION_ID ?? null,
    extProxyConfigured,
    extProxyUrl: extProxyConfigured ? env.EXT_PROXY_URL! : null,
    teeProxyAvailable,
    teeProxyUrl: env.TEE_PROXY_URL ?? null,
    canMoveFunds: false,
    hardwareClaim: false,
    contractCapabilities,
    honesty,
    blockers,
    docs: [
      "https://dev.flare.network/fcc/overview",
      "https://dev.flare.network/fcc/developer-guides",
    ],
  };
}
