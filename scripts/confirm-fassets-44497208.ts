/**
 * Confirm FAssets redemption 44497208 after XRPL payment was detected.
 * Flow: reuse FDC Payment proof (or re-attest) → AssetManager.confirmRedemptionPayment
 *
 * Only callable by agent owner OR anyone after confirmationByOthersAfterSeconds (60s on Coston2).
 * Never invents COMPLETE without RedemptionPerformed.
 */
import "dotenv/config";
import { AbiCoder, Contract, Interface, JsonRpcProvider, Wallet } from "ethers";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { FdcClient, preparePaymentRequest } from "../packages/fdc/src/index.ts";

const AM = "0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA";
const REQUEST_ID = 44497208n;
const XRPL_TX = "2C0889111F1B352AFB17E1DA28F548FBD492541113229ABA6B4A25B8E1A1E11A";
const EXPECTED_REF = "0x4642505266410002000000000000000000000000000000000000000002a6f938";
const EXPECTED_RECEIVED = 4975000n;

/** Prefer already-finalized round from prior successful attestation (avoids waiting another FDC epoch). */
const KNOWN_ROUND = Number(process.env.FASSETS_FDC_ROUND || "1421037");

const PAYMENT_RESPONSE_ABI =
  "tuple(bytes32 attestationType, bytes32 sourceId, uint64 votingRound, uint64 lowestUsedTimestamp, tuple(bytes32 transactionId, uint256 inUtxo, uint256 utxo) requestBody, tuple(uint64 blockNumber, uint64 blockTimestamp, bytes32 sourceAddressHash, bytes32 sourceAddressesRoot, bytes32 receivingAddressHash, bytes32 intendedReceivingAddressHash, int256 spentAmount, int256 intendedSpentAmount, int256 receivedAmount, int256 intendedReceivedAmount, bytes32 standardPaymentReference, bool oneToOne, uint8 status) responseBody)";

const CONFIRM_ABI = [
  `function confirmRedemptionPayment(
    tuple(
      bytes32[] merkleProof,
      tuple(
        bytes32 attestationType,
        bytes32 sourceId,
        uint64 votingRound,
        uint64 lowestUsedTimestamp,
        tuple(bytes32 transactionId, uint256 inUtxo, uint256 utxo) requestBody,
        tuple(
          uint64 blockNumber,
          uint64 blockTimestamp,
          bytes32 sourceAddressHash,
          bytes32 sourceAddressesRoot,
          bytes32 receivingAddressHash,
          bytes32 intendedReceivingAddressHash,
          int256 spentAmount,
          int256 intendedSpentAmount,
          int256 receivedAmount,
          int256 intendedReceivedAmount,
          bytes32 standardPaymentReference,
          bool oneToOne,
          uint8 status
        ) responseBody
      ) data
    ) _payment,
    uint256 _redemptionRequestId
  )`,
  "event RedemptionPerformed(address indexed agentVault, address indexed redeemer, uint64 indexed requestId, bytes32 transactionHash, uint256 redemptionAmountUBA, int256 spentUnderlyingUBA)",
];

function asBytes32(hex: string): string {
  const h = hex.replace(/^0x/i, "").toLowerCase();
  return "0x" + h.padStart(64, "0");
}

function decodePaymentResponseHex(responseHex: string) {
  const hex = responseHex.startsWith("0x") ? responseHex : `0x${responseHex}`;
  const decoded = AbiCoder.defaultAbiCoder().decode([PAYMENT_RESPONSE_ABI], hex);
  const row = decoded[0] as {
    attestationType: string;
    sourceId: string;
    votingRound: bigint;
    lowestUsedTimestamp: bigint;
    requestBody: { transactionId: string; inUtxo: bigint; utxo: bigint };
    responseBody: {
      blockNumber: bigint;
      blockTimestamp: bigint;
      sourceAddressHash: string;
      sourceAddressesRoot: string;
      receivingAddressHash: string;
      intendedReceivingAddressHash: string;
      spentAmount: bigint;
      intendedSpentAmount: bigint;
      receivedAmount: bigint;
      intendedReceivedAmount: bigint;
      standardPaymentReference: string;
      oneToOne: boolean;
      status: number;
    };
  };
  return row;
}

