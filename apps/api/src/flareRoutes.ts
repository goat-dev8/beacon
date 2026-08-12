/**
 * Flare-native API routes: FTSO guard, FDC attestation, FCC shadow, evidence.
 * Honesty labels: REAL / SIMULATED / NOT_AVAILABLE / STUB — never invent proofs.
 */
import type { FastifyInstance } from "fastify";
import type { Redis } from "@upstash/redis";
import { z } from "zod";
import {
  AppError,
  loadEnv,
  readFtsoFeeds,
  evaluateFtsoGuard,
  FTSO_GUARD_DEFAULTS,
  resolveFccMode,
  honestyMessage,
} from "@beacon/shared";
import {
  createAttestationAdapter,
  createConfidentialComputeAdapter,
  createPriceOracleAdapter,
  createEvidenceEnvelope,
  appendEvidenceStage,
  type EvidenceEnvelope,
  type AttestationPersistShape,
} from "@beacon/flare";
import { getFccLifecycleStatus, FccExtensionClient, fccConfigFromEnv } from "@beacon/fdc";
import { evaluatePolicy } from "./policyEvaluator.js";
import { createHash } from "node:crypto";

const FDC_KEY = (id: string) => `flare:fdc:${id}`;
const EVIDENCE_KEY = (id: string) => `flare:evidence:${id}`;

