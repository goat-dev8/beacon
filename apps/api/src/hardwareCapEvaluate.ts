import { FccExtensionClient, fccConfigFromEnv } from "@beacon/fdc";
import {
  readAgentVaultStatus,
  type AgentChatResult,
  type BeaconEnv,
} from "@beacon/shared";

const EXPLORER = "https://coston2-explorer.flare.network/tx/";

function explorerTx(hash: string | undefined) {
  if (!hash) return null;
  return `${EXPLORER}${hash}`;
}

function parseAmount(result: AgentChatResult): number {
  const fromState = result.state?.amountInUnits;
  if (fromState != null && Number.isFinite(Number(fromState)) && Number(fromState) > 0) {
    return Number(fromState);
  }
  for (const card of result.cards) {
    if (card.type === "swap_quote" || card.type === "swap_prepare") {
      const n = Number(card.amountInDisplay);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return NaN;
}

/**
 * When Flow hits a real per-trade cap (not a balance miss), submit hardware FCC
 * so the desk shows a TEE-signed DENY. Under-cap swap quotes get a signed ALLOW.
 * Confirm (`swap_prepare`) does not submit a second instruction.
 */
export async function attachHardwareCapFcc(
  result: AgentChatResult,
  wallet: string,
  env: BeaconEnv,
): Promise<void> {
  const amountUsdt0 = parseAmount(result);
  if (!Number.isFinite(amountUsdt0) || amountUsdt0 <= 0) return;

  const vault = await readAgentVaultStatus({ wallet, personalOnly: true, env });
  if (!vault.configured) return;
  const capUsdt0 = Number(vault.maxSpendPerTxDisplay);
  if (!Number.isFinite(capUsdt0) || capUsdt0 <= 0) return;

  const insuff = result.cards.find(
    (c) =>
      c.type === "insufficient" &&
      /maxSpendPerTx/i.test(String("summary" in c ? c.summary : "")),
  );
  const quote = result.cards.find((c) => c.type === "swap_quote");
  if (!insuff && !quote) return;
  if (quote && typeof quote.teeSignedStatus === "number") return;

  const client = new FccExtensionClient(fccConfigFromEnv(env));
  const payload = {
    brief: "Beacon policy evaluate — amount cap",
    serviceId: "desk",
    amountUsdt0,
    amountCapUsdt0: capUsdt0,
    wallet,
    timestamp: Date.now(),
  };

  let fcc: {
    txHash: string;
    instructionId: string;
    status: number;
    log?: string | null;
  };
  try {
    fcc = await client.sendEvaluateFit(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (insuff) {
      const reason =
        `Amount ${amountUsdt0} USDT0 exceeds per-trade cap ${capUsdt0} USDT0. ` +
        `Hardware FCC submit failed: ${msg}`;
      result.cards = [
        {
          type: "authorization_receipt",
          title: "Policy DENY",
          allowed: false,
          summary: reason,
          reason,
          amountUsdt0,
          amountCapUsdt0: capUsdt0,
          fccMode: "verified",
          fccAllowed: false,
          flarePrimitive: "Hardware FCC · GCP_AMD_SEV",
        },
      ];
      result.text = `**DENY** — ${amountUsdt0} USDT0 > cap ${capUsdt0} USDT0.\n\n${reason}`;
    }
    return;
  }

  const fccFields = {
    teeSignedStatus: fcc.status,
    fccTxHash: fcc.txHash,
    fccInstructionId: fcc.instructionId,
    fccLog: fcc.log ?? null,
    fccExplorer: explorerTx(fcc.txHash),
    amountUsdt0,
    amountCapUsdt0: capUsdt0,
    fccMode: "verified" as const,
    flarePrimitive: "Hardware FCC · GCP_AMD_SEV" as const,
  };

  if (insuff) {
    const reason =
      `Amount ${amountUsdt0} USDT0 exceeds per-trade cap ${capUsdt0} USDT0. ` +
      `Hardware TEE signed status ${fcc.status}. No execution.`;
    result.cards = [
      {
        type: "authorization_receipt",
        title: "Hardware FCC DENY",
        allowed: false,
        summary: reason,
        reason,
        fccAllowed: false,
        ...fccFields,
      },
    ];
    result.text =
      `**DENY** — ${amountUsdt0} USDT0 > cap ${capUsdt0} USDT0.\n\n` +
      `Hardware TEE signed **status ${fcc.status}**. No swap. No money moved.\n\n` +
      (fccFields.fccExplorer ? `Explorer: ${fccFields.fccExplorer}` : `tx ${fcc.txHash}`);
    return;
  }

  if (quote && fcc.status === 1) {
    Object.assign(quote, fccFields, { fccAllowed: true });
  }
}
