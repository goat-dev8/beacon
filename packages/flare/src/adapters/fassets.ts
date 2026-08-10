/**
 * FAssetsAdapter — wraps readFassetsDesk / redeem prepare / track from @beacon/shared.
 *
 * Mint is documented as NOT_AVAILABLE for automated mint — Beacon cannot complete
 * the XRPL agent reservation flow end-to-end. This is a handoff to documentation.
 *
 * Redeem prepare is REAL (lots / amount / withTag). COMPLETED only with
 * RedemptionPerformed XRPL transactionHash evidence.
 *
 * https://dev.flare.network/fassets/overview
 * https://dev.flare.network/fassets/developer-guides/fassets-minting
 * https://dev.flare.network/fassets/developer-guides/fassets-redeem
 * https://dev.flare.network/fassets/developer-guides/fassets-redeem-amount
 */

import {
  readFassetsDesk,
  prepareFassetsRedeemLots,
  prepareFassetsRedeemAmount,
  prepareFassetsRedeemWithTag,
  trackFassetsRedemption,
  readFassetsRedemptionQueue,
  loadEnv,
  type BeaconEnv,
  type FAssetsRedeemPrep,
  type FAssetsRedemptionTrack,
  type RedemptionQueuePage,
} from "@beacon/shared";
import type { IntegrationStatus } from "../honesty.js";

export interface FAssetStatus {
  symbol: string;
  fAsset: string;
  assetManager: string;
  lotSizeUnderlying: number;
  minimumRedeemUnderlying: number | null;
  agentCount: number;
  availableAgentCount: number;
  mintStatus: IntegrationStatus;
  mintNote: string;
  redeemStatus: IntegrationStatus;
  redeemNote: string;
  bridgeStatus: IntegrationStatus;
  bridgeNote: string;
}

export interface FAssetsAdapterResult {
  status: IntegrationStatus;
  network: string;
  chainId: number;
  assets: FAssetStatus[];
  honesty: string;
  lifecycleHonesty: string;
  docs: string[];
}

export interface RedeemPrepResult {
  status: IntegrationStatus;
  ok: boolean;
  data?: FAssetsRedeemPrep;
  error?: string;
  docs: string[];
}

export class FAssetsAdapter {
  private env: BeaconEnv;

  constructor(env?: BeaconEnv) {
    this.env = env ?? loadEnv();
  }

  /**
   * Read current FAssets desk status.
   *
   * Mint is labeled docs_handoff / NOT_AVAILABLE for automated mint.
   * This is the current reality — Beacon cannot complete XRPL+agent flows.
   */
  async getStatus(): Promise<FAssetsAdapterResult> {
    const desk = await readFassetsDesk(this.env);

    const assets: FAssetStatus[] = desk.managers.map((mgr) => {
      const mintStatus: IntegrationStatus =
        mgr.actions.mint === "docs_handoff" ? "NOT_AVAILABLE" : "NOT_AVAILABLE";

      const redeemStatus: IntegrationStatus =
        mgr.actions.redeem === "prepare" ? "REAL" : "NOT_AVAILABLE";

      const bridgeStatus: IntegrationStatus =
        mgr.actions.bridge === "oft" ? "REAL" : "NOT_AVAILABLE";

      return {
        symbol: mgr.symbol,
        fAsset: mgr.fAsset,
        assetManager: mgr.assetManager,
        lotSizeUnderlying: mgr.lotSizeUnderlying,
        minimumRedeemUnderlying: mgr.minimumRedeemUnderlying,
        agentCount: mgr.agentCount,
        availableAgentCount: mgr.availableAgentCount,
        mintStatus,
        mintNote:
          mintStatus === "NOT_AVAILABLE"
            ? "Automated mint NOT_AVAILABLE — requires XRPL agent reservation + Xaman payment. See DevHub docs for handoff flow."
            : "Mint available",
        redeemStatus,
        redeemNote:
          redeemStatus === "REAL"
            ? "Redeem prepare REAL (lots / amount / withTag). COMPLETED only after RedemptionPerformed with XRPL tx hash."
            : "Redeem not available on this asset manager.",
        bridgeStatus,
        bridgeNote:
          bridgeStatus === "REAL"
            ? "OFT bridge available via LayerZero adapter."
            : "No OFT bridge path configured.",
      };
    });

    return {
      status: "REAL",
      network: desk.network,
      chainId: desk.chainId,
      assets,
      honesty: desk.honesty,
      lifecycleHonesty: desk.lifecycleHonesty,
      docs: desk.docs,
    };
  }

