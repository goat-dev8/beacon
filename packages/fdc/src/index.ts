/**
 * FDC (Flare Data Connector) Client — Official Lifecycle Implementation
 *
 * Implements the complete FDC attestation lifecycle per https://dev.flare.network/fdc/getting-started:
 * 1. prepareRequest via verifier server
 * 2. submit to FdcHub.requestAttestation with fee from FdcRequestFeeConfigurations
 * 3. compute roundId from FlareSystemsManager timing parameters
 * 4. wait for Relay.isFinalized(200, roundId) — protocolId 200 for FDC
 * 5. fetch proof from DA Layer
 * 6. verify on-chain via FdcVerification (optional)
 *
 * Honesty: Never invent abiEncodedRequest or proofs. All data comes from official Flare infrastructure.
 */

import {
  AbiCoder,
  Contract,
  JsonRpcProvider,
  Wallet,
  type TransactionReceipt,
} from "ethers";
import { loadEnv, type BeaconEnv } from "@beacon/shared";

export * from "./fcc.js";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type AttestationKind = "Payment" | "EVMTransaction" | "Web2Json" | "AddressValidity";

export type SourceId =
  | "testETH"
  | "testBTC"
  | "testDOGE"
  | "testXRP"
  | "testFLR"
  | "ETH"
  | "BTC"
  | "DOGE"
  | "XRP"
  | "FLR"
  | "SGB";

export interface FdcClientConfig {
  /** Base verifier URL, e.g. https://fdc-verifiers-testnet.flare.network */
  verifierBaseUrl: string;
  /** API key for verifier (X-API-KEY header) */
  apiKey?: string;
  /** DA Layer base URL, e.g. https://ctn2-data-availability.flare.network */
  daLayerUrl: string;
  /** RPC URL for Flare network (Coston2 or mainnet) */
  rpcUrl: string;
  /** Private key for submitting attestation requests (optional for read-only ops) */
  privateKey?: string;
  /** Contract Registry address (canonical: 0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019) */
  contractRegistry?: string;
  /** Expected FdcHub address for validation (optional) */
  expectedFdcHub?: string;
  /** Expected FdcVerification address for validation (optional) */
  expectedFdcVerification?: string;
  /** Expected first voting round start timestamp (from FlareSystemsManager or env) */
  firstVotingRoundStartTs?: number;
  /** Expected voting epoch duration in seconds (from FlareSystemsManager or env, default 90) */
  votingEpochDurationSeconds?: number;
}

export interface PrepareResult {
  ok: boolean;
  status: "VALID" | "INVALID" | "ERROR";
  abiEncodedRequest?: string;
  error?: string;
  raw?: unknown;
}

export interface SubmitResult {
  ok: boolean;
  txHash?: string;
  roundId?: number;
  blockNumber?: number;
  blockTimestamp?: number;
  explorerUrl?: string;
  error?: string;
}

export interface WaitFinalizedResult {
  ok: boolean;
  finalized: boolean;
  roundId: number;
  elapsedMs?: number;
  error?: string;
}

/** IAddressValidity.RequestBody */
export interface AddressValidityResponseRequestBody {
  addressStr: string;
}

/** IAddressValidity.ResponseBody */
export interface AddressValidityResponseBody {
  isValid: boolean;
  standardAddress: string;
  standardAddressHash: string;
}

/** IAddressValidity.Response — matches on-chain / DA response_hex ABI */
export interface AddressValidityResponse {
  attestationType: string;
  sourceId: string;
  votingRound: bigint | number;
  lowestUsedTimestamp: bigint | number;
  requestBody: AddressValidityResponseRequestBody;
  responseBody: AddressValidityResponseBody;
}

/** IAddressValidity.Proof — argument to FdcVerification.verifyAddressValidity */
export interface AddressValidityProof {
  merkleProof: string[];
  data: AddressValidityResponse;
}

export interface FetchProofResult {
  ok: boolean;
  proof?: string[];
  responseHex?: string;
  /** Decoded Response when available (from response_hex or structured DA payload) */
  response?: AddressValidityResponse;
  attestationType?: string;
  status: "AVAILABLE" | "NOT_AVAILABLE" | "ERROR";
  urlTried?: string;
  error?: string;
  raw?: unknown;
}

export interface VerifyAddressValidityResult {
  ok: boolean;
  verified: boolean;
  fdcVerificationAddress?: string;
  /** VIEW staticCall — no broadcast tx; still REAL on-chain evidence */
  callKind: "staticCall";
  error?: string;
  responseBody?: AddressValidityResponseBody;
}

export interface FullAttestationResult {
  ok: boolean;
  stage: "prepare" | "submit" | "wait" | "proof" | "verify" | "complete";
  abiEncodedRequest?: string;
  txHash?: string;
  roundId?: number;
  proof?: string[];
  responseHex?: string;
  response?: AddressValidityResponse;
  explorerUrl?: string;
  onChainVerified?: boolean;
  fdcVerificationAddress?: string;
  /** Honesty label: VERIFIED only when FdcVerification.verifyAddressValidity returned true */
  honesty?: "REAL" | "VERIFIED" | "PARTIAL" | "ERROR";
  error?: string;
  timings?: {
    prepareMs: number;
    submitMs: number;
    waitMs: number;
    proofMs: number;
    verifyMs?: number;
    totalMs: number;
  };
}

// Legacy types for backward compatibility
export interface PrepareRequest {
  kind: AttestationKind;
  source: "xrp" | "evm";
  payload: Record<string, unknown>;
}

export interface PrepareResponse {
  requestId: string;
  status: "prepared" | "error";
  message?: string;
  raw?: unknown;
}

export interface SubmitResponse {
  requestId: string;
  status: "submitted" | "error";
  message?: string;
  raw?: unknown;
}

// -----------------------------------------------------------------------------
// Contract ABIs (minimal required interfaces)
// -----------------------------------------------------------------------------

const CONTRACT_REGISTRY_ABI = [
  "function getContractAddressByName(string name) view returns (address)",
];

