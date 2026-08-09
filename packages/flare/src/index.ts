/**
 * @beacon/flare — Beacon's Flare protocol adapter layer.
 *
 * Provides honest integration status tracking for all Flare primitives:
 * - FTSO price oracle guards
 * - FDC attestation lifecycle
 * - FAssets mint/redeem (with honest NOT_AVAILABLE for automated mint)
 * - Smart Account stubs (STUB until PersonalAccount executor exists)
 * - Payment rails (x402 / Safe escrow)
 * - Cross-chain OFT bridge tracking
 * - FCC shadow authorization (never claims hardware TEE without evidence)
 *
 * Every adapter returns IntegrationStatus: REAL | SIMULATED | NOT_AVAILABLE | STUB
 */

export * from "./honesty.js";
export * from "./registry.js";
export * from "./evidence.js";

export {
  PriceOracleAdapter,
  createPriceOracleAdapter,
  type FtsoSnapshot,
  type ExecutionGuardParams,
  type ExecutionGuardResult,
  type GuardBlockReason,
} from "./adapters/priceOracle.js";

export {
  AttestationAdapter,
  createAttestationAdapter,
  type AttestationLifecycle,
  type AttestationRequest,
  type AttestationPersistShape,
  type AttestationAdapterConfig,
} from "./adapters/attestation.js";

export {
  FAssetsAdapter,
  createFAssetsAdapter,
  type FAssetStatus,
  type FAssetsAdapterResult,
  type RedeemPrepResult,
} from "./adapters/fassets.js";

export {
  SmartAccountAdapter,
  createSmartAccountAdapter,
  OFFICIAL_SMART_ACCOUNT_CUSTOM_INSTRUCTION_BYTE,
  type SmartAccountAdapterResult,
  type SmartAccountExecuteResult,
} from "./adapters/smartAccount.js";

export {
  PaymentAdapter,
  createPaymentAdapter,
  type PaymentRail,
  type X402PaymentConfig,
  type SafeEscrowConfig,
  type PaymentRailStatus,
  type PaymentIntent,
  type PaymentResult,
} from "./adapters/payment.js";

export {
  CrossChainAdapter,
  createCrossChainAdapter,
  type OftRoute,
  type OftRoutesResult,
  type BridgePhase,
  type BridgeDeliveryStatus,
} from "./adapters/crossChain.js";

export {
  ConfidentialComputeAdapter,
  createConfidentialComputeAdapter,
  type ShadowAuthorizationParams,
  type ShadowAuthorizationResult,
} from "./adapters/confidentialCompute.js";
