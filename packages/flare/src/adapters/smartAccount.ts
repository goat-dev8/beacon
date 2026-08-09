/**
 * SmartAccountAdapter — wraps registryFromEnv from @beacon/smart-accounts.
 *
 * Status: STUB until PersonalAccount executor exists.
 *
 * Official Flare Smart Account custom instruction opcode documented separately —
 * Beacon credit memo markers are NOT Smart Account opcodes.
 *
 * https://dev.flare.network/smart-accounts/custom-instruction
 */

import { registryFromEnv, type RegistryAddresses } from "@beacon/smart-accounts";
import type { BeaconEnv } from "@beacon/shared";
import type { IntegrationStatus } from "../honesty.js";

/**
 * Official Flare Smart Account custom instruction command byte.
 * See: https://dev.flare.network/smart-accounts/custom-instruction
 *
 * DO NOT confuse with Beacon credit memo markers (0xbe, 0xbc) which are
 * application-level identifiers, not Smart Account protocol opcodes.
 */
export const OFFICIAL_SMART_ACCOUNT_CUSTOM_INSTRUCTION_BYTE = 0xff;

export interface SmartAccountAdapterResult {
  status: IntegrationStatus;
  registry: RegistryAddresses;
  note: string;
  docs: string[];
}

export interface SmartAccountExecuteResult {
  status: IntegrationStatus;
  ok: boolean;
  txHash?: string;
  error?: string;
}

export class SmartAccountAdapter {
  constructor(_env?: BeaconEnv) {
    // Environment is accessed via registryFromEnv() internally
  }

  /**
   * Get current registry configuration.
   *
   * Status is STUB until PersonalAccount executor integration is complete.
   */
  getRegistry(): SmartAccountAdapterResult {
    const registry = registryFromEnv();

    return {
      status: "STUB",
      registry,
      note:
        "Smart Account adapter is STUB — PersonalAccount executor not yet implemented. " +
        "Registry addresses can be read but execution is not available.",
      docs: [
        "https://dev.flare.network/smart-accounts/overview",
        "https://dev.flare.network/smart-accounts/custom-instruction",
      ],
    };
  }

  /**
   * Validate that registry has required addresses configured.
   */
  validateRegistry(): {
    valid: boolean;
    missing: string[];
    status: IntegrationStatus;
  } {
    const registry = registryFromEnv();
    const missing: string[] = [];

    if (!registry.masterAccountController) {
      missing.push("EXPECTED_MASTER_ACCOUNT_CONTROLLER");
    }
    if (!registry.operatorXrpl) {
      missing.push("EXPECTED_OPERATOR_XRPL");
    }
    if (!registry.coreVaultXrpl) {
      missing.push("EXPECTED_CORE_VAULT_XRPL");
    }

    return {
      valid: missing.length === 0,
      missing,
      status: "STUB",
    };
  }

  /**
   * Execute a custom instruction — NOT IMPLEMENTED.
   *
   * This is a stub that returns an error until PersonalAccount executor exists.
   */
  async executeCustomInstruction(_params: {
    instruction: Uint8Array;
    target: string;
    value?: bigint;
  }): Promise<SmartAccountExecuteResult> {
    return {
      status: "STUB",
      ok: false,
      error:
        "SmartAccountAdapter.executeCustomInstruction is STUB — " +
        "PersonalAccount executor not implemented. Cannot execute instructions.",
    };
  }

  /**
   * Encode a custom instruction payload with the official opcode.
   *
   * Note: This uses OFFICIAL_SMART_ACCOUNT_CUSTOM_INSTRUCTION_BYTE (0xff)
   * which is the Flare protocol opcode, NOT Beacon application markers.
   */
  encodeCustomInstruction(payload: Uint8Array): Uint8Array {
    const result = new Uint8Array(1 + payload.length);
    result[0] = OFFICIAL_SMART_ACCOUNT_CUSTOM_INSTRUCTION_BYTE;
    result.set(payload, 1);
    return result;
  }
}

export function createSmartAccountAdapter(env?: BeaconEnv): SmartAccountAdapter {
  return new SmartAccountAdapter(env);
}