const FDC_HUB_ABI = [
  "function requestAttestation(bytes calldata _data) external payable returns (bool)",
];

const FDC_REQUEST_FEE_CONFIGURATIONS_ABI = [
  "function getRequestFee(bytes calldata _data) view returns (uint256)",
];

const FLARE_SYSTEMS_MANAGER_ABI = [
  "function firstVotingRoundStartTs() view returns (uint64)",
  "function votingEpochDurationSeconds() view returns (uint64)",
  "function getCurrentVotingEpochId() view returns (uint32)",
];

const RELAY_ABI = ["function isFinalized(uint256 _protocolId, uint256 _votingRoundId) view returns (bool)"];

/**
 * FdcVerification + IAddressValidity.Proof ABI.
 * verifyAddressValidity is a VIEW function — staticCall is sufficient for VERIFIED evidence.
 */
const FDC_VERIFICATION_ABI = [
  {
    type: "function",
    name: "verifyAddressValidity",
    stateMutability: "view",
    inputs: [
      {
        name: "_proof",
        type: "tuple",
        components: [
          { name: "merkleProof", type: "bytes32[]" },
          {
            name: "data",
            type: "tuple",
            components: [
              { name: "attestationType", type: "bytes32" },
              { name: "sourceId", type: "bytes32" },
              { name: "votingRound", type: "uint64" },
              { name: "lowestUsedTimestamp", type: "uint64" },
              {
                name: "requestBody",
                type: "tuple",
                components: [{ name: "addressStr", type: "string" }],
              },
              {
                name: "responseBody",
                type: "tuple",
                components: [
                  { name: "isValid", type: "bool" },
                  { name: "standardAddress", type: "string" },
                  { name: "standardAddressHash", type: "bytes32" },
                ],
              },
            ],
          },
        ],
      },
    ],
    outputs: [{ name: "_proved", type: "bool" }],
  },
  "function fdcProtocolId() view returns (uint8)",
] as const;

/** ABI type string for IAddressValidity.Response (DA response_hex) */
const ADDRESS_VALIDITY_RESPONSE_ABI =
  "tuple(bytes32 attestationType, bytes32 sourceId, uint64 votingRound, uint64 lowestUsedTimestamp, tuple(string addressStr) requestBody, tuple(bool isValid, string standardAddress, bytes32 standardAddressHash) responseBody)";

// Canonical ContractRegistry address on all Flare networks
const CONTRACT_REGISTRY_ADDRESS = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";

/** Known Coston2 FdcVerification (also resolved via ContractRegistry) */
export const COSTON2_FDC_VERIFICATION = "0x906507E0B64bcD494Db73bd0459d1C667e14B933";

// FDC Protocol ID for Relay.isFinalized
const FDC_PROTOCOL_ID = 200;

// Default fee if getRequestFee fails (1 FLR in wei)
const DEFAULT_FEE_WEI = 1_000_000_000_000_000_000n;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Converts a string to 32-byte hex (right-padded with zeros).
 * Used for encoding attestationType and sourceId per FDC spec.
 */
export function toBytes32String(s: string): string {
  let hex = "";
  for (let i = 0; i < s.length; i++) {
    hex += s.charCodeAt(i).toString(16);
  }
  return "0x" + hex.padEnd(64, "0");
}

/**
 * Decodes ABI-encoded IAddressValidity.Response from DA `response_hex`.
 */
export function decodeAddressValidityResponseHex(responseHex: string): AddressValidityResponse {
  const hex = responseHex.startsWith("0x") ? responseHex : `0x${responseHex}`;
  const decoded = AbiCoder.defaultAbiCoder().decode([ADDRESS_VALIDITY_RESPONSE_ABI], hex);
  const row = decoded[0] as {
    attestationType: string;
    sourceId: string;
    votingRound: bigint;
    lowestUsedTimestamp: bigint;
    requestBody: { addressStr: string };
    responseBody: { isValid: boolean; standardAddress: string; standardAddressHash: string };
  };
  return {
    attestationType: row.attestationType,
    sourceId: row.sourceId,
    votingRound: row.votingRound,
    lowestUsedTimestamp: row.lowestUsedTimestamp,
    requestBody: { addressStr: row.requestBody.addressStr },
    responseBody: {
      isValid: Boolean(row.responseBody.isValid),
      standardAddress: row.responseBody.standardAddress,
      standardAddressHash: row.responseBody.standardAddressHash,
    },
  };
}

/**
 * Builds AddressValidityResponse from a structured DA `response` object.
 */
export function parseStructuredAddressValidityResponse(
  response: Record<string, unknown>,
): AddressValidityResponse {
  const requestBody = (response.requestBody ?? {}) as Record<string, unknown>;
  const responseBody = (response.responseBody ?? {}) as Record<string, unknown>;
  return {
    attestationType: String(response.attestationType ?? ""),
    sourceId: String(response.sourceId ?? ""),
    votingRound: BigInt(String(response.votingRound ?? 0)),
    lowestUsedTimestamp: BigInt(String(response.lowestUsedTimestamp ?? 0)),
    requestBody: {
      addressStr: String(requestBody.addressStr ?? ""),
    },
    responseBody: {
      isValid: Boolean(responseBody.isValid),
      standardAddress: String(responseBody.standardAddress ?? ""),
      standardAddressHash: String(
        responseBody.standardAddressHash ??
          "0x0000000000000000000000000000000000000000000000000000000000000000",
      ),
    },
  };
}

/**
 * Resolves a typed IAddressValidity.Proof from DA fetch fields.
 * Prefers `response_hex` ABI decode; falls back to structured `response`.
 */
