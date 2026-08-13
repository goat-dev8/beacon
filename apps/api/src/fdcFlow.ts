import type { Redis } from "@upstash/redis";
import { createAttestationAdapter, type AttestationPersistShape } from "@beacon/flare";
import type { AgentChatResult, BeaconEnv } from "@beacon/shared";

const FDC_KEY = (id: string) => `flare:fdc:${id}`;
const TX_EXPLORER = "https://coston2-explorer.flare.network/tx/";
const ROUND_EXPLORER = (round: number) =>
  `https://coston2-systems-explorer.flare.network/voting-round/${round}?tab=fdc`;
const ATTESTATION_EXPLORER = "https://coston2-systems-explorer.flare.network/attestation-request";

function fdcCard(result: AgentChatResult) {
  return result.cards.find((c) => c.type === "fdc_receipt");
}

function applyAttestation(
  result: AgentChatResult,
  att: AttestationPersistShape,
  addressStr: string,
  extraHonesty?: string,
) {
  const card = fdcCard(result);
  if (!card || card.type !== "fdc_receipt") return;
  const verified = att.onChainVerified === true;
  const isValid =
    att.verification && verified
      ? ((att.proof as { response?: { responseBody?: { isValid?: boolean } } } | undefined)?.response
          ?.responseBody?.isValid ?? null)
      : null;
  card.pendingSubmit = false;
  card.pendingCheck = false;
  card.lifecycle = att.lifecycle;
  card.requestId = att.requestId || card.requestId;
  card.txHash = att.txHash ?? card.txHash;
  card.votingRound = att.votingRound ?? card.votingRound;
  card.txExplorer = att.txHash ? `${TX_EXPLORER}${att.txHash}` : card.txExplorer ?? null;
  card.roundExplorer = att.votingRound ? ROUND_EXPLORER(att.votingRound) : card.roundExplorer ?? null;
  card.attestationExplorer = ATTESTATION_EXPLORER;
  card.onChainVerified = att.onChainVerified;
  card.isValid = isValid;
  card.honesty =
    extraHonesty ??
    (verified
      ? "DA proof retrieved. FdcVerification.verifyAddressValidity staticCall returned true. Honesty: VERIFIED."
      : att.error
        ? att.error
        : att.lifecycle === "Submitted"
          ? "FdcHub requestAttestation confirmed. Wait until the voting round is FINALIZED, then type Check FDC proof."
          : card.honesty);

  result.state = {
    ...result.state,
    fdcRequestId: att.requestId || result.state.fdcRequestId,
    fdcAddress: addressStr,
    fdcTxHash: att.txHash ?? result.state.fdcTxHash,
    fdcVotingRound: att.votingRound ?? result.state.fdcVotingRound,
  };

  if (verified) {
    result.text =
      `**FDC VERIFIED** — AddressValidity for \`${addressStr}\`.\n\n` +
      `Voting round **${att.votingRound}** FINALIZED. \`verifyAddressValidity\` = true.\n\n` +
      (card.roundExplorer ? `Round: ${card.roundExplorer}\n` : "") +
      (card.txExplorer ? `FdcHub tx: ${card.txExplorer}` : "");
  } else if (att.txHash) {
    result.text =
      `**FDC submitted** — AddressValidity for \`${addressStr}\`.\n\n` +
      `FdcHub tx: ${card.txExplorer}\n` +
      (att.votingRound != null ? `Voting round **${att.votingRound}**: ${card.roundExplorer}\n\n` : "\n") +
      `Wait until the round is **FINALIZED** (~90s–3min), then type **Check FDC proof**.`;
  } else if (att.error) {
    result.text = `FDC ${att.lifecycle}: ${att.error}`;
  }
}

/**
 * Flow FDC: prepare+submit AddressValidity on the prove turn; fetch DA + on-chain
 * verify on Check FDC proof. Never invents a proof.
 */
export async function attachFdcFlow(
  result: AgentChatResult,
  env: BeaconEnv,
  redis: Redis | null,
): Promise<void> {
  const card = fdcCard(result);
  if (!card || card.type !== "fdc_receipt") return;

  const adapter = createAttestationAdapter(env);
  const addressStr = card.addressStr;

  if (card.pendingCheck) {
    const requestId = card.requestId ?? result.state.fdcRequestId;
    if (!requestId) {
      card.pendingCheck = false;
      card.honesty = "No FDC request in this chat yet. Type: Prove XRPL address with FDC";
      result.text = card.honesty;
      return;
    }
    let stored: AttestationPersistShape | null = redis
      ? await redis.get<AttestationPersistShape>(FDC_KEY(requestId))
      : null;
    if (!stored) {
      stored = {
        requestId,
        kind: "AddressValidity",
        source: "xrp",
        votingRound: card.votingRound ?? result.state.fdcVotingRound,
        txHash: card.txHash ?? result.state.fdcTxHash,
        lifecycle: "Submitted",
        status: "REAL",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
    const proof = await adapter.fetchProof(stored, { verifyOnChain: true });
    if (redis && proof.requestId) {
      await redis.set(FDC_KEY(proof.requestId), proof, { ex: 60 * 60 * 48 });
    }
    applyAttestation(
      result,
      proof,
      addressStr,
      proof.onChainVerified
        ? undefined
        : proof.error
          ? `${proof.error} Open the voting-round FDC tab and wait until FINALIZED, then check again.`
          : "Proof not available yet. Open the round, wait for FINALIZED, then Check FDC proof.",
    );
    return;
  }

  if (!card.pendingSubmit) return;

  const prepared = await adapter.prepare({
    kind: "AddressValidity",
    source: "xrp",
    payload: { addressStr },
  });
  if (!prepared.requestId) {
    applyAttestation(result, prepared, addressStr, prepared.error);
    return;
  }
  const submitted = await adapter.submit(prepared);
  if (redis && submitted.requestId) {
    await redis.set(FDC_KEY(submitted.requestId), submitted, { ex: 60 * 60 * 48 });
  }
  applyAttestation(result, submitted, addressStr);
}
