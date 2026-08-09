/**
 * CrossChainAdapter — wraps trackOftDelivery / discoverFxrpOftRoutes from @beacon/shared.
 *
 * Never marks bridge complete from optimistic local response — uses trackOftDelivery
 * to verify actual destination confirmation via OFTReceived event.
 *
 * https://dev.flare.network/fassets/developer-guides/fassets-bridge
 */

import {
  trackOftDelivery,
  discoverFxrpOftRoutes,
  loadEnv,
  type BeaconEnv,
} from "@beacon/shared";
import type { IntegrationStatus } from "../honesty.js";

export interface OftRoute {
  chain: string;
  eid: number;
  peer: string;
  explorer?: string;
}

export interface OftRoutesResult {
  status: IntegrationStatus;
  oft: string;
  routes: OftRoute[];
  note: string;
}

export type BridgePhase =
  | "source_pending"
  | "source_confirmed"
  | "protocol_observe"
  | "dest_unknown"
  | "dest_confirmed"
  | "failed";

export interface BridgeDeliveryStatus {
  status: IntegrationStatus;
  phase: BridgePhase;
  sourceTxHash: string;
  guid: string | null;
  dstEid: number | null;
  destination: string | null;
  destTxHash: string | null;
  amountReceivedLD: string | null;
  layerZeroScanUrl: string | null;
  note: string;
}

export class CrossChainAdapter {
  private env: BeaconEnv;

  constructor(env?: BeaconEnv) {
    this.env = env ?? loadEnv();
  }

  /**
   * Discover available FXRP OFT bridge routes.
   */
  async discoverRoutes(): Promise<OftRoutesResult> {
    const discovered = await discoverFxrpOftRoutes(this.env);

    return {
      status: "REAL",
      oft: discovered.oftAdapter,
      routes: discovered.routes.map((r) => ({
        chain: r.chain,
        eid: r.eid,
        peer: r.peer,
      })),
      note:
        discovered.routes.length > 0
          ? `Found ${discovered.routes.length} OFT route(s) for FXRP bridging.`
          : "No OFT routes discovered — bridge may not be configured.",
    };
  }

  /**
   * Track OFT bridge delivery status.
   *
   * IMPORTANT: Never marks bridge complete from optimistic local response.
   * Uses trackOftDelivery to verify actual OFTReceived event on destination.
   */
  async trackDelivery(params: {
    sourceTxHash: string;
    dstEid?: number;
    peer?: string;
    guid?: string | null;
    maxBlocks?: number;
  }): Promise<BridgeDeliveryStatus> {
    const result = await trackOftDelivery({
      ...params,
      env: this.env,
    });

    const status: IntegrationStatus =
      result.phase === "dest_confirmed" ? "REAL" : "REAL";

    let note: string;
    switch (result.phase) {
      case "source_pending":
        note = "Waiting for source chain confirmation.";
        break;
      case "source_confirmed":
        note = "Source confirmed — awaiting LayerZero protocol delivery.";
        break;
      case "protocol_observe":
        note =
          "Source confirmed — observe on LayerZero Scan. Destination not yet confirmed.";
        break;
      case "dest_unknown":
        note =
          "Cannot verify destination — no public RPC or GUID missing. Check LayerZero Scan.";
        break;
      case "dest_confirmed":
        note = "Bridge complete — OFTReceived confirmed on destination chain.";
        break;
      case "failed":
        note = "Bridge failed — source transaction reverted.";
        break;
      default:
        note = "Unknown bridge phase.";
    }

    return {
      status,
      phase: result.phase as BridgePhase,
      sourceTxHash: result.sourceTxHash,
      guid: result.guid,
      dstEid: result.dstEid,
      destination: result.destination,
      destTxHash: result.destTxHash,
      amountReceivedLD: result.amountReceivedLD,
      layerZeroScanUrl: result.layerZeroScanUrl,
      note,
    };
  }

  /**
   * Check if a bridge is truly complete — requires dest_confirmed phase.
   *
   * Never trust optimistic local responses for completion status.
   */
  async isBridgeComplete(sourceTxHash: string): Promise<{
    complete: boolean;
    status: IntegrationStatus;
    phase: BridgePhase;
    destTxHash: string | null;
  }> {
    const delivery = await this.trackDelivery({ sourceTxHash });

    return {
      complete: delivery.phase === "dest_confirmed",
      status: delivery.status,
      phase: delivery.phase,
      destTxHash: delivery.destTxHash,
    };
  }

  /**
   * Get LayerZero Scan URL for tracking — this is the authoritative source.
   */
  getLayerZeroScanUrl(sourceTxHash: string): string {
    return `https://layerzeroscan.com/tx/${sourceTxHash}`;
  }
}

export function createCrossChainAdapter(env?: BeaconEnv): CrossChainAdapter {
  return new CrossChainAdapter(env);
}
