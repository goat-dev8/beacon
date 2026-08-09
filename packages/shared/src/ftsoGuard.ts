/**
 * FTSO execution guard — pure evaluation over a price snapshot.
 * Used by Safe swaps and @beacon/flare PriceOracleAdapter.
 *
 * STALE / HIGH_DEVIATION / EXCESSIVE_SLIPPAGE → BLOCK
 */

export type FtsoGuardFeed = {
  symbol: string;
  value: number;
  timestamp: number;
};

export type FtsoGuardParams = {
  feedSymbol: string;
  maxAgeSeconds: number;
  maxDeviationBps?: number;
  referencePrice?: number;
  maxSlippageBps?: number;
  quotedSlippageBps?: number;
  /** Unix seconds; defaults to now. */
  nowSeconds?: number;
};

export type FtsoGuardResult = {
  allowed: boolean;
  reasons: string[];
  feedValue?: number;
  feedAge?: number;
  deviationBps?: number;
};

/** Default: 3 voting epochs (~270s) + buffer — FTSOv2 updates are frequent. */
export const FTSO_GUARD_DEFAULTS = {
  maxAgeSeconds: 300,
  maxDeviationBps: 500,
  maxSlippageBps: 200,
} as const;

export function evaluateFtsoGuard(
  feeds: FtsoGuardFeed[],
  params: FtsoGuardParams,
): FtsoGuardResult {
  const feed = feeds.find((f) => f.symbol === params.feedSymbol);
  if (!feed) {
    return {
      allowed: false,
      reasons: [`FEED_NOT_FOUND: ${params.feedSymbol} not in FTSO snapshot`],
    };
  }

  const reasons: string[] = [];
  const nowSeconds = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  const feedAge = nowSeconds - feed.timestamp;

  if (feedAge > params.maxAgeSeconds) {
    reasons.push(
      `STALE: Feed age ${feedAge}s exceeds max ${params.maxAgeSeconds}s — BLOCK`,
    );
  }

  let deviationBps: number | undefined;
  if (
    params.maxDeviationBps !== undefined &&
    params.referencePrice !== undefined &&
    params.referencePrice > 0
  ) {
    const deviation = Math.abs(feed.value - params.referencePrice);
    deviationBps = Math.round((deviation / params.referencePrice) * 10_000);
    if (deviationBps > params.maxDeviationBps) {
      reasons.push(
        `HIGH_DEVIATION: ${deviationBps}bps exceeds max ${params.maxDeviationBps}bps — BLOCK`,
      );
    }
  }

  if (
    params.maxSlippageBps !== undefined &&
    params.quotedSlippageBps !== undefined &&
    params.quotedSlippageBps > params.maxSlippageBps
  ) {
    reasons.push(
      `EXCESSIVE_SLIPPAGE: Quoted ${params.quotedSlippageBps}bps exceeds max ${params.maxSlippageBps}bps — BLOCK`,
    );
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    feedValue: feed.value,
    feedAge,
    deviationBps,
  };
}
