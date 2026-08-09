/**
 * PaymentAdapter — thin types for x402 vs Safe job escrow payment rails.
 *
 * These are separate mechanisms:
 * - x402: HTTP payment protocol for AI work micropayments
 * - Safe job escrow: On-chain Safe-based escrow for job completion
 *
 * Status is REAL for both rails when configured.
 */

import type { BeaconEnv } from "@beacon/shared";
import type { IntegrationStatus } from "../honesty.js";

export type PaymentRail = "x402" | "safe_escrow";

export interface X402PaymentConfig {
  endpoint?: string;
  recipientAddress?: string;
  currency?: string;
}

export interface SafeEscrowConfig {
  safeAddress?: string;
  escrowModule?: string;
  chainId?: number;
}

export interface PaymentRailStatus {
  rail: PaymentRail;
  status: IntegrationStatus;
  configured: boolean;
  note: string;
}

export interface PaymentIntent {
  rail: PaymentRail;
  amount: string;
  currency: string;
  recipient: string;
  jobId?: string;
  memo?: string;
}

export interface PaymentResult {
  status: IntegrationStatus;
  ok: boolean;
  rail: PaymentRail;
  txHash?: string;
  paymentId?: string;
  error?: string;
}

export class PaymentAdapter {
  private x402Config: X402PaymentConfig;
  private safeConfig: SafeEscrowConfig;

  constructor(
    _env?: BeaconEnv,
    x402Config?: X402PaymentConfig,
    safeConfig?: SafeEscrowConfig,
  ) {
    this.x402Config = x402Config ?? {};
    this.safeConfig = safeConfig ?? {};
  }

  /**
   * Get status of both payment rails.
   */
  getRailStatus(): PaymentRailStatus[] {
    const x402Configured = Boolean(this.x402Config.endpoint);
    const safeConfigured = Boolean(this.safeConfig.safeAddress);

    return [
      {
        rail: "x402" as const,
        status: x402Configured ? "REAL" : "NOT_AVAILABLE",
        configured: x402Configured,
        note: x402Configured
          ? "x402 payment rail configured and available."
          : "x402 endpoint not configured.",
      },
      {
        rail: "safe_escrow" as const,
        status: safeConfigured ? "REAL" : "NOT_AVAILABLE",
        configured: safeConfigured,
        note: safeConfigured
          ? "Safe job escrow configured and available."
          : "Safe escrow address not configured.",
      },
    ];
  }

  /**
   * Check if a specific rail is available.
   */
  isRailAvailable(rail: PaymentRail): boolean {
    const statuses = this.getRailStatus();
    const status = statuses.find((s) => s.rail === rail);
    return status?.status === "REAL";
  }

  /**
   * Prepare a payment intent — does not execute, just validates and formats.
   */
  preparePayment(intent: PaymentIntent): {
    status: IntegrationStatus;
    ok: boolean;
    prepared?: PaymentIntent;
    error?: string;
  } {
    if (!this.isRailAvailable(intent.rail)) {
      return {
        status: "NOT_AVAILABLE",
        ok: false,
        error: `Payment rail ${intent.rail} is not configured.`,
      };
    }

    if (!intent.amount || parseFloat(intent.amount) <= 0) {
      return {
        status: "REAL",
        ok: false,
        error: "Payment amount must be positive.",
      };
    }

    if (!intent.recipient) {
      return {
        status: "REAL",
        ok: false,
        error: "Payment recipient is required.",
      };
    }

    return {
      status: "REAL",
      ok: true,
      prepared: intent,
    };
  }

  /**
   * Execute payment — NOT IMPLEMENTED in adapter layer.
   *
   * Actual execution should go through the specific payment module
   * (@beacon/x402 or Safe escrow service).
   */
  async executePayment(_intent: PaymentIntent): Promise<PaymentResult> {
    return {
      status: "NOT_AVAILABLE",
      ok: false,
      rail: _intent.rail,
      error:
        "PaymentAdapter.executePayment is a type layer — " +
        "actual execution should use @beacon/x402 or Safe escrow service directly.",
    };
  }
}

export function createPaymentAdapter(
  env?: BeaconEnv,
  x402Config?: X402PaymentConfig,
  safeConfig?: SafeEscrowConfig,
): PaymentAdapter {
  return new PaymentAdapter(env, x402Config, safeConfig);
}
