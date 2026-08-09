/**
 * PriceOracleAdapter — wraps readFtsoFeeds from @beacon/shared with execution guards.
 *
 * Provides honest FTSO price checks with configurable staleness, deviation, and
 * slippage thresholds. Blocks operations that fail guard checks.
 */

import {
  readFtsoFeeds,
  loadEnv,
  evaluateFtsoGuard,
  type BeaconEnv,
} from "@beacon/shared";
import type { IntegrationStatus } from "../honesty.js";

export interface FtsoSnapshot {
  ftsoV2: string;
  timestamp: number;
  feeds: Array<{
    symbol: string;
    feedId: string;
    value: number;
    decimals: number;
    raw: string;
    timestamp: number;
  }>;
}

export interface ExecutionGuardParams {
  feedSymbol: string;
  maxAgeSeconds: number;
  maxDeviationBps?: number;
  referencePrice?: number;
  maxSlippageBps?: number;
  quotedSlippageBps?: number;
}

export interface ExecutionGuardResult {
  allowed: boolean;
  reasons: string[];
  status: IntegrationStatus;
  snapshot: FtsoSnapshot;
  feedValue?: number;
  feedAge?: number;
  deviationBps?: number;
}

export type GuardBlockReason = "STALE" | "HIGH_DEVIATION" | "EXCESSIVE_SLIPPAGE" | "FEED_NOT_FOUND";

export class PriceOracleAdapter {
  private env: BeaconEnv;

  constructor(env?: BeaconEnv) {
    this.env = env ?? loadEnv();
  }

  async getSnapshot(): Promise<FtsoSnapshot> {
    const result = await readFtsoFeeds(this.env);
    return {
      ftsoV2: result.ftsoV2,
      timestamp: result.timestamp,
      feeds: result.feeds,
    };
  }

  async getFeedValue(symbol: string): Promise<{
    value: number;
    timestamp: number;
    raw: string;
    decimals: number;
  } | null> {
    const snapshot = await this.getSnapshot();
    const feed = snapshot.feeds.find((f) => f.symbol === symbol);
    if (!feed) return null;
    return {
      value: feed.value,
      timestamp: feed.timestamp,
      raw: feed.raw,
      decimals: feed.decimals,
    };
  }

  /**
   * Evaluate execution guard conditions.
   *
   * STALE → BLOCK: Feed older than maxAgeSeconds
   * HIGH_DEVIATION → BLOCK: Price deviated more than maxDeviationBps from reference
   * EXCESSIVE_SLIPPAGE → BLOCK: Quoted slippage exceeds maxSlippageBps
   */
  async evaluateExecutionGuard(
    params: ExecutionGuardParams,
  ): Promise<ExecutionGuardResult> {
    const snapshot = await this.getSnapshot();
    const guard = evaluateFtsoGuard(snapshot.feeds, params);
    return {
      ...guard,
      status: "REAL",
      snapshot,
    };
  }

  /**
   * Check if a price is within acceptable bounds for execution.
   */
  async isPriceAcceptable(
    symbol: string,
    referencePrice: number,
    maxDeviationBps: number,
    maxAgeSeconds: number,
  ): Promise<boolean> {
    const result = await this.evaluateExecutionGuard({
      feedSymbol: symbol,
      maxAgeSeconds,
      maxDeviationBps,
      referencePrice,
    });
    return result.allowed;
  }
}

export function createPriceOracleAdapter(env?: BeaconEnv): PriceOracleAdapter {
  return new PriceOracleAdapter(env);
}
