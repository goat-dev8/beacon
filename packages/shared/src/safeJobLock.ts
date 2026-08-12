/**
 * Safe-funded Bound Work lock — Beacon Safe → Escrow without MetaMask per job.
 *
 * Protocol honesty:
 * - Live Coston2 USDT0 is the official faucet ERC-20 (no EIP-3009).
 * - Deposit to Safe uses approve + deposit (transferFrom).
 * - This path: vault.execute(token.transfer(escrow)) then escrow.lockPrepaid(jobId, vault, amount).
 * - Refunds return USDT0 to the Safe (payer = vault address).
 * - Flare Smart Accounts (XRPL personal accounts) are a different product — not used here.
 */

import { Contract, Interface, JsonRpcProvider, Wallet, parseUnits } from "ethers";
import { loadEnv, type BeaconEnv } from "./env.js";
import { jobIdToBytes32 } from "./ids.js";
import {
  COSTON2_CHAIN_ID_VAULT,
  COSTON2_EXPLORER_VAULT,
  readAgentVaultStatus,
  resolveSafeFactoryAddress,
  resolveVaultForWallet,
} from "./vaultClient.js";
import { ERC20_TRANSFER_SELECTOR } from "./safeSwap.js";

const VAULT_EXEC_ABI = [
  "function execute(address target, bytes data, uint256 maxSpend, uint256 nonce_) returns (bytes)",
  "function token() view returns (address)",
  "function paused() view returns (bool)",
  "function balance() view returns (uint256)",
  "function maxSpendPerTx() view returns (uint256)",
  "function allowedTargets(address) view returns (bool)",
  "function allowedSelectors(bytes4) view returns (bool)",
];

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
];

const ESCROW_ABI = [
  "function lockPrepaid(bytes32 jobId, address payer, uint256 amount)",
  "function freeBalance() view returns (uint256)",
  "function owner() view returns (address)",
];

function executorKey(env: BeaconEnv): string | null {
  const k = (env.SETTLER_PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY || env.DEPLOYMENT_PRIVATE_KEY || "").trim();
  return k.startsWith("0x") && k.length >= 66 ? k : k.length >= 64 ? `0x${k}` : null;
}

export async function executeSafeJobLock(
  params: {
    jobId: string;
    amountUsdt0Display: string;
    /** Owner wallet whose personal Safe pays. Required when factory is live. */
    ownerWallet?: string | null;
    /** Explicit vault override (must be owned by ownerWallet when provided). */
    vaultAddress?: string | null;
  },
  env: BeaconEnv = loadEnv(),
): Promise<
  | {
      ok: true;
      mode: "beacon_safe";
      chainId: number;
      vault: string;
      escrow: string;
      amount: string;
      spendTxHash: string;
      lockTxHash: string;
      explorerSpend: string;
      explorerLock: string;
      honesty: string;
      ownerWallet?: string;
    }
  | { ok: false; error: string; code?: string }