export function registerFlareNativeRoutes(
  app: FastifyInstance,
  redis: Redis | null,
): void {
  const env = loadEnv();

  /** FTSO snapshot + execution-guard evaluation (does not move funds). */
  app.get("/v1/ftso/guard", async (req) => {
    const q = z
      .object({
        symbol: z.string().default("XRP/USD"),
        maxAgeSeconds: z.coerce.number().optional(),
        maxSlippageBps: z.coerce.number().optional(),
        quotedSlippageBps: z.coerce.number().optional(),
        referencePrice: z.coerce.number().optional(),
        maxDeviationBps: z.coerce.number().optional(),
      })
      .parse(req.query ?? {});

    const snap = await readFtsoFeeds(env);
    const guard = evaluateFtsoGuard(snap.feeds, {
      feedSymbol: q.symbol,
      maxAgeSeconds: q.maxAgeSeconds ?? FTSO_GUARD_DEFAULTS.maxAgeSeconds,
      maxSlippageBps: q.maxSlippageBps ?? FTSO_GUARD_DEFAULTS.maxSlippageBps,
      quotedSlippageBps: q.quotedSlippageBps,
      referencePrice: q.referencePrice,
      maxDeviationBps: q.maxDeviationBps ?? FTSO_GUARD_DEFAULTS.maxDeviationBps,
    });

    return {
      status: "REAL" as const,
      honesty: "Live market data from FTSOv2 via ContractRegistry — used to protect Safe swaps.",
      ftsoV2: snap.ftsoV2,
      timestamp: snap.timestamp,
      feeds: snap.feeds,
      guard,
      defaults: FTSO_GUARD_DEFAULTS,
      docs: ["https://dev.flare.network/ftso/overview"],
    };
  });

  /** FCC shadow authorization — cannot move funds. */
  app.get("/v1/fcc/shadow", async () => {
    const adapter = createConfidentialComputeAdapter(env);
    const info = adapter.getStatus();
    return {
      ...info,
      canMoveFunds: false as const,
      canAuthorize: adapter.canAuthorize(),
      honesty: honestyMessage(env.SIMULATED_TEE, resolveFccMode(process.env, env.SIMULATED_TEE)),
      docs: adapter.getDocs(),
    };
  });

  app.post("/v1/fcc/shadow/evaluate", async (req) => {
    const body = z
      .object({
        actionHash: z.string().min(8),
        policyHash: z.string().min(8),
        policyEpoch: z.number().int().optional(),
        nonce: z.string().min(4),
        allow: z.boolean(),
        reasonCommitment: z.string().optional(),
        validAfter: z.string().optional(),
        validBefore: z.string().optional(),
      })
      .parse(req.body ?? {});

    const adapter = createConfidentialComputeAdapter(env);
    const result = adapter.evaluateShadowAuthorization(body);
    return {
      ...result,
      compareNote:
        "Shadow FCC result is for comparison with server policy only. It never authorizes on-chain spend.",
    };
  });

  /**
   * FCC Lifecycle Status — honest reporting of InstructionSender, extension, proxy, TEE machine.
   * canMoveFunds: false ALWAYS until a polled TEE result is verified (never faked).
   * teeProduction (status===2) is hardware Confidential Space only when hardwareClaim is true.
   */
  app.get("/v1/fcc/lifecycle", async () => {
    const status = await getFccLifecycleStatus(env);
    return {
      ...status,
      daLayerNote: `Correct DA base: https://ctn2-data-availability.flare.network/ — proof endpoint: /api/v1/fdc/proof-by-request-round-raw`,
      evidence: {
        teeProduction: "docs/evidence/fcc-tee-production.json",
        fdcAddressValidity: "docs/evidence/fdc-address-validity-verify.json",
      },
    };
  });

  /**
   * FCC Policy Evaluation — Beacon value-protection (agent payout / amount cap / recipient / expiry).
   *
   * ALWAYS returns clear ALLOW | DENY for the value-protection decision.
   * NEVER claims funds moved. canMoveFunds stays false until TEE result is polled+verified.
   * On-chain FCC instruction submit is opt-in (`submitInstruction: true`) so Jobs/Chat/Safe are not hit with gas.
   */
  app.post("/v1/fcc/policy/evaluate", async (req) => {
    const body = z
      .object({
        wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/i).optional(),
        actionHash: z.string().min(8),
        amountUsdt0: z.number().optional(),
        /** Value-protection amount cap (DENY when amountUsdt0 > amountCapUsdt0). */
        amountCapUsdt0: z.number().positive().optional(),
        /** Required recipient for agent payout use case. */
        recipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/i).optional(),
        /** Unix seconds — DENY when now >= expiresAt. */
        expiresAt: z.number().int().positive().optional(),
        agentId: z.string().optional(),
        useCase: z
          .enum(["agent_payout", "amount_cap", "recipient_gate", "expiry_gate", "generic"])
          .default("agent_payout"),
        allowHint: z.boolean().optional(),
        /** Opt-in: submit on-chain FCC instruction (costs gas). Default false. */
        submitInstruction: z.boolean().optional().default(false),
      })
      .parse(req.body ?? {});

    const nowSec = Math.floor(Date.now() / 1000);
    const valueProtectionChecks: Record<string, unknown> = {
      useCase: body.useCase,
      amountUsdt0: body.amountUsdt0 ?? null,
      amountCapUsdt0: body.amountCapUsdt0 ?? null,
      recipient: body.recipient?.toLowerCase() ?? null,
      expiresAt: body.expiresAt ?? null,
      nowSec,
    };
    const denyReasons: string[] = [];

    if (body.amountCapUsdt0 != null) {
      const amount = body.amountUsdt0 ?? 0;
      const underCap = amount <= body.amountCapUsdt0;
      valueProtectionChecks.underAmountCap = underCap;
      if (!underCap) {
        denyReasons.push(
          `Amount ${amount} USDT0 exceeds cap ${body.amountCapUsdt0} USDT0`,
        );
      }
    }

    if (body.useCase === "agent_payout" || body.useCase === "recipient_gate") {
      const hasRecipient = Boolean(body.recipient);
      valueProtectionChecks.recipientPresent = hasRecipient;
      if (!hasRecipient) {
        denyReasons.push("Recipient required for agent payout / recipient gate");
      }
    }

    if (body.expiresAt != null) {
      const notExpired = nowSec < body.expiresAt;
      valueProtectionChecks.notExpired = notExpired;
      if (!notExpired) {
        denyReasons.push(`Policy expired at ${body.expiresAt} (now ${nowSec})`);
      }
    }

    // 1. Always run server policy first
    const serverPolicy = await evaluatePolicy(redis, {
      wallet: body.wallet,
      agentId: body.agentId,
      amountUsdt0: body.amountUsdt0,
    });

    if (!serverPolicy.allowed) {
      denyReasons.push(serverPolicy.reason);
    }

    const valueProtectionDecision: "ALLOW" | "DENY" =
      denyReasons.length === 0 ? "ALLOW" : "DENY";

    // 2. Shadow FCC authorization (for comparison only — cannot move funds)
    const fccAdapter = createConfidentialComputeAdapter(env);
    const shadowFcc = fccAdapter.evaluateShadowAuthorization({
      actionHash: body.actionHash,
      policyHash: `v${serverPolicy.policyVersion}:${serverPolicy.fccMode}:${body.useCase}`,
      nonce: `${Date.now()}`,
      allow: body.allowHint ?? (valueProtectionDecision === "ALLOW"),
      reasonCommitment:
        valueProtectionDecision === "ALLOW" ? "value_protection_allow" : denyReasons.join("; "),
      validBefore: body.expiresAt != null ? String(body.expiresAt) : undefined,
    });

    // 3. Lifecycle (TEE PRODUCTION + instruction path honesty)
    const fccLifecycle = await getFccLifecycleStatus(env);

    // 4. Optional on-chain instruction — never fakes a verified TEE result
    let onChainInstruction: {
      txHash: string;
      instructionId: string;
      status: string;
      partial: boolean;
      resultPolled: boolean;
      resultVerified: false;
    } | null = null;

    let teeResultVerified = false;

    if (
      body.submitInstruction &&
      valueProtectionDecision === "ALLOW" &&
      fccLifecycle.extProxyConfigured &&
      fccLifecycle.instructionSenderHasBytecode
    ) {
      try {
        const fccConfig = fccConfigFromEnv(env);
        const fccClient = new FccExtensionClient(fccConfig);
        const caps = await fccClient.probeContractCapabilities();

        if (caps.hasSendEvaluateFit || caps.hasSendSayHello) {
          const payload = {
            useCase: body.useCase,
            wallet: body.wallet ?? "unknown",
            actionHash: body.actionHash,
            amountUsdt0: body.amountUsdt0 ?? 0,
            amountCapUsdt0: body.amountCapUsdt0 ?? null,
            recipient: body.recipient ?? null,
            expiresAt: body.expiresAt ?? null,
            agentId: body.agentId ?? "unknown",
            serverPolicyAllowed: serverPolicy.allowed,
            valueProtectionDecision,
            timestamp: Date.now(),
          };

          try {
            const result = await fccClient.sendEvaluateFit(payload);
            // sendAndWait polls result — if we got here, poll succeeded
            teeResultVerified = result.status === 0;
            onChainInstruction = {
              txHash: result.txHash,
              instructionId: result.instructionId,
              status: result.status === 0 ? "success" : `status_${result.status}`,
              partial: !caps.hasSendEvaluateFit,
              resultPolled: true,
              resultVerified: false, // Beacon still does not claim TEE-verified fund authority
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            onChainInstruction = {
              txHash: "",
              instructionId: "",
              status: msg.includes("Timed out") || msg.includes("last HTTP")
                ? "result_poll_PARTIAL"
                : "instruction_failed",
              partial: true,
              resultPolled: false,
              resultVerified: false,
            };
            teeResultVerified = false;
          }
        }
      } catch {
        // FCC config error — continue with shadow only
      }
    }

    // Funds never move from this endpoint. Even after a successful poll, FCC does not unlock spend.
    const canMoveFunds = false as const;

    const response = {
      useCase: body.useCase,
      valueProtection: {
        decision: valueProtectionDecision,
        allow: valueProtectionDecision === "ALLOW",
        deny: valueProtectionDecision === "DENY",
        reasons: denyReasons,
        checks: valueProtectionChecks,
        canMoveFunds,
        teeResultVerified,
        note:
          valueProtectionDecision === "ALLOW"
            ? "ALLOW — server/value-protection checks passed. Funds not moved; FCC result not treated as spend authority."
            : `DENY — ${denyReasons.join("; ")}`,
      },
      serverPolicy: {
        allowed: serverPolicy.allowed,
        reason: serverPolicy.reason,
        policyVersion: serverPolicy.policyVersion,
        enforcement: serverPolicy.enforcement,
        fccMode: serverPolicy.fccMode,
        checks: serverPolicy.checks,
      },
      shadowFcc: {
        status: shadowFcc.status,
        mode: shadowFcc.mode,
        allow: shadowFcc.authorization.allow,
        canMoveFunds: shadowFcc.canMoveFunds,
        honestyLabel: shadowFcc.honestyLabel,
        authorization: shadowFcc.authorization,
      },
      tee: {
        teeId: fccLifecycle.teeId,
        flareTeeManager: fccLifecycle.flareTeeManager,
        teeMachineStatus: fccLifecycle.teeMachineStatus,
        teeMachineStatusLabel: fccLifecycle.teeMachineStatusLabel,
        teeProduction: fccLifecycle.teeProduction,
        simulatedTee: fccLifecycle.simulatedTee,
        attestationKind: fccLifecycle.attestationKind,
        instructionPath: fccLifecycle.instructionPath,
        extProxyEphemeral: fccLifecycle.extProxyEphemeral,
      },
      onChainInstruction,
      honesty: {
        serverPolicy: "REAL — Redis-backed spend accounting with fail-closed on unavailable",
        valueProtection:
          valueProtectionDecision === "ALLOW"
            ? "ALLOW path clear — still canMoveFunds:false until separate Safe/x402 rails execute under their own gates"
            : "DENY path clear — spend must not proceed on this decision",
        shadowFcc: fccLifecycle.mode === "simulated"
          ? "SIMULATED_TEE — hackathon-accepted, NOT hardware-attested"
          : fccLifecycle.mode === "unavailable"
            ? "NOT_AVAILABLE — FCC not configured"
            : "REAL — hardware-backed GCP Confidential Space (AMD SEV); still canMoveFunds:false",
        teeMachine:
          fccLifecycle.teeProduction
            ? fccLifecycle.hardwareClaim
              ? `PRODUCTION (status=2) hardware TEE ${fccLifecycle.teeId} platform=${fccLifecycle.platformAscii} codeHash=${fccLifecycle.codeHash}`
              : fccLifecycle.simulatedTee
                ? "PRODUCTION (status=2) via SIMULATED_TEE availability attestation — NOT GCP Confidential Space hardware"
                : "PRODUCTION (status=2) reported — hardwareClaim false until /info proves GCP_AMD_SEV + measured codeHash"
            : fccLifecycle.teeMachineStatus != null
              ? `teeMachineStatus=${fccLifecycle.teeMachineStatus} (${fccLifecycle.teeMachineStatusLabel}) — not PRODUCTION`
              : "TEE machine status not probed",
        onChainFcc: onChainInstruction
          ? onChainInstruction.resultPolled
            ? onChainInstruction.partial
              ? "PARTIAL — instruction+poll via sendSayHello fallback; not TEE-verified fund authority"
              : "PARTIAL — instruction result polled; canMoveFunds still false (no fake TEE verified spend)"
            : "PARTIAL — instruction submit and/or result poll incomplete (e.g. poll 404)"
          : body.submitInstruction
            ? fccLifecycle.blockers.length > 0
              ? `NOT_AVAILABLE — ${fccLifecycle.blockers.join("; ")}`
              : "NOT_ATTEMPTED"
            : "NOT_SUBMITTED — pass submitInstruction:true to attempt on-chain FCC (opt-in)",
        fundsMoved: "NEVER — this endpoint does not move funds",
        hardwareClaim: fccLifecycle.hardwareClaim
          ? "true — /info reports GCP_AMD_SEV with measured codeHash; FCC still cannot move funds"
          : "false — Beacon does not claim hardware Confidential Space while SIMULATED_TEE or without attestation chain",
        canMoveFunds: "false — kept false until result verified; never faked",
      },
      daLayerNote: "Correct DA base: https://ctn2-data-availability.flare.network/ — proof path: /api/v1/fdc/proof-by-request-round-raw",
      docs: [
        "https://dev.flare.network/fcc/overview",
        "https://dev.flare.network/fcc/developer-guides",
      ],
    };

    return response;
  });

  /** FDC attestation lifecycle — REAL only when verifier URLs work; never fake proofs. */
  app.get("/v1/fdc/status", async () => {
    const adapter = createAttestationAdapter(env);
    const xrp = adapter.isAvailable("xrp");
    const evm = adapter.isAvailable("evm");
    const canSubmit = adapter.canSubmit();

    // DA Layer configuration with correct URL documentation
    const daLayerUrl = env.DA_LAYER_URL || "https://ctn2-data-availability.flare.network";
    const daLayerConfigured = Boolean(env.DA_LAYER_URL || env.DA_LAYER_API_URL);

    return {
      status: xrp || evm ? ("REAL" as const) : ("NOT_AVAILABLE" as const),
      xrpVerifierConfigured: xrp,
      evmVerifierConfigured: evm,
      daLayerConfigured,
      daLayer: {
        baseUrl: daLayerUrl,
        proofEndpoint: "/api/v1/fdc/proof-by-request-round-raw",
        legacyEndpoint: "/api/v0/fdc/get-proof-round-id-bytes",
        note: "Use v1 endpoint for new integrations. Base URL should be https://ctn2-data-availability.flare.network/ (no trailing /api/v0)",
      },
      canSubmitOnChain: canSubmit,
      lifecycle: {
        prepareAvailable: xrp || evm,
        submitAvailable: canSubmit,
        waitFinalizedAvailable: true,
        fetchProofAvailable: daLayerConfigured,
        onChainVerifyNote:
          "On-chain verification via FdcVerification requires encoding the Proof struct. The API can fetch proofs but typed verification needs contract interaction.",
      },
      supportedTypes: ["AddressValidity", "EVMTransaction", "Payment", "Web2Json"],
      supportedSources: {
        xrp: ["testXRP", "testBTC", "testDOGE", "XRP", "BTC", "DOGE"],
        evm: ["testETH", "testFLR", "ETH", "FLR", "SGB"],
      },
      honesty: xrp || evm
        ? "FDC verifier endpoints configured — prepare/submit talk to official verifier URLs. Proofs are never invented."
        : "FDC verifier URLs not configured — attestation API returns NOT_AVAILABLE. Flow does not silently fake FDC.",
      docs: [
        "https://dev.flare.network/fdc/overview",
        "https://dev.flare.network/fdc/getting-started",
        "https://dev.flare.network/fdc/guides/hardhat/address-validity",
      ],
    };
  });

  app.post("/v1/fdc/prepare", async (req) => {
    const body = z
      .object({
        kind: z.enum(["Payment", "EVMTransaction", "Web2Json", "AddressValidity"]),
        source: z.enum(["xrp", "evm"]),
        payload: z.record(z.string(), z.unknown()).default({}),
        jobId: z.string().optional(),
        runOnChain: z.boolean().optional().default(false),
        waitTimeoutMs: z.number().optional(),
      })
      .parse(req.body ?? {});

    const adapter = createAttestationAdapter(env);

    // If runOnChain is true, run the full FDC lifecycle
    if (body.runOnChain) {
      const result = await adapter.runFullLifecycle(
        { kind: body.kind, source: body.source, payload: body.payload },
        { waitTimeoutMs: body.waitTimeoutMs, skipOnChain: false },
      );

      if (redis && result.requestId) {
        await redis.set(FDC_KEY(result.requestId), result, { ex: 60 * 60 * 48 });
      }

      if (redis && body.jobId) {
        let envelope = createEvidenceEnvelope({ jobId: body.jobId });
        envelope = appendEvidenceStage(envelope, "fdc_full_lifecycle", {
          status: result.status,
          hash: result.requestId || undefined,
          payload: {
            lifecycle: result.lifecycle,
            txHash: result.txHash,
            votingRound: result.votingRound,
            hasProof: Boolean(result.proof),
          },
        });
        if (result.requestId) {
          envelope.fdcProof = {
            requestId: result.requestId,
            attestationType: result.kind,
            timestamp: result.createdAt,
            txHash: result.txHash,
            votingRound: result.votingRound,
            proofAvailable: Boolean(result.proof),
          };
        }
        await redis.set(EVIDENCE_KEY(body.jobId), envelope, { ex: 60 * 60 * 48 });
      }

      return {
        ...result,
        fullLifecycle: true,
        onChainVerified: result.onChainVerified,
        fdcVerificationAddress: result.fdcVerificationAddress,
        honesty:
          result.lifecycle === "Verified" && result.onChainVerified
            ? "Full FDC lifecycle complete: prepare → submit → finalize → proof → FdcVerification.verifyAddressValidity (VIEW staticCall) = true. Honesty: VERIFIED."
            : result.lifecycle === "Finalized" && result.proof
              ? result.onChainVerified === false
                ? "DA proof retrieved; on-chain FdcVerification.verifyAddressValidity returned false or failed. Honesty: PARTIAL (not VERIFIED)."
                : "Full FDC lifecycle through DA proof. On-chain verify not performed for this attestation type."
              : `FDC lifecycle reached stage: ${result.lifecycle}. ${result.error ?? ""}`,
      };
    }

    // Standard prepare-only flow
    const result = await adapter.prepare(body);

    if (redis && result.requestId) {
      await redis.set(FDC_KEY(result.requestId), result, { ex: 60 * 60 * 48 });
    }

    if (redis && body.jobId) {
      let envelope = createEvidenceEnvelope({ jobId: body.jobId });
      envelope = appendEvidenceStage(envelope, "fdc_prepare", {
        status: result.status,
        hash: result.requestId || undefined,
        payload: result,
      });
      if (result.requestId) {
        envelope.fdcProof = {
          requestId: result.requestId,
          attestationType: result.kind,
          timestamp: result.createdAt,
        };
      }
      await redis.set(EVIDENCE_KEY(body.jobId), envelope, { ex: 60 * 60 * 48 });
    }

    return result;
  });

  app.post("/v1/fdc/:requestId/submit", async (req) => {
    const requestId = (req.params as { requestId: string }).requestId;
    if (!redis) {
      throw new AppError("VALIDATION", {
        message: "Redis required to persist FDC attestation state.",
        statusCode: 503,
      });
    }
    const stored = await redis.get<AttestationPersistShape>(FDC_KEY(requestId));
    if (!stored) {
      throw new AppError("VALIDATION", {
        message: "Unknown FDC requestId — prepare first, or state expired.",
      });
    }
    const adapter = createAttestationAdapter(env);
    const result = await adapter.submit(stored);
    await redis.set(FDC_KEY(requestId), result, { ex: 60 * 60 * 48 });
    return result;
  });

  /** Wait for round finalization (blocking, with timeout) */
  app.post("/v1/fdc/:requestId/wait", async (req) => {
    const requestId = (req.params as { requestId: string }).requestId;
    const body = z
      .object({
        timeoutMs: z.number().optional().default(180_000),
      })
      .parse(req.body ?? {});

    if (!redis) {
      throw new AppError("VALIDATION", {
        message: "Redis required to persist FDC attestation state.",
        statusCode: 503,
      });
    }
    const stored = await redis.get<AttestationPersistShape>(FDC_KEY(requestId));
    if (!stored) {
      throw new AppError("VALIDATION", {
        message: "Unknown FDC requestId — prepare and submit first.",
      });
    }
    if (!stored.votingRound) {
      throw new AppError("VALIDATION", {
        message: "Attestation not yet submitted — no voting round assigned.",
      });
    }
    const adapter = createAttestationAdapter(env);
    const result = await adapter.waitForFinalization(stored, body.timeoutMs);
    await redis.set(FDC_KEY(requestId), result, { ex: 60 * 60 * 48 });
    return result;
  });

  /** Fetch proof from DA layer */
  app.post("/v1/fdc/:requestId/proof", async (req) => {
    const requestId = (req.params as { requestId: string }).requestId;
    if (!redis) {
      throw new AppError("VALIDATION", {
        message: "Redis required to persist FDC attestation state.",
        statusCode: 503,
      });
    }
    const stored = await redis.get<AttestationPersistShape>(FDC_KEY(requestId));
    if (!stored) {
      throw new AppError("VALIDATION", {
        message: "Unknown FDC requestId — prepare and submit first.",
      });
    }
    if (!stored.votingRound) {
      throw new AppError("VALIDATION", {
        message: "Attestation not yet submitted — no voting round assigned.",
      });
    }
    const adapter = createAttestationAdapter(env);
    const result = await adapter.fetchProof(stored);
    await redis.set(FDC_KEY(requestId), result, { ex: 60 * 60 * 48 });
    return {
      ...result,
      onChainVerified: result.onChainVerified,
      fdcVerificationAddress: result.fdcVerificationAddress,
      honesty: result.onChainVerified
        ? "Proof retrieved from DA layer and verified on-chain via FdcVerification.verifyAddressValidity (VIEW staticCall). Honesty: VERIFIED."
        : result.proof
          ? result.verification?.error
            ? `Proof retrieved from DA layer; on-chain verify failed: ${result.verification.error}`
            : result.onChainVerified === false
              ? "Proof retrieved from DA layer; FdcVerification.verifyAddressValidity returned false."
              : "Proof retrieved from DA layer. On-chain verification not performed for this request."
          : "Proof not yet available from DA layer.",
    };
  });

  app.get("/v1/fdc/:requestId", async (req) => {
    const requestId = (req.params as { requestId: string }).requestId;
    if (!redis) {
      throw new AppError("VALIDATION", {
        message: "Redis required to load FDC attestation state.",
        statusCode: 503,
      });
    }
    const stored = await redis.get<AttestationPersistShape>(FDC_KEY(requestId));
    if (!stored) {
      throw new AppError("VALIDATION", { message: "Unknown FDC requestId." });
    }
    const adapter = createAttestationAdapter(env);
    const result = await adapter.getStatus(stored);
    await redis.set(FDC_KEY(requestId), result, { ex: 60 * 60 * 48 });
    return {
      ...result,
      uiPhases: [
        { id: "Requested", done: true },
        {
          id: "Submitted",
          done: ["Submitted", "Finalized", "Verified", "Accepted"].includes(result.lifecycle),
        },
        {
          id: "Finalized",
          done: ["Finalized", "Verified", "Accepted"].includes(result.lifecycle),
        },
        {
          id: "Verified",
          done: ["Verified", "Accepted"].includes(result.lifecycle),
        },
        {
          id: result.lifecycle === "Rejected" ? "Rejected" : "Accepted",
          done: result.lifecycle === "Accepted" || result.lifecycle === "Rejected",
        },
      ],
      note:
        result.lifecycle === "Verified" && result.onChainVerified
          ? "Verified means FdcVerification.verifyAddressValidity (VIEW staticCall) returned true on Coston2."
          : "Finalized means DA proof bytes were retrieved. Verified requires on-chain FdcVerification — not claimed from fetch alone.",
    };
  });

  /**
   * Gate a financial decision on FDC lifecycle when configured.
   * Without a Verified/Accepted attestation for the given requestId, returns blocked.
   * When FDC is NOT_AVAILABLE, returns honesty + does not invent allow.
   */
  app.post("/v1/fdc/decision", async (req) => {
    const body = z
      .object({
        requestId: z.string().min(4),
        action: z.string().min(2),
      })
      .parse(req.body ?? {});

    const adapter = createAttestationAdapter(env);
    if (!adapter.isAvailable("xrp") && !adapter.isAvailable("evm")) {
      return {
        allowed: false,
        status: "NOT_AVAILABLE" as const,
        reason: "FDC not configured — cannot use attestation as decision evidence.",
        action: body.action,
      };
    }
    if (!redis) {
      return {
        allowed: false,
        status: "NOT_AVAILABLE" as const,
        reason: "Redis unavailable — cannot load attestation state (fail closed).",
        action: body.action,
      };
    }
    const stored = await redis.get<AttestationPersistShape>(FDC_KEY(body.requestId));
    if (!stored) {
      return {
        allowed: false,
        status: "REAL" as const,
        reason: "Unknown attestation requestId.",
        action: body.action,
      };
    }
    const fresh = await adapter.getStatus(stored);
    await redis.set(FDC_KEY(body.requestId), fresh, { ex: 60 * 60 * 48 });

    const accepted =
      fresh.lifecycle === "Accepted" ||
      (fresh.lifecycle === "Verified" && fresh.verification?.verified === true) ||
      (fresh.lifecycle === "Finalized" && Boolean(fresh.proof));

    // Meaningful gate: Finalized+proof can inform research/signal acceptance;
    // value-moving paths should still require explicit Accepted after on-chain verify.
    const valueMoving = /swap|bridge|pay|transfer|redeem|mint/i.test(body.action);
    const allowed = valueMoving
      ? fresh.lifecycle === "Accepted" && fresh.verification?.verified === true
      : accepted;

    return {
      allowed,
      status: fresh.status,
      lifecycle: fresh.lifecycle,
      reason: allowed
        ? "FDC evidence accepted for this action class."
        : valueMoving
          ? "Value-moving action requires on-chain Verified+Accepted FDC proof — not yet available."
          : `Attestation lifecycle is ${fresh.lifecycle}${fresh.error ? `: ${fresh.error}` : ""}`,
      action: body.action,
      attestation: {
        requestId: fresh.requestId,
        kind: fresh.kind,
        lifecycle: fresh.lifecycle,
      },
    };
  });

  /** Evidence envelope CRUD (Redis-backed). */
  app.post("/v1/evidence", async (req) => {
    const body = z
      .object({
        jobId: z.string().min(4),
        intent: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(req.body ?? {});
    if (!redis) {
      throw new AppError("VALIDATION", {
        message: "Redis required for evidence envelopes.",
        statusCode: 503,
      });
    }
    let envelope = createEvidenceEnvelope({
      jobId: body.jobId,
      intent: body.intent
        ? {
            jobId: body.jobId,
            userId: String((body.intent as { userId?: string }).userId ?? "unknown"),
            description: String((body.intent as { description?: string }).description ?? ""),
            timestamp: new Date().toISOString(),
          }
        : undefined,
    });
    envelope = appendEvidenceStage(envelope, "intent", {
      status: "REAL",
      payload: body.intent,
    });
    await redis.set(EVIDENCE_KEY(body.jobId), envelope, { ex: 60 * 60 * 72 });
    return envelope;
  });

  app.get("/v1/evidence/:jobId", async (req) => {
    const jobId = (req.params as { jobId: string }).jobId;
    if (!redis) {
      throw new AppError("VALIDATION", {
        message: "Redis required for evidence envelopes.",
        statusCode: 503,
      });
    }
    const envelope = await redis.get<EvidenceEnvelope>(EVIDENCE_KEY(jobId));
    if (!envelope) {
      throw new AppError("VALIDATION", { message: "Evidence envelope not found." });
    }
    return envelope;
  });

  app.post("/v1/evidence/:jobId/stage", async (req) => {
    const jobId = (req.params as { jobId: string }).jobId;
    const body = z
      .object({
        stage: z.string().min(2),
        status: z.enum(["REAL", "SIMULATED", "NOT_AVAILABLE", "STUB"]),
        hash: z.string().optional(),
        payload: z.unknown().optional(),
      })
      .parse(req.body ?? {});
    if (!redis) {
      throw new AppError("VALIDATION", {
        message: "Redis required for evidence envelopes.",
        statusCode: 503,
      });
    }
    const existing = await redis.get<EvidenceEnvelope>(EVIDENCE_KEY(jobId));
    const base = existing ?? createEvidenceEnvelope({ jobId });
    const next = appendEvidenceStage(base, body.stage, {
      status: body.status,
      hash: body.hash,
      payload: body.payload,
    });
    await redis.set(EVIDENCE_KEY(jobId), next, { ex: 60 * 60 * 72 });
    return next;
  });

  /** Integration honesty map for UI / operators. */
  app.get("/v1/flare/integrations", async () => {
    const oracle = createPriceOracleAdapter(env);
    const fdc = createAttestationAdapter(env);
    const fcc = createConfidentialComputeAdapter(env);
    const fccStatus = fcc.getStatus();
    const fccLifecycle = await getFccLifecycleStatus(env);
    let ftsoOk = false;
    try {
      await oracle.getSnapshot();
      ftsoOk = true;
    } catch {
      ftsoOk = false;
    }
    return {
      network: env.NETWORK_NAME,
      chainId: env.CHAIN_ID,
      integrations: [
        {
          id: "ftso",
          status: ftsoOk ? "REAL" : "NOT_AVAILABLE",
          role: "execution_guard",
          note: "FTSOv2 prices gate Safe swaps (staleness / slippage / deviation).",
        },
        {
          id: "fdc",
          status: fdc.isAvailable("xrp") || fdc.isAvailable("evm") ? "REAL" : "NOT_AVAILABLE",
          role: "external_evidence",
          note: "Attestation API wired; proofs never invented.",
          daLayer: {
            baseUrl: "https://ctn2-data-availability.flare.network",
            proofPath: "/api/v1/fdc/proof-by-request-round-raw",
          },
        },
        {
          id: "fcc",
          status: fccStatus.status,
          role: "shadow_authorization",
          note: fccStatus.note,
          lifecycle: {
            mode: fccLifecycle.mode,
            instructionSenderDeployed: fccLifecycle.instructionSenderHasBytecode,
            instructionSenderAddress: fccLifecycle.instructionSenderAddress,
            extProxyConfigured: fccLifecycle.extProxyConfigured,
            extProxyReachable: fccLifecycle.extProxyReachable,
            extProxyEphemeral: fccLifecycle.extProxyEphemeral,
            teeProxyAvailable: fccLifecycle.teeProxyAvailable,
            teeId: fccLifecycle.teeId,
            flareTeeManager: fccLifecycle.flareTeeManager,
            teeMachineStatus: fccLifecycle.teeMachineStatus,
            teeMachineStatusLabel: fccLifecycle.teeMachineStatusLabel,
            teeProduction: fccLifecycle.teeProduction,
            simulatedTee: fccLifecycle.simulatedTee,
            attestationKind: fccLifecycle.attestationKind,
            instructionPath: fccLifecycle.instructionPath,
            blockers: fccLifecycle.blockers,
            canMoveFunds: false,
            hardwareClaim: fccLifecycle.hardwareClaim,
          },
        },
        {
          id: "fassets",
          status: "REAL",
          role: "lifecycle_status_redeem",
          note: "Status + redeem prepare (lots/amount/tag) + track PENDING/COMPLETED/DEFAULTED REAL; COMPLETED only with XRPL evidence; mint docs_handoff.",
        },
        {
          id: "smart_accounts",
          status: "STUB",
          role: "parallel_xrpl_rail",
          note: "Registry helpers only — Beacon Safe is not a Flare Smart Account.",
        },
        {
          id: "x402",
          status: "REAL",
          role: "machine_payment",
          note: "ERC-20 approve + facilitator pull on official Coston2 faucet USDT0 (no EIP-3009 on the faucet token).",
        },
        {
          id: "layerzero",
          status: "REAL",
          role: "oft_delivery_tracking",
          note: "OFT send + trackOftDelivery — never mark complete from optimistic local response.",
        },
        {
          id: "beacon_safe",
          status: "REAL",
          role: "personal_vault",
          note: "BeaconAgentVault via factory — separate from Flare Smart Accounts.",
        },
      ],
      fccMode: resolveFccMode(process.env, env.SIMULATED_TEE),
      daLayerNote: "Correct DA base: https://ctn2-data-availability.flare.network/ — proof path: /api/v1/fdc/proof-by-request-round-raw",
    };
  });

  /** Bind x402 payment fields into an evidence stage (machine economy receipt). */
  app.post("/v1/x402/evidence", async (req) => {
    const body = z
      .object({
        jobId: z.string().min(4),
        serviceId: z.string().min(1),
        price: z.string().min(1),
        token: z.string().min(1),
        payee: z.string().regex(/^0x[a-fA-F0-9]{40}$/i),
        nonce: z.string().min(4),
        expiry: z.number().int(),
        paymentTxHash: z.string().optional(),
        resultHash: z.string().optional(),
        acceptance: z.boolean().optional(),
        settlementTxHash: z.string().optional(),
      })
      .parse(req.body ?? {});

    if (!redis) {
      throw new AppError("VALIDATION", {
        message: "Redis required for x402 evidence.",
        statusCode: 503,
      });
    }

    const replayKey = `x402:nonce:${body.nonce.toLowerCase()}`;
    const seen = await redis.get(replayKey);
    if (seen) {
      throw new AppError("VALIDATION", {
        message: "x402 payment nonce already used — replay rejected.",
        details: { code: "X402_REPLAY" },
      });
    }
    const commitment = createHash("sha256")
      .update(
        JSON.stringify({
          serviceId: body.serviceId,
          price: body.price,
          token: body.token,
          payee: body.payee.toLowerCase(),
          nonce: body.nonce,
          expiry: body.expiry,
          paymentTxHash: body.paymentTxHash ?? null,
          resultHash: body.resultHash ?? null,
        }),
      )
      .digest("hex");

    if (body.expiry < Math.floor(Date.now() / 1000)) {
      throw new AppError("VALIDATION", { message: "x402 authorization expired." });
    }

    await redis.set(replayKey, commitment, { ex: 60 * 60 * 72 });

    let envelope =
      (await redis.get<EvidenceEnvelope>(EVIDENCE_KEY(body.jobId))) ??
      createEvidenceEnvelope({ jobId: body.jobId });
    envelope.payment = {
      rail: "x402",
      txHash: body.paymentTxHash,
      amount: body.price,
      currency: body.token,
      to: body.payee,
      timestamp: new Date().toISOString(),
    };
    if (body.settlementTxHash) {
      envelope.settlement = {
        settlementTxHash: body.settlementTxHash,
        chain: "coston2",
        amount: body.price,
        timestamp: new Date().toISOString(),
      };
    }
    if (body.acceptance != null) {
      envelope.acceptance = {
        accepted: body.acceptance,
        timestamp: new Date().toISOString(),
        hash: body.resultHash,
      };
    }
    envelope = appendEvidenceStage(envelope, "x402_payment", {
      status: "REAL",
      hash: body.paymentTxHash ?? commitment,
      payload: { ...body, commitment },
    });
    await redis.set(EVIDENCE_KEY(body.jobId), envelope, { ex: 60 * 60 * 72 });
    return { ok: true, commitment, envelope };
  });
}