export function buildAddressValidityProof(params: {
  merkleProof: string[];
  responseHex?: string;
  response?: AddressValidityResponse | Record<string, unknown>;
}): AddressValidityProof {
  let data: AddressValidityResponse | undefined;

  if (params.responseHex && params.responseHex.startsWith("0x") && params.responseHex.length > 10) {
    // JSON-stringified structured payloads are not ABI hex — skip decode for those.
    const looksLikeAbiHex = /^0x[0-9a-fA-F]+$/.test(params.responseHex) && params.responseHex.length >= 64;
    if (looksLikeAbiHex) {
      try {
        data = decodeAddressValidityResponseHex(params.responseHex);
      } catch {
        data = undefined;
      }
    }
  }

  if (!data && params.response) {
    if (
      typeof params.response === "object" &&
      "attestationType" in params.response &&
      "responseBody" in params.response &&
      "requestBody" in params.response
    ) {
      const r = params.response as AddressValidityResponse;
      if (typeof r.responseBody?.isValid === "boolean" && typeof r.requestBody?.addressStr === "string") {
        data = {
          attestationType: String(r.attestationType),
          sourceId: String(r.sourceId),
          votingRound: typeof r.votingRound === "bigint" ? r.votingRound : BigInt(r.votingRound),
          lowestUsedTimestamp:
            typeof r.lowestUsedTimestamp === "bigint"
              ? r.lowestUsedTimestamp
              : BigInt(r.lowestUsedTimestamp),
          requestBody: { addressStr: r.requestBody.addressStr },
          responseBody: {
            isValid: Boolean(r.responseBody.isValid),
            standardAddress: r.responseBody.standardAddress,
            standardAddressHash: r.responseBody.standardAddressHash,
          },
        };
      } else {
        data = parseStructuredAddressValidityResponse(params.response as Record<string, unknown>);
      }
    } else {
      data = parseStructuredAddressValidityResponse(params.response as Record<string, unknown>);
    }
  }

  if (!data) {
    throw new Error("Cannot build AddressValidity Proof — missing decodable response_hex or structured response");
  }

  return {
    merkleProof: params.merkleProof ?? [],
    data,
  };
}

/**
 * Maps chain identifiers to verifier path segments.
 */
function getVerifierChain(sourceId: SourceId): string {
  const map: Record<SourceId, string> = {
    testETH: "eth",
    testBTC: "btc_testnet4",
    testDOGE: "doge",
    testXRP: "xrp",
    testFLR: "flr",
    ETH: "eth",
    BTC: "btc",
    DOGE: "doge",
    XRP: "xrp",
    FLR: "flr",
    SGB: "sgb",
  };
  return map[sourceId] ?? sourceId.toLowerCase().replace("test", "");
}

/**
 * Normalizes verifier base URL to consistent format.
 */
function normalizeVerifierUrl(url: string): string {
  let normalized = url.replace(/\/$/, "");
  // Strip trailing /verifier or /verifier/ if present
  normalized = normalized.replace(/\/verifier\/?$/, "");
  return normalized;
}

/**
 * Normalizes DA layer URL.
 */
function normalizeDaLayerUrl(url: string): string {
  return url.replace(/\/$/, "").replace(/\/api\/v[01]\/?$/, "");
}

// -----------------------------------------------------------------------------
// Request Preparation Helpers
// -----------------------------------------------------------------------------

export interface AddressValidityRequestBody {
  addressStr: string;
}

export interface EvmTransactionRequestBody {
  transactionHash: string;
  requiredConfirmations?: string;
  provideInput?: boolean;
  listEvents?: boolean;
  logIndices?: number[];
}

export interface PaymentRequestBody {
  transactionId: string;
  inUtxo?: string;
  utxo?: string;
}

export interface Web2JsonRequestBody {
  url: string;
  postprocessJq?: string;
  abi_signature?: string;
}

/**
 * Prepares request body for AddressValidity attestation.
 */
export function prepareAddressValidityRequest(params: {
  addressStr: string;
  sourceId?: "testXRP" | "testBTC" | "testDOGE" | "XRP" | "BTC" | "DOGE";
}): { attestationType: string; sourceId: string; requestBody: AddressValidityRequestBody } {
  const sourceId = params.sourceId ?? "testXRP";
  return {
    attestationType: toBytes32String("AddressValidity"),
    sourceId: toBytes32String(sourceId),
    requestBody: {
      addressStr: params.addressStr,
    },
  };
}

/**
 * Prepares request body for EVMTransaction attestation.
 */
export function prepareEvmTransactionRequest(params: {
  txHash: string;
  sourceId?: "testETH" | "testFLR" | "ETH" | "FLR" | "SGB";
  requiredConfirmations?: string;
  provideInput?: boolean;
  listEvents?: boolean;
  logIndices?: number[];
}): { attestationType: string; sourceId: string; requestBody: EvmTransactionRequestBody } {
  const sourceId = params.sourceId ?? "testETH";
  return {
    attestationType: toBytes32String("EVMTransaction"),
    sourceId: toBytes32String(sourceId),
    requestBody: {
      transactionHash: params.txHash,
      requiredConfirmations: params.requiredConfirmations ?? "1",
      provideInput: params.provideInput ?? true,
      listEvents: params.listEvents ?? true,
      logIndices: params.logIndices ?? [],
    },
  };
}

/**
 * Prepares request body for Payment attestation (XRP, BTC, DOGE).
 */
export function preparePaymentRequest(params: {
  transactionId: string;
  sourceId?: "testXRP" | "testBTC" | "testDOGE" | "XRP" | "BTC" | "DOGE";
  inUtxo?: string;
  utxo?: string;
}): { attestationType: string; sourceId: string; requestBody: PaymentRequestBody } {
  const sourceId = params.sourceId ?? "testXRP";
  return {
    attestationType: toBytes32String("Payment"),
    sourceId: toBytes32String(sourceId),
    requestBody: {
      transactionId: params.transactionId,
      inUtxo: params.inUtxo ?? "0",
      utxo: params.utxo ?? "0",
    },
  };
}

/**
 * Prepares request body for Web2Json attestation (PublicWeb2 verified).
 * Note: Web2Json is more complex and may require specific JQ postprocessing.
 */