> {
  const resolved = await resolveVaultForWallet({
    wallet: params.ownerWallet,
    address: params.vaultAddress,
    env,
    personalOnly: Boolean(resolveSafeFactoryAddress(env) && params.ownerWallet),
  });
  const vaultAddr = resolved.address;
  const escrowAddr = (env.BEACON_ESCROW || "").trim();
  if (!vaultAddr) {
    return {
      ok: false,
      error: params.ownerWallet
        ? "SAFE_NOT_CREATED: Create your Beacon Safe before paying from Safe."
        : "Beacon Safe not configured.",
      code: params.ownerWallet ? "SAFE_NOT_CREATED" : "SAFE_NOT_CONFIGURED",
    };
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(escrowAddr)) {
    return { ok: false, error: "BEACON_ESCROW not configured." };
  }

  const key = executorKey(env);
  if (!key) return { ok: false, error: "Executor key missing for Safe job lock." };

  const status = await readAgentVaultStatus({ address: vaultAddr, env, personalOnly: false });
  if (!status.configured) return { ok: false, error: status.note };

  if (params.ownerWallet) {
    if (status.owner.toLowerCase() !== params.ownerWallet.toLowerCase()) {
      return {
        ok: false,
        error: "NOT_SAFE_OWNER: Connected wallet does not own this Beacon Safe.",
        code: "NOT_SAFE_OWNER",
      };
    }
  }

  const provider = new JsonRpcProvider(env.COSTON2_RPC_URL);
  const wallet = new Wallet(key, provider);
  const vault = new Contract(vaultAddr, VAULT_EXEC_ABI, wallet);
  const tokenAddr = (await vault.token()) as string;
  const token = new Contract(tokenAddr, ERC20_ABI, provider);
  const decimals = Number(await token.decimals().catch(() => 6));
  const amount = parseUnits(params.amountUsdt0Display.replace(/^\$/, ""), decimals);
  if (amount <= 0n) return { ok: false, error: "Amount must be > 0." };

  if (Boolean(await vault.paused())) {
    return { ok: false, error: "Beacon Safe is paused.", code: "SAFE_PAUSED" };
  }
  const bal = (await vault.balance()) as bigint;
  if (bal < amount) {
    return {
      ok: false,
      error: `Safe balance too low. Have ${status.balanceDisplay}, need ${params.amountUsdt0Display}.`,
      code: "INSUFFICIENT_BALANCE",
    };
  }
  const maxTx = (await vault.maxSpendPerTx()) as bigint;
  if (maxTx > 0n && amount > maxTx) {
    return { ok: false, error: `Amount exceeds Safe per-trade limit (${status.maxSpendPerTxDisplay}).` };
  }
  if (!(await vault.allowedTargets(tokenAddr))) {
    return { ok: false, error: "Safe allowlist missing token transfer target. Sync Safe policy." };
  }
  if (!(await vault.allowedSelectors(ERC20_TRANSFER_SELECTOR))) {
    return { ok: false, error: "Safe allowlist missing transfer selector. Sync Safe policy." };
  }

  const escrow = new Contract(escrowAddr, ESCROW_ABI, wallet);
  const escrowOwner = ((await escrow.owner()) as string).toLowerCase();
  if (escrowOwner !== wallet.address.toLowerCase()) {
    return {
      ok: false,
      error: `Escrow owner mismatch. Settler ${wallet.address} must own escrow for lockPrepaid.`,
    };
  }

  const iface = new Interface(ERC20_ABI);
  const transferData = iface.encodeFunctionData("transfer", [escrowAddr, amount]);
  // BeaconAgentVault treats nonce as opaque replay key (usedNonces), not a counter.
  // Must be unused — same pattern as safeSwap (Date.now), not executeNonce() which is last-used.
  const nonce = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));

  let spendTxHash: string;
  try {
    const spendTx = await vault.execute(tokenAddr, transferData, amount, nonce);
    const spendReceipt = await spendTx.wait();
    spendTxHash = spendReceipt?.hash ?? spendTx.hash;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : `Safe spend failed: ${String(err)}`,
    };
  }

  const jobBytes = jobIdToBytes32(params.jobId);
  let lockTxHash: string;
  try {
    const lockTx = await escrow.lockPrepaid(jobBytes, vaultAddr, amount);
    const lockReceipt = await lockTx.wait();
    lockTxHash = lockReceipt?.hash ?? lockTx.hash;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : `lockPrepaid failed: ${String(err)}`,
    };
  }

  return {
    ok: true,
    mode: "beacon_safe",
    chainId: COSTON2_CHAIN_ID_VAULT,
    vault: vaultAddr,
    escrow: escrowAddr,
    amount: amount.toString(),
    spendTxHash,
    lockTxHash,
    explorerSpend: `${COSTON2_EXPLORER_VAULT}/tx/${spendTxHash}`,
    explorerLock: `${COSTON2_EXPLORER_VAULT}/tx/${lockTxHash}`,
    honesty:
      "Safe path: vault.execute(transfer→escrow) + escrow.lockPrepaid. No MetaMask. Wallet fallback uses ERC-20 lockFrom.",
  };
}
