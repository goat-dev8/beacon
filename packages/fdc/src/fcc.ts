import { Contract, JsonRpcProvider, Wallet, getBytes, toUtf8Bytes } from "ethers";
import { honestyMessage, loadEnv, type BeaconEnv } from "@beacon/shared";

/** Registry instruction fee used by official scaffold tools (wei). */
const INSTRUCTION_FEE_WEI = 1_000_000n;

const SENDER_ABI = [
  "function sendSayHello(bytes _message) payable",
  "function sendEvaluateFit(bytes _payload) payable",
  "function sendAccept(bytes _payload) payable",
  "function getExtensionId() view returns (uint256)",
];

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

  constructor(cfg: FccExtensionConfig) {
    this.cfg = cfg;
    const provider = new JsonRpcProvider(cfg.rpcUrl);
    this.wallet = new Wallet(cfg.privateKey, provider);
    this.sender = new Contract(cfg.instructionSender, SENDER_ABI, this.wallet);
  }

  honesty(): string {
    return honestyMessage(this.cfg.simulatedTee);
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
    return this.sendAndWait("sendEvaluateFit", [toUtf8Bytes(JSON.stringify(payload))]);
  }

  async sendAccept(payload: Record<string, unknown>): Promise<FccInstructionResult> {
    return this.sendAndWait("sendAccept", [toUtf8Bytes(JSON.stringify(payload))]);
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
