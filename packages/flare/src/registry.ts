/**
 * Flare ContractRegistry resolver for Coston2.
 *
 * Uses the official ContractRegistry at 0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019
 * to resolve named contracts (FtsoV2, FdcHub, AssetManagerController, etc.).
 *
 * https://dev.flare.network/network/solidity-reference/contract-addresses
 */

import { Contract, JsonRpcProvider } from "ethers";
import { loadEnv, type BeaconEnv } from "@beacon/shared";

export const FLARE_CONTRACT_REGISTRY_DEFAULT =
  "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";

const REGISTRY_ABI = [
  "function getContractAddressByName(string name) view returns (address)",
];

const COSTON2_CHAIN_ID = 114;

/**
 * Refuse to proceed if CHAIN_ID !== 114 when NETWORK_NAME is coston2.
 * Prevents accidental mainnet operations with testnet assumptions.
 */
export function assertCoston2ChainId(env: BeaconEnv = loadEnv()): void {
  const networkName = (env.NETWORK_NAME ?? "").toLowerCase();
  const chainId = env.CHAIN_ID;

  if (networkName === "coston2" && chainId !== COSTON2_CHAIN_ID) {
    throw new Error(
      `Chain ID mismatch: NETWORK_NAME=coston2 but CHAIN_ID=${chainId} (expected ${COSTON2_CHAIN_ID}). ` +
      `Refusing to proceed — this may indicate mainnet env with testnet code.`
    );
  }
}

/**
 * Resolve a named contract from the Flare ContractRegistry.
 */
export async function resolveNamedContract(
  name: string,
  env: BeaconEnv = loadEnv(),
): Promise<string> {
  const rpc = env.COSTON2_RPC_URL;
  if (!rpc) {
    throw new Error("COSTON2_RPC_URL not configured — cannot resolve contract registry");
  }

  const registryAddress = env.FLARE_CONTRACT_REGISTRY || FLARE_CONTRACT_REGISTRY_DEFAULT;
  const provider = new JsonRpcProvider(rpc);
  const registry = new Contract(registryAddress, REGISTRY_ABI, provider);

  const resolved = (await registry.getContractAddressByName(name)) as string;
  if (!resolved || resolved === "0x0000000000000000000000000000000000000000") {
    throw new Error(`Contract "${name}" not found in registry at ${registryAddress}`);
  }

  return resolved;
}

/**
 * Validate that a resolved address matches an expected address (if provided).
 * Warns or throws if mismatch — prevents silent contract swaps.
 */
export function validateExpectedAddress(
  name: string,
  resolved: string,
  expected?: string,
  opts?: { throwOnMismatch?: boolean },
): { match: boolean; message?: string } {
  if (!expected) {
    return { match: true };
  }

  const resolvedLower = resolved.toLowerCase();
  const expectedLower = expected.toLowerCase();

  if (resolvedLower !== expectedLower) {
    const message =
      `Contract "${name}" address mismatch: registry returned ${resolved}, ` +
      `expected ${expected}. This may indicate a contract upgrade or misconfiguration.`;

    if (opts?.throwOnMismatch) {
      throw new Error(message);
    }

    console.warn(`[registry] WARNING: ${message}`);
    return { match: false, message };
  }

  return { match: true };
}

/**
 * Batch-resolve multiple named contracts with optional expected address validation.
 */
export async function resolveNamedContracts(
  names: Array<{ name: string; expected?: string }>,
  env: BeaconEnv = loadEnv(),
): Promise<Map<string, { address: string; validated: boolean }>> {
  const results = new Map<string, { address: string; validated: boolean }>();

  for (const { name, expected } of names) {
    const address = await resolveNamedContract(name, env);
    const validation = validateExpectedAddress(name, address, expected);
    results.set(name, { address, validated: validation.match });
  }

  return results;
}