export function prepareWeb2JsonRequest(params: {
  url: string;
  postprocessJq?: string;
  abiSignature?: string;
}): { attestationType: string; sourceId: string; requestBody: Web2JsonRequestBody } {
  return {
    attestationType: toBytes32String("Web2Json"),
    sourceId: toBytes32String("PublicWeb2"),
    requestBody: {
      url: params.url,
      postprocessJq: params.postprocessJq ?? ".",
      abi_signature: params.abiSignature,
    },
  };
}

// -----------------------------------------------------------------------------
// FDC Client
// -----------------------------------------------------------------------------

export class FdcClient {
  private readonly cfg: FdcClientConfig;
  private provider: JsonRpcProvider | null = null;
  private wallet: Wallet | null = null;

  // Cached contract addresses (resolved from ContractRegistry)
  private contracts: {
    fdcHub?: string;
    fdcVerification?: string;
    fdcRequestFeeConfigurations?: string;
    relay?: string;
    flareSystemsManager?: string;
  } = {};

  // Cached timing parameters
  private timingParams: {
    firstVotingRoundStartTs?: number;
    votingEpochDurationSeconds?: number;
  } = {};

  constructor(cfg: FdcClientConfig) {
    this.cfg = {
      ...cfg,
      verifierBaseUrl: normalizeVerifierUrl(cfg.verifierBaseUrl),
      daLayerUrl: normalizeDaLayerUrl(cfg.daLayerUrl),
      contractRegistry: cfg.contractRegistry ?? CONTRACT_REGISTRY_ADDRESS,
    };
  }

  private getProvider(): JsonRpcProvider {
    if (!this.provider) {
      this.provider = new JsonRpcProvider(this.cfg.rpcUrl);
    }
    return this.provider;
  }