async function main() {
  const submit = String(process.env.FASSETS_CONFIRM_SUBMIT || "true").toLowerCase() !== "false";
  const reuseOnly = String(process.env.FASSETS_REUSE_PROOF || "true").toLowerCase() !== "false";
  const key = process.env.DEPLOYER_PRIVATE_KEY || process.env.SETTLER_PRIVATE_KEY;
  if (!key) throw new Error("DEPLOYER/SETTLER key missing");

  const rpc = process.env.COSTON2_RPC_URL!;
  const provider = new JsonRpcProvider(rpc);
  const wallet = new Wallet(key, provider);

  const txId = asBytes32(XRPL_TX);
  const prepared = preparePaymentRequest({
    transactionId: txId,
    sourceId: "testXRP",
    inUtxo: "0",
    utxo: "0",
  });

  const client = new FdcClient({
    rpcUrl: rpc,
    privateKey: key,
    verifierBaseUrl:
      process.env.FDC_VERIFIER_BASE_URL ||
      "https://fdc-verifiers-testnet.flare.network",
    apiKey: process.env.FDC_API_KEY || "00000000-0000-0000-0000-000000000000",
    daLayerUrl: process.env.DA_LAYER_URL || "https://ctn2-data-availability.flare.network",
    contractRegistry:
      process.env.FLARE_CONTRACT_REGISTRY || "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019",
  });

  console.log(JSON.stringify({ phase: "fdc_prepare", txId, attestation: prepared.attestationType, reuseOnly, knownRound: KNOWN_ROUND }));

  const prep = await client.prepareRequest("Payment", "testXRP", {
    transactionId: prepared.requestBody.transactionId,
    inUtxo: prepared.requestBody.inUtxo,
    utxo: prepared.requestBody.utxo,
  });
  if (!prep.ok || !prep.abiEncodedRequest) {
    throw new Error(`prepareRequest failed: ${prep.error || prep.status}`);
  }

  let merkleProof: string[] = [];
  let responseHex: string | undefined;
  let roundId = KNOWN_ROUND;
  let fdcSubmitTx: string | undefined = "0x2ad2a78adea0bd583e3dcd74a27609ba83ace9d704661c0b69ff3e6b9f78ed9c";

  if (reuseOnly) {
    const proofResult = await client.fetchProofWithRetry(prep.abiEncodedRequest, KNOWN_ROUND, 4, 3_000);
    if (!proofResult.ok || !proofResult.responseHex) {
      throw new Error(`reuse proof failed for round ${KNOWN_ROUND}: ${proofResult.error}`);
    }
    merkleProof = proofResult.proof ?? [];
    responseHex = proofResult.responseHex;
    roundId = KNOWN_ROUND;
    console.log(JSON.stringify({ phase: "reuse_proof", roundId, merkleLen: merkleProof.length }));
  } else {
    const lifecycle = await client.runFullAttestationLifecycle(
      "Payment",
      "testXRP",
      {
        transactionId: prepared.requestBody.transactionId,
        inUtxo: prepared.requestBody.inUtxo,
        utxo: prepared.requestBody.utxo,
      },
      { waitTimeoutMs: 300_000, proofRetries: 12, verifyOnChain: false },
    );
    if (!lifecycle.ok || !lifecycle.responseHex) {
      const out = {
        ok: false,
        stage: lifecycle.stage,
        error: lifecycle.error,
        txHash: lifecycle.txHash,
        roundId: lifecycle.roundId,
        honesty: "FDC Payment attestation failed — cannot confirm redemption yet",
      };
      writeFileSync("docs/evidence/fassets-confirm-44497208.json", JSON.stringify(out, null, 2));
      console.log(JSON.stringify(out, null, 2));
      process.exit(1);
    }
    merkleProof = (lifecycle.proof as string[]) ?? [];
    responseHex = lifecycle.responseHex;
    roundId = Number(lifecycle.roundId);
    fdcSubmitTx = lifecycle.txHash;
  }

  const data = decodePaymentResponseHex(responseHex!);
  const paymentProof = {
    merkleProof,
    data: {
      attestationType: data.attestationType,
      sourceId: data.sourceId,
      votingRound: data.votingRound,
      lowestUsedTimestamp: data.lowestUsedTimestamp,
      requestBody: {
        transactionId: asBytes32(String(data.requestBody.transactionId)),
        inUtxo: data.requestBody.inUtxo,
        utxo: data.requestBody.utxo,
      },
      responseBody: {
        blockNumber: data.responseBody.blockNumber,
        blockTimestamp: data.responseBody.blockTimestamp,
        sourceAddressHash: data.responseBody.sourceAddressHash,
        sourceAddressesRoot: data.responseBody.sourceAddressesRoot,
        receivingAddressHash: data.responseBody.receivingAddressHash,
        intendedReceivingAddressHash: data.responseBody.intendedReceivingAddressHash,
        spentAmount: data.responseBody.spentAmount,
        intendedSpentAmount: data.responseBody.intendedSpentAmount,
        receivedAmount: data.responseBody.receivedAmount,
        intendedReceivedAmount: data.responseBody.intendedReceivedAmount,
        standardPaymentReference: data.responseBody.standardPaymentReference,
        oneToOne: Boolean(data.responseBody.oneToOne),
        status: Number(data.responseBody.status),
      },
    },
  };

  const refOk =
    paymentProof.data.responseBody.standardPaymentReference.toLowerCase() ===
    EXPECTED_REF.toLowerCase();
  const amountOk = paymentProof.data.responseBody.receivedAmount === EXPECTED_RECEIVED;
  const statusOk = paymentProof.data.responseBody.status === 0;

  const precheck = {
    refOk,
    amountOk,
    statusOk,
    receivedAmount: paymentProof.data.responseBody.receivedAmount.toString(),
    spentAmount: paymentProof.data.responseBody.spentAmount.toString(),
    standardPaymentReference: paymentProof.data.responseBody.standardPaymentReference,
    blockNumber: paymentProof.data.responseBody.blockNumber.toString(),
    fdcRound: roundId,
    fdcSubmitTx,
    votingRound: paymentProof.data.votingRound.toString(),
  };

  writeFileSync(
    "docs/evidence/fassets-confirm-precheck.json",
    JSON.stringify({ precheck, responseHexPreview: responseHex!.slice(0, 80) }, null, 2),
  );

  if (!refOk || !amountOk || !statusOk) {
    const out = {
      ok: false,
      phase: "proof_precheck_failed",
      precheck,
      honesty: "FDC Payment proof does not match expected redemption payment fields",
    };
    writeFileSync("docs/evidence/fassets-confirm-44497208.json", JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
    process.exit(1);
  }

  if (!submit) {
    console.log(JSON.stringify({ ok: true, dryRun: true, precheck }, null, 2));
    return;
  }

  console.log(JSON.stringify({ phase: "confirmRedemptionPayment", requestId: REQUEST_ID.toString(), from: wallet.address }));

  const am = new Contract(AM, CONFIRM_ABI, wallet);
  const tx = await am.confirmRedemptionPayment(paymentProof, REQUEST_ID);
  const rc = await tx.wait();

  let performed: Record<string, unknown> | null = null;
  const iface = new Interface(CONFIRM_ABI);
  for (const log of rc?.logs ?? []) {
    try {
      const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === "RedemptionPerformed") {
        performed = {
          agentVault: String(parsed.args.agentVault),
          redeemer: String(parsed.args.redeemer),
          requestId: parsed.args.requestId.toString(),
          xrplTransactionHash: String(parsed.args.transactionHash),
          redemptionAmountUBA: parsed.args.redemptionAmountUBA.toString(),
          spentUnderlyingUBA: parsed.args.spentUnderlyingUBA.toString(),
        };
      }
    } catch {
      /* other logs */
    }
  }

  const out = {
    ok: true,
    lifecycle: performed ? "COMPLETED" : "CONFIRM_TX_MINED_PARSE_PENDING",
    confirmTx: tx.hash,
    confirmStatus: rc?.status,
    explorer: `https://coston2-explorer.flare.network/tx/${tx.hash}`,
    precheck,
    performed,
    fdc: {
      roundId,
      submitTx: fdcSubmitTx,
      explorerSubmit: fdcSubmitTx
        ? `https://coston2-explorer.flare.network/tx/${fdcSubmitTx}`
        : null,
      responseHexLen: responseHex!.length,
      merkleProofLen: merkleProof.length,
    },
    xrpl: {
      hash: XRPL_TX,
      explorer: `https://testnet.xrpl.org/transactions/${XRPL_TX}`,
    },
    requestId: REQUEST_ID.toString(),
    honesty: performed
      ? "COMPLETED: confirmRedemptionPayment emitted RedemptionPerformed with XRPL hash"
      : "confirmRedemptionPayment mined — verify RedemptionPerformed in receipt/logs",
    timestamp: new Date().toISOString(),
  };

  writeFileSync("docs/evidence/fassets-confirm-44497208.json", JSON.stringify(out, null, 2));

  try {
    const path = "docs/evidence/fassets-redemption-44497208.json";
    const prev = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
    writeFileSync(
      path,
      JSON.stringify(
        {
          ...prev,
          lifecycle: out.lifecycle === "COMPLETED" ? "COMPLETED" : prev.lifecycle,
          confirmRedemptionPayment: out,
          RedemptionPerformed: performed,
          updatedAt: new Date().toISOString(),
          honesty:
            out.lifecycle === "COMPLETED"
              ? "COMPLETED with XRPL payment + FDC Payment proof + confirmRedemptionPayment / RedemptionPerformed"
              : prev.honesty,
        },
        null,
        2,
      ),
    );
  } catch {
    /* */
  }

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(String(e).slice(0, 1200));
  process.exit(1);
});