  /**
   * Prepare redeem calldata — lots, amount (UBA), or withTag.
   */
  async prepareRedeem(params: {
    mode?: "lots" | "amount" | "withTag";
    lots?: number;
    amountUBA?: string;
    underlyingAddress: string;
    destinationTag?: number;
    executor?: string;
    assetManager?: string;
  }): Promise<RedeemPrepResult> {
    const mode =
      params.mode ??
      (params.destinationTag != null
        ? "withTag"
        : params.amountUBA != null
          ? "amount"
          : "lots");

    let result: FAssetsRedeemPrep | { ok: false; error: string };
    if (mode === "withTag") {
      if (params.amountUBA == null || params.destinationTag == null) {
        return {
          status: "NOT_AVAILABLE",
          ok: false,
          error: "withTag requires amountUBA and destinationTag",
          docs: [
            "https://dev.flare.network/fassets/developer-guides/fassets-redeem-amount",
          ],
        };
      }
      result = await prepareFassetsRedeemWithTag(
        {
          amountUBA: params.amountUBA,
          underlyingAddress: params.underlyingAddress,
          destinationTag: params.destinationTag,
          executor: params.executor,
          assetManager: params.assetManager,
        },
        this.env,
      );
    } else if (mode === "amount") {
      if (params.amountUBA == null) {
        return {
          status: "NOT_AVAILABLE",
          ok: false,
          error: "amount mode requires amountUBA",
          docs: [
            "https://dev.flare.network/fassets/developer-guides/fassets-redeem-amount",
          ],
        };
      }
      result = await prepareFassetsRedeemAmount(
        {
          amountUBA: params.amountUBA,
          underlyingAddress: params.underlyingAddress,
          executor: params.executor,
          assetManager: params.assetManager,
        },
        this.env,
      );
    } else {
      if (params.lots == null) {
        return {
          status: "NOT_AVAILABLE",
          ok: false,
          error: "lots mode requires lots",
          docs: ["https://dev.flare.network/fassets/developer-guides/fassets-redeem"],
        };
      }
      result = await prepareFassetsRedeemLots(
        {
          lots: params.lots,
          underlyingAddress: params.underlyingAddress,
          executor: params.executor,
          assetManager: params.assetManager,
        },
        this.env,
      );
    }

    if (!result.ok) {
      return {
        status: "NOT_AVAILABLE",
        ok: false,
        error: result.error,
        docs: [
          "https://dev.flare.network/fassets/developer-guides/fassets-redeem",
          "https://dev.flare.network/fassets/developer-guides/fassets-redeem-amount",
        ],
      };
    }

    return {
      status: "REAL",
      ok: true,
      data: result,
      docs: result.docs,
    };
  }

  async trackRedemption(params: {
    requestId: string;
    assetManager?: string;
    lookbackBlocks?: number;
  }): Promise<FAssetsRedemptionTrack | { ok: false; error: string }> {
    return trackFassetsRedemption({ ...params, env: this.env });
  }

  async getRedemptionQueue(params?: {
    firstTicketId?: string;
    pageSize?: number;
    assetManager?: string;
  }): Promise<RedemptionQueuePage | { ok: false; error: string }> {
    return readFassetsRedemptionQueue({ ...params, env: this.env });
  }

  /**
   * Get mint handoff information — Beacon cannot automate XRPL minting.
   */
  getMintHandoff(symbol: string): {
    status: IntegrationStatus;
    message: string;
    docs: string[];
  } {
    return {
      status: "NOT_AVAILABLE",
      message:
        `Minting ${symbol} requires XRPL agent reservation + underlying payment (typically via Xaman). ` +
        "Beacon cannot complete this flow end-to-end — this is a documented handoff, not a mint button.",
      docs: [
        "https://dev.flare.network/fassets/developer-guides/fassets-minting",
        "https://dev.flare.network/fassets/minting",
        "https://dev.flare.network/fassets/overview",
      ],
    };
  }
}

export function createFAssetsAdapter(env?: BeaconEnv): FAssetsAdapter {
  return new FAssetsAdapter(env);
}
