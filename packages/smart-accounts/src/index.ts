import { loadEnv } from "@beacon/shared";

export interface RegistryAddresses {
  masterAccountController?: string;
  assetManagerFxrp?: string;
  fxrpToken?: string;
  fdcHub?: string;
  fdcVerification?: string;
  coreVaultXrpl?: string;
  operatorXrpl?: string;
}

export function registryFromEnv(): RegistryAddresses {
  const env = loadEnv();
  return {
    masterAccountController: env.EXPECTED_MASTER_ACCOUNT_CONTROLLER || undefined,
    assetManagerFxrp: env.EXPECTED_ASSET_MANAGER_FXRP || undefined,
    fxrpToken: env.EXPECTED_FXRP_TOKEN || undefined,
    fdcHub: env.EXPECTED_FDC_HUB || undefined,
    fdcVerification: env.EXPECTED_FDC_VERIFICATION || undefined,
    coreVaultXrpl: env.EXPECTED_CORE_VAULT_XRPL || undefined,
    operatorXrpl: env.EXPECTED_OPERATOR_XRPL || undefined,
  };
}

export interface XrplMemoPayload {
  type: string;
  data: string;
}

export interface CreditDepositMemo {
  beaconRef: string;
  userId: string;
  amountDrops: string;
}

export function encodeCreditDepositMemo(input: CreditDepositMemo): XrplMemoPayload {
  const data = JSON.stringify({
    v: 1,
    ref: input.beaconRef,
    user: input.userId,
    amount: input.amountDrops,
  });
  return {
    type: "BeaconCredit",
    data: Buffer.from(data, "utf8").toString("hex").toUpperCase(),
  };
}

export function decodeCreditDepositMemo(memo: XrplMemoPayload): CreditDepositMemo | null {
  try {
    const json = Buffer.from(memo.data, "hex").toString("utf8");
    const parsed = JSON.parse(json) as {
      ref?: string;
      user?: string;
      amount?: string;
    };
    if (!parsed.ref || !parsed.user || !parsed.amount) return null;
    return {
      beaconRef: parsed.ref,
      userId: parsed.user,
      amountDrops: parsed.amount,
    };
  } catch {
    return null;
  }
}

export function buildPaymentInstruction(input: {
  destination: string;
  amountXrp: string;
  memo: XrplMemoPayload;
}): Record<string, unknown> {
  return {
    TransactionType: "Payment",
    Destination: input.destination,
    Amount: xrpToDrops(input.amountXrp),
    Memos: [
      {
        Memo: {
          MemoType: Buffer.from(input.memo.type, "utf8").toString("hex").toUpperCase(),
          MemoData: input.memo.data,
        },
      },
    ],
  };
}

function xrpToDrops(xrp: string): string {
  const parts = xrp.split(".");
  const whole = parts[0] ?? "0";
  const frac = (parts[1] ?? "0").padEnd(6, "0").slice(0, 6);
  const drops = BigInt(whole) * 1_000_000n + BigInt(frac);
  return drops.toString();
}

export function assertRegistryConfigured(reg: RegistryAddresses): string[] {
  const missing: string[] = [];
  if (!reg.masterAccountController) missing.push("EXPECTED_MASTER_ACCOUNT_CONTROLLER");
  if (!reg.operatorXrpl) missing.push("EXPECTED_OPERATOR_XRPL");
  if (!reg.coreVaultXrpl) missing.push("EXPECTED_CORE_VAULT_XRPL");
  return missing;
}

export const CUSTOM_INSTRUCTION_OPCODES = {
  DEPOSIT_CREDIT: 0xfe,
  REFUND_CREDIT: 0xff,
} as const;

export function encodeCustomInstructionPayload(opcode: number, payload: Uint8Array): string {
  const buf = Buffer.alloc(1 + payload.length);
  buf.writeUInt8(opcode, 0);
  Buffer.from(payload).copy(buf, 1);
  return `0x${buf.toString("hex")}`;
}
