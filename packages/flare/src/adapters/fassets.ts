/**
 * FAssetsAdapter — wraps readFassetsDesk / prepareFassetsRedeemLots from @beacon/shared.
 *
 * Mint is documented as NOT_AVAILABLE for automated mint — Beacon cannot complete
 * the XRPL agent reservation flow end-to-end. This is a handoff to documentation.
 *
 * Redeem is available when AssetManager.redeem exists on the contract.
 *
 * https://dev.flare.network/fassets/overview
 * https://dev.flare.network/fassets/developer-guides/fassets-minting
 * https://dev.flare.network/fassets/developer-guides/fassets-redeem
 */

import {
  readFassetsDesk,
  prepareFassetsRedeemLots,
  loadEnv,
  type BeaconEnv,
} from "@beacon/shared";
import type { IntegrationStatus } from "../honesty.js";

export interface FAssetStatus {
  symbol: string;
  fAsset: string;
  assetManager: string;
  lotSizeUnderlying: number;
  agentCount: number;
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
  docs: string[];
}

export interface RedeemPrepResult {
  status: IntegrationStatus;
  ok: boolean;
  data?: {
    assetManager: string;
    fAsset: string;
    symbol: string;
    lots: number;
    amountDisplay: string;
    underlyingAddress: string;
    approveData: string;
    redeemData: string;
  };
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
        agentCount: mgr.agentCount,
        mintStatus,
        mintNote:
          mintStatus === "NOT_AVAILABLE"
            ? "Automated mint NOT_AVAILABLE — requires XRPL agent reservation + Xaman payment. See DevHub docs for handoff flow."
            : "Mint available",
        redeemStatus,
        redeemNote:
          redeemStatus === "REAL"
            ? "Lots-based redeem can be prepared for wallet signing."
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
      docs: desk.docs,
    };
  }

  /**
   * Prepare redeem calldata for lots-based redemption.
   *
   * Requires a valid XRPL classic address for the underlying payment destination.
   */
  async prepareRedeem(params: {
    lots: number;
    underlyingAddress: string;
    executor?: string;
    assetManager?: string;
  }): Promise<RedeemPrepResult> {
    const result = await prepareFassetsRedeemLots(params, this.env);

    if (!result.ok) {
      return {
        status: "NOT_AVAILABLE",
        ok: false,
        error: (result as { error: string }).error,
        docs: [
          "https://dev.flare.network/fassets/developer-guides/fassets-redeem",
        ],
      };
    }

    const prep = result as {
      ok: true;
      assetManager: string;
      fAsset: string;
      symbol: string;
      lots: number;
      amountDisplay: string;
      underlyingAddress: string;
      approveData: string;
      redeemData: string;
      docs: string[];
    };

    return {
      status: "REAL",
      ok: true,
      data: {
        assetManager: prep.assetManager,
        fAsset: prep.fAsset,
        symbol: prep.symbol,
        lots: prep.lots,
        amountDisplay: prep.amountDisplay,
        underlyingAddress: prep.underlyingAddress,
        approveData: prep.approveData,
        redeemData: prep.redeemData,
      },
      docs: prep.docs,
    };
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