  private getWallet(): Wallet {
    if (!this.wallet) {
      if (!this.cfg.privateKey) {
        throw new Error("Private key required for on-chain operations");
      }
      const pk = this.cfg.privateKey.startsWith("0x") ? this.cfg.privateKey : `0x${this.cfg.privateKey}`;
      this.wallet = new Wallet(pk, this.getProvider());
    }
    return this.wallet;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.cfg.apiKey) {
      h["X-API-KEY"] = this.cfg.apiKey;
      h["X-apikey"] = this.cfg.apiKey; // Some endpoints accept lowercase
    }
    return h;
  }

  /**
   * Resolves contract address from ContractRegistry by name.
   */
  async resolveContract(name: string): Promise<string> {
    const provider = this.getProvider();
    const registry = new Contract(this.cfg.contractRegistry!, CONTRACT_REGISTRY_ABI, provider);
    const address = (await registry.getContractAddressByName(name)) as string;
    if (!address || address === "0x0000000000000000000000000000000000000000") {
      throw new Error(`Contract ${name} not found in registry`);
    }
    return address;
  }

  /**
   * Gets FdcHub contract address (cached).
   */
  async getFdcHub(): Promise<string> {
    if (!this.contracts.fdcHub) {
      this.contracts.fdcHub = await this.resolveContract("FdcHub");
      if (this.cfg.expectedFdcHub && this.contracts.fdcHub.toLowerCase() !== this.cfg.expectedFdcHub.toLowerCase()) {
        console.warn(
          `FdcHub address mismatch: expected ${this.cfg.expectedFdcHub}, got ${this.contracts.fdcHub}`,
        );
      }
    }
    return this.contracts.fdcHub;
  }

  /**
   * Gets FdcVerification contract address (cached).
   */
  async getFdcVerification(): Promise<string> {
    if (!this.contracts.fdcVerification) {
      this.contracts.fdcVerification = await this.resolveContract("FdcVerification");
      if (
        this.cfg.expectedFdcVerification &&
        this.contracts.fdcVerification.toLowerCase() !== this.cfg.expectedFdcVerification.toLowerCase()
      ) {
        console.warn(
          `FdcVerification address mismatch: expected ${this.cfg.expectedFdcVerification}, got ${this.contracts.fdcVerification}`,
        );
      }
    }
    return this.contracts.fdcVerification;
  }

  /**
   * Gets FdcRequestFeeConfigurations contract address (cached).
   */
  async getFdcRequestFeeConfigurations(): Promise<string> {
    if (!this.contracts.fdcRequestFeeConfigurations) {
      this.contracts.fdcRequestFeeConfigurations = await this.resolveContract("FdcRequestFeeConfigurations");
    }
    return this.contracts.fdcRequestFeeConfigurations;
  }

  /**
   * Gets Relay contract address (cached).
   */
  async getRelay(): Promise<string> {
    if (!this.contracts.relay) {
      this.contracts.relay = await this.resolveContract("Relay");
    }
    return this.contracts.relay;
  }

  /**
   * Gets FlareSystemsManager contract address (cached).
   */
  async getFlareSystemsManager(): Promise<string> {
    if (!this.contracts.flareSystemsManager) {
      this.contracts.flareSystemsManager = await this.resolveContract("FlareSystemsManager");
    }
    return this.contracts.flareSystemsManager;
  }

  /**
   * Gets voting round timing parameters from FlareSystemsManager.
   */
  async getTimingParams(): Promise<{ firstVotingRoundStartTs: number; votingEpochDurationSeconds: number }> {
    if (this.timingParams.firstVotingRoundStartTs && this.timingParams.votingEpochDurationSeconds) {
      return this.timingParams as { firstVotingRoundStartTs: number; votingEpochDurationSeconds: number };
    }

    // Use config values if provided
    if (this.cfg.firstVotingRoundStartTs && this.cfg.votingEpochDurationSeconds) {
      this.timingParams = {
        firstVotingRoundStartTs: this.cfg.firstVotingRoundStartTs,
        votingEpochDurationSeconds: this.cfg.votingEpochDurationSeconds,
      };
      return this.timingParams as { firstVotingRoundStartTs: number; votingEpochDurationSeconds: number };
    }

    // Fetch from FlareSystemsManager
    const provider = this.getProvider();
    const managerAddress = await this.getFlareSystemsManager();
    const manager = new Contract(managerAddress, FLARE_SYSTEMS_MANAGER_ABI, provider);

    const [firstTs, epochDuration] = await Promise.all([
      manager.firstVotingRoundStartTs() as Promise<bigint>,
      manager.votingEpochDurationSeconds() as Promise<bigint>,
    ]);

    this.timingParams = {
      firstVotingRoundStartTs: Number(firstTs),
      votingEpochDurationSeconds: Number(epochDuration),
    };

    return this.timingParams as { firstVotingRoundStartTs: number; votingEpochDurationSeconds: number };
  }

  /**
   * Computes the voting round ID from a block timestamp.
   */
  async computeRoundId(blockTimestamp: number): Promise<number> {
    const { firstVotingRoundStartTs, votingEpochDurationSeconds } = await this.getTimingParams();
    return Math.floor((blockTimestamp - firstVotingRoundStartTs) / votingEpochDurationSeconds);
  }

  /**
   * Gets the current voting round ID.
   */
  async getCurrentRoundId(): Promise<number> {
    const provider = this.getProvider();
    const managerAddress = await this.getFlareSystemsManager();
    const manager = new Contract(managerAddress, FLARE_SYSTEMS_MANAGER_ABI, provider);
    return Number(await manager.getCurrentVotingEpochId());
  }

  /**
   * Gets the request fee for an attestation request.
   */
  async getRequestFee(abiEncodedRequest: string): Promise<bigint> {
    try {
      const provider = this.getProvider();
      const feeConfigAddress = await this.getFdcRequestFeeConfigurations();
      const feeConfig = new Contract(feeConfigAddress, FDC_REQUEST_FEE_CONFIGURATIONS_ABI, provider);
      return (await feeConfig.getRequestFee(abiEncodedRequest)) as bigint;
    } catch (err) {
      console.warn(`getRequestFee failed, using default: ${err}`);
      return DEFAULT_FEE_WEI;
    }
  }

  // ---------------------------------------------------------------------------
  // Step 1: Prepare Attestation Request
  // ---------------------------------------------------------------------------

  /**
   * Prepares an attestation request via the verifier server.
   *
   * @param attestationType - Type name (e.g., "AddressValidity", "EVMTransaction")
   * @param sourceId - Source chain identifier (e.g., "testXRP", "testETH")
   * @param requestBody - Attestation-type-specific request body
   * @returns PrepareResult with abiEncodedRequest if successful
   */
  async prepareRequest(
    attestationType: string,
    sourceId: SourceId,
    requestBody: Record<string, unknown>,
  ): Promise<PrepareResult> {
    // Determine verifier chain path
    const chain = getVerifierChain(sourceId);

    // Build URL: ${base}/verifier/{chain}/{attestationType}/prepareRequest
    const url = `${this.cfg.verifierBaseUrl}/verifier/${chain}/${attestationType}/prepareRequest`;

    // Build request body per FDC spec
    const body = {
      attestationType: attestationType.startsWith("0x") ? attestationType : toBytes32String(attestationType),
      sourceId: sourceId.startsWith("0x") ? sourceId : toBytes32String(sourceId),
      requestBody,
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
      });

      const raw = await safeJson(response);

      if (!response.ok) {
        return {
          ok: false,
          status: "ERROR",
          error: `Verifier returned ${response.status}: ${response.statusText}`,
          raw,
        };
      }

      // Check response structure
      const data = raw as Record<string, unknown>;
      const status = data.status as string | undefined;

      if (status !== "VALID") {
        return {
          ok: false,
          status: "INVALID",
          error: `Verifier returned status: ${status ?? "unknown"}`,
          raw,
        };
      }

      const abiEncodedRequest = data.abiEncodedRequest as string | undefined;
      if (!abiEncodedRequest || !abiEncodedRequest.startsWith("0x")) {
        return {
          ok: false,
          status: "ERROR",
          error: "Verifier response missing abiEncodedRequest",
          raw,
        };
      }

      return {
        ok: true,
        status: "VALID",
        abiEncodedRequest,
        raw,
      };
    } catch (err) {
      return {
        ok: false,
        status: "ERROR",
        error: `Prepare request failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Step 2: Submit Attestation Request to FdcHub
  // ---------------------------------------------------------------------------

  /**
   * Submits an attestation request to FdcHub.requestAttestation.
   *
   * @param abiEncodedRequest - The encoded request from prepareRequest
   * @param overrideFee - Optional fee override (wei)
   * @returns SubmitResult with txHash and roundId
   */
  async submitAttestation(abiEncodedRequest: string, overrideFee?: bigint): Promise<SubmitResult> {
    try {
      const wallet = this.getWallet();
      const fdcHubAddress = await this.getFdcHub();
      const fdcHub = new Contract(fdcHubAddress, FDC_HUB_ABI, wallet);

      // Get request fee
      const fee = overrideFee ?? (await this.getRequestFee(abiEncodedRequest));

      // Submit attestation request
      const tx = await fdcHub.requestAttestation(abiEncodedRequest, {
        value: fee,
        gasLimit: 500_000n,
      });

      const receipt: TransactionReceipt = await tx.wait();
      if (!receipt) {
        return {
          ok: false,
          error: "Transaction receipt not received",
        };
      }

      // Get block to compute round ID
      const block = await this.getProvider().getBlock(receipt.blockNumber);
      if (!block) {
        return {
          ok: false,
          txHash: receipt.hash,
          error: "Could not fetch block for round ID calculation",
        };
      }

      const roundId = await this.computeRoundId(block.timestamp);

      return {
        ok: true,
        txHash: receipt.hash,
        roundId,
        blockNumber: receipt.blockNumber,
        blockTimestamp: block.timestamp,
        explorerUrl: `https://coston2-systems-explorer.flare.network/voting-round/${roundId}?tab=fdc`,
      };
    } catch (err) {
      return {
        ok: false,
        error: `Submit attestation failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Step 3: Wait for Round Finalization
  // ---------------------------------------------------------------------------

  /**
   * Waits for a voting round to be finalized.
   *
   * @param roundId - The voting round ID to wait for
   * @param timeoutMs - Maximum time to wait (default 180s)
   * @param pollIntervalMs - Polling interval (default 10s)
   * @returns WaitFinalizedResult
   */
  async waitFinalized(
    roundId: number,
    timeoutMs: number = 180_000,
    pollIntervalMs: number = 10_000,
  ): Promise<WaitFinalizedResult> {
    const startTime = Date.now();

    try {
      const provider = this.getProvider();
      const relayAddress = await this.getRelay();
      const relay = new Contract(relayAddress, RELAY_ABI, provider);

      while (Date.now() - startTime < timeoutMs) {
        const finalized = await relay.isFinalized(FDC_PROTOCOL_ID, roundId);
        if (finalized) {
          return {
            ok: true,
            finalized: true,
            roundId,
            elapsedMs: Date.now() - startTime,
          };
        }
        await sleep(pollIntervalMs);
      }

      return {
        ok: false,
        finalized: false,
        roundId,
        elapsedMs: Date.now() - startTime,
        error: `Timeout waiting for round ${roundId} to finalize`,
      };
    } catch (err) {
      return {
        ok: false,
        finalized: false,
        roundId,
        elapsedMs: Date.now() - startTime,
        error: `Wait finalized failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Checks if a round is finalized (non-blocking).
   */
  async isRoundFinalized(roundId: number): Promise<boolean> {
    const provider = this.getProvider();
    const relayAddress = await this.getRelay();
    const relay = new Contract(relayAddress, RELAY_ABI, provider);
    return relay.isFinalized(FDC_PROTOCOL_ID, roundId);
  }

  // ---------------------------------------------------------------------------
  // Step 4: Fetch Proof from DA Layer
  // ---------------------------------------------------------------------------

  /**
   * Fetches the attestation proof from the DA Layer.
   *
   * Prefers `/api/v1/fdc/proof-by-request-round-raw` (response_hex ABI) for typed verify.
   *
   * @param abiEncodedRequest - The original encoded request
   * @param roundId - The voting round ID
   * @returns FetchProofResult with proof and responseHex
   */
  async fetchProof(abiEncodedRequest: string, roundId: number): Promise<FetchProofResult> {
    // Prefer raw (response_hex) for on-chain decode, then structured, then legacy.
    const base = this.cfg.daLayerUrl.replace(/\/$/, "");
    const endpoints = [
      `${base}/api/v1/fdc/proof-by-request-round-raw`,
      `${base}/api/v1/fdc/proof-by-request-round`,
      `${base}/api/v0/fdc/get-proof-round-id-bytes`,
    ];

    const requestBody = {
      votingRoundId: roundId,
      requestBytes: abiEncodedRequest,
    };

    const tried: string[] = [];
    for (const url of endpoints) {
      tried.push(url);
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          continue;
        }

        const raw = await safeJson(response);
        const data = raw as Record<string, unknown>;

        const responseHexRaw = (data.response_hex ?? data.responseHex) as string | undefined;
        const responseObj = data.response as Record<string, unknown> | undefined;
        const proof = (data.proof ?? data.merkleProof) as string[] | undefined;
        const attestationType =
          (data.attestation_type as string | undefined) ??
          (responseObj?.attestationType as string | undefined);

        // Prefer ABI hex; do not treat JSON.stringify(response) as responseHex.
        const responseHex =
          responseHexRaw && /^0x[0-9a-fA-F]+$/.test(responseHexRaw) ? responseHexRaw : undefined;

        let decodedResponse: AddressValidityResponse | undefined;
        if (responseHex) {
          try {
            decodedResponse = decodeAddressValidityResponseHex(responseHex);
          } catch {
            decodedResponse = undefined;
          }
        }
        if (!decodedResponse && responseObj) {
          try {
            decodedResponse = parseStructuredAddressValidityResponse(responseObj);
          } catch {
            decodedResponse = undefined;
          }
        }

        // Structured DA response OR raw hex both count as REAL proof bytes.
        if (responseHex || responseObj || (proof && proof.length > 0)) {
          return {
            ok: true,
            proof: proof ?? [],
            responseHex,
            response: decodedResponse,
            attestationType,
            status: "AVAILABLE",
            urlTried: url,
            raw,
          };
        }
      } catch {
        continue;
      }
    }

    return {
      ok: false,
      status: "NOT_AVAILABLE",
      urlTried: tried.join(", "),
      error: "Proof not available from any DA layer endpoint",
    };
  }

  /**
   * Fetches proof with retries (waits for DA layer to generate proof).
   */
  async fetchProofWithRetry(
    abiEncodedRequest: string,
    roundId: number,
    maxRetries: number = 6,
    retryDelayMs: number = 5_000,
  ): Promise<FetchProofResult> {
    for (let i = 0; i < maxRetries; i++) {
      const result = await this.fetchProof(abiEncodedRequest, roundId);
      if (result.ok) {
        return result;
      }
      if (i < maxRetries - 1) {
        await sleep(retryDelayMs);
      }
    }
    return {
      ok: false,
      status: "NOT_AVAILABLE",
      error: `Proof not available after ${maxRetries} retries`,
    };
  }

  // ---------------------------------------------------------------------------
  // Step 5: On-chain verify via FdcVerification.verifyAddressValidity (VIEW)
  // ---------------------------------------------------------------------------

  /**
   * Calls FdcVerification.verifyAddressValidity via staticCall (view).
   * No transaction is broadcast — return value is still REAL on-chain evidence.
   */
  async verifyAddressValidityOnChain(
    proof: AddressValidityProof,
  ): Promise<VerifyAddressValidityResult> {
    try {
      const provider = this.getProvider();
      const fdcVerificationAddress = await this.getFdcVerification();
      const verification = new Contract(fdcVerificationAddress, FDC_VERIFICATION_ABI, provider);

      const proofTuple = {
        merkleProof: proof.merkleProof,
        data: {
          attestationType: proof.data.attestationType,
          sourceId: proof.data.sourceId,
          votingRound: BigInt(proof.data.votingRound),
          lowestUsedTimestamp: BigInt(proof.data.lowestUsedTimestamp),
          requestBody: {
            addressStr: proof.data.requestBody.addressStr,
          },
          responseBody: {
            isValid: proof.data.responseBody.isValid,
            standardAddress: proof.data.responseBody.standardAddress,
            standardAddressHash: proof.data.responseBody.standardAddressHash,
          },
        },
      };

      const verified = Boolean(await verification.verifyAddressValidity.staticCall(proofTuple));

      return {
        ok: true,
        verified,
        fdcVerificationAddress,
        callKind: "staticCall",
        responseBody: proof.data.responseBody,
      };
    } catch (err) {
      return {
        ok: false,
        verified: false,
        callKind: "staticCall",
        error: `verifyAddressValidity failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Convenience: build Proof from DA fetch result and verify on-chain.
   */
  async verifyAddressValidityFromDaProof(da: {
    proof?: string[];
    responseHex?: string;
    response?: AddressValidityResponse;
    raw?: unknown;
  }): Promise<VerifyAddressValidityResult> {
    try {
      const structured =
        da.response ??
        (typeof da.raw === "object" &&
        da.raw &&
        "response" in (da.raw as object)
          ? ((da.raw as { response: Record<string, unknown> }).response as Record<string, unknown>)
          : undefined);

      const typedProof = buildAddressValidityProof({
        merkleProof: da.proof ?? [],
        responseHex: da.responseHex,
        response: structured,
      });
      return this.verifyAddressValidityOnChain(typedProof);
    } catch (err) {
      return {
        ok: false,
        verified: false,
        callKind: "staticCall",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Full Attestation Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Runs the complete attestation lifecycle:
   * 1. Prepare request via verifier
   * 2. Submit to FdcHub
   * 3. Wait for finalization
   * 4. Fetch proof from DA layer
   * 5. Optionally verify on-chain via FdcVerification.verifyAddressValidity (VIEW staticCall)
   *
   * @param attestationType - Type name (e.g., "AddressValidity")
   * @param sourceId - Source chain identifier
   * @param requestBody - Attestation-type-specific request body
   * @param options - Additional options
   * @returns FullAttestationResult
   */
  async runFullAttestationLifecycle(
    attestationType: string,
    sourceId: SourceId,
    requestBody: Record<string, unknown>,
    options: {
      waitTimeoutMs?: number;
      proofRetries?: number;
      skipWaitFinalized?: boolean;
      /** When true (default for AddressValidity), call verifyAddressValidity after DA proof */
      verifyOnChain?: boolean;
    } = {},
  ): Promise<FullAttestationResult> {
    const timings = {
      prepareMs: 0,
      submitMs: 0,
      waitMs: 0,
      proofMs: 0,
      verifyMs: 0,
      totalMs: 0,
    };
    const startTotal = Date.now();
    const shouldVerifyOnChain =
      options.verifyOnChain ??
      (attestationType === "AddressValidity" || attestationType.includes("AddressValidity"));

    // Step 1: Prepare
    const prepareStart = Date.now();
    const prepareResult = await this.prepareRequest(attestationType, sourceId, requestBody);
    timings.prepareMs = Date.now() - prepareStart;

    if (!prepareResult.ok || !prepareResult.abiEncodedRequest) {
      return {
        ok: false,
        stage: "prepare",
        honesty: "ERROR",
        error: prepareResult.error ?? "Prepare failed",
        timings: { ...timings, totalMs: Date.now() - startTotal },
      };
    }

    const abiEncodedRequest = prepareResult.abiEncodedRequest;

    // Step 2: Submit
    const submitStart = Date.now();
    const submitResult = await this.submitAttestation(abiEncodedRequest);
    timings.submitMs = Date.now() - submitStart;

    if (!submitResult.ok || submitResult.roundId === undefined) {
      return {
        ok: false,
        stage: "submit",
        abiEncodedRequest,
        txHash: submitResult.txHash,
        honesty: "ERROR",
        error: submitResult.error ?? "Submit failed",
        timings: { ...timings, totalMs: Date.now() - startTotal },
      };
    }

    const roundId = submitResult.roundId;

    // Step 3: Wait for finalization
    if (!options.skipWaitFinalized) {
      const waitStart = Date.now();
      const waitResult = await this.waitFinalized(roundId, options.waitTimeoutMs ?? 180_000);
      timings.waitMs = Date.now() - waitStart;

      if (!waitResult.ok || !waitResult.finalized) {
        return {
          ok: false,
          stage: "wait",
          abiEncodedRequest,
          txHash: submitResult.txHash,
          roundId,
          explorerUrl: submitResult.explorerUrl,
          honesty: "PARTIAL",
          error: waitResult.error ?? "Wait finalized timed out",
          timings: { ...timings, totalMs: Date.now() - startTotal },
        };
      }
    }

    // Step 4: Fetch proof
    const proofStart = Date.now();
    const proofResult = await this.fetchProofWithRetry(abiEncodedRequest, roundId, options.proofRetries ?? 6);
    timings.proofMs = Date.now() - proofStart;

    if (!proofResult.ok) {
      timings.totalMs = Date.now() - startTotal;
      return {
        ok: false,
        stage: "proof",
        abiEncodedRequest,
        txHash: submitResult.txHash,
        roundId,
        explorerUrl: submitResult.explorerUrl,
        honesty: "PARTIAL",
        error: proofResult.error ?? "Proof fetch failed",
        timings,
      };
    }

    // Step 5: On-chain verify (AddressValidity)
    let onChainVerified: boolean | undefined;
    let fdcVerificationAddress: string | undefined;
    let honesty: FullAttestationResult["honesty"] = "REAL";

    if (shouldVerifyOnChain) {
      const verifyStart = Date.now();
      const verifyResult = await this.verifyAddressValidityFromDaProof({
        proof: proofResult.proof,
        responseHex: proofResult.responseHex,
        response: proofResult.response,
        raw: proofResult.raw,
      });
      timings.verifyMs = Date.now() - verifyStart;
      fdcVerificationAddress = verifyResult.fdcVerificationAddress;
      onChainVerified = verifyResult.verified;

      if (!verifyResult.ok) {
        timings.totalMs = Date.now() - startTotal;
        return {
          ok: false,
          stage: "verify",
          abiEncodedRequest,
          txHash: submitResult.txHash,
          roundId,
          proof: proofResult.proof,
          responseHex: proofResult.responseHex,
          response: proofResult.response,
          explorerUrl: submitResult.explorerUrl,
          onChainVerified: false,
          fdcVerificationAddress,
          honesty: "PARTIAL",
          error: verifyResult.error ?? "On-chain verify failed",
          timings,
        };
      }

      honesty = verifyResult.verified ? "VERIFIED" : "PARTIAL";
    }

    timings.totalMs = Date.now() - startTotal;

    return {
      ok: true,
      stage: "complete",
      abiEncodedRequest,
      txHash: submitResult.txHash,
      roundId,
      proof: proofResult.proof,
      responseHex: proofResult.responseHex,
      response: proofResult.response,
      explorerUrl: submitResult.explorerUrl,
      onChainVerified,
      fdcVerificationAddress,
      honesty,
      timings,
    };
  }

  // ---------------------------------------------------------------------------
  // Legacy API compatibility
  // ---------------------------------------------------------------------------

  /**
   * @deprecated Use prepareRequest instead
   */
  async prepare(req: PrepareRequest): Promise<PrepareResponse> {
    const sourceId = req.source === "xrp" ? "testXRP" : "testETH";
    const result = await this.prepareRequest(req.kind, sourceId, req.payload);

    if (!result.ok || !result.abiEncodedRequest) {
      return {
        requestId: "",
        status: "error",
        message: result.error ?? "Prepare failed",
        raw: result.raw,
      };
    }

    return {
      requestId: result.abiEncodedRequest,
      status: "prepared",
      raw: result.raw,
    };
  }

  /**
   * @deprecated Use submitAttestation instead
   */
  async submit(requestId: string, _source: "xrp" | "evm"): Promise<SubmitResponse> {
    // The old API passed abiEncodedRequest as requestId
    const result = await this.submitAttestation(requestId);

    if (!result.ok) {
      return {
        requestId,
        status: "error",
        message: result.error ?? "Submit failed",
      };
    }

    return {
      requestId,
      status: "submitted",
      raw: { txHash: result.txHash, roundId: result.roundId },
    };
  }

  /**
   * @deprecated Use fetchProof instead
   */
  async legacyFetchProof(requestId: string): Promise<{ ok: boolean; proof?: unknown; message?: string }> {
    // Try to guess the round ID from current round
    const currentRound = await this.getCurrentRoundId();
    const result = await this.fetchProof(requestId, currentRound);

    if (!result.ok) {
      return { ok: false, message: result.error };
    }

    return {
      ok: true,
      proof: {
        merkleProof: result.proof,
        responseHex: result.responseHex,
      },
    };
  }
}

// -----------------------------------------------------------------------------
// Factory Functions
// -----------------------------------------------------------------------------

/**
 * Creates FdcClient from environment variables.
 */
export function fdcClientFromEnv(env?: BeaconEnv): FdcClient {
  const e = env ?? loadEnv();

  // Normalize verifier URL (may have trailing /verifier/)
  let verifierBase = e.FDC_VERIFIER_EVM_URL || e.FDC_VERIFIER_XRP_URL || "";
  if (verifierBase) {
    verifierBase = normalizeVerifierUrl(verifierBase);
  } else {
    verifierBase = "https://fdc-verifiers-testnet.flare.network";
  }

  return new FdcClient({
    verifierBaseUrl: verifierBase,
    apiKey: e.FDC_API_KEY || undefined,
    daLayerUrl: e.DA_LAYER_URL || "https://ctn2-data-availability.flare.network",
    rpcUrl: e.COSTON2_RPC_URL || "https://coston2-api.flare.network/ext/C/rpc",
    privateKey: e.DEPLOYER_PRIVATE_KEY || e.SETTLER_PRIVATE_KEY || e.DEPLOYMENT_PRIVATE_KEY || undefined,
    contractRegistry: e.FLARE_CONTRACT_REGISTRY || CONTRACT_REGISTRY_ADDRESS,
    expectedFdcHub: e.EXPECTED_FDC_HUB || undefined,
    expectedFdcVerification: e.EXPECTED_FDC_VERIFICATION || undefined,
    firstVotingRoundStartTs: e.EXPECTED_FIRST_VOTING_ROUND_START_TS || undefined,
    votingEpochDurationSeconds: e.EXPECTED_VOTING_EPOCH_DURATION_SECONDS || 90,
  });
}

/**
 * Creates a read-only FdcClient (no private key required).
 */
export function fdcClientReadOnly(env?: BeaconEnv): FdcClient {
  const e = env ?? loadEnv();

  let verifierBase = e.FDC_VERIFIER_EVM_URL || e.FDC_VERIFIER_XRP_URL || "";
  if (verifierBase) {
    verifierBase = normalizeVerifierUrl(verifierBase);
  } else {
    verifierBase = "https://fdc-verifiers-testnet.flare.network";
  }

  return new FdcClient({
    verifierBaseUrl: verifierBase,
    apiKey: e.FDC_API_KEY || undefined,
    daLayerUrl: e.DA_LAYER_URL || "https://ctn2-data-availability.flare.network",
    rpcUrl: e.COSTON2_RPC_URL || "https://coston2-api.flare.network/ext/C/rpc",
    contractRegistry: e.FLARE_CONTRACT_REGISTRY || CONTRACT_REGISTRY_ADDRESS,
    firstVotingRoundStartTs: e.EXPECTED_FIRST_VOTING_ROUND_START_TS || undefined,
    votingEpochDurationSeconds: e.EXPECTED_VOTING_EPOCH_DURATION_SECONDS || 90,
  });
}

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    const text = await response.text();
    return { text };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
