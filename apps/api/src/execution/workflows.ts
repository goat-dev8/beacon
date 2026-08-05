import type {
  ExecutionAdapter,
  ExecutionEvidence,
  ExecutionPlan,
  PreparedExecution,
  VerificationResult,
} from "@beacon/execution";
import { WorkflowRegistry } from "@beacon/execution";
import { prepareUsdt0ToFxrpSwap, prepareFxrpOftBridge } from "@beacon/shared";

const WORKFLOW_VERSION = "1";

function stubAdapter(label: string, executorType: string): ExecutionAdapter {
  return {
    async prepare(plan: ExecutionPlan): Promise<PreparedExecution> {
      return {
        executionId: plan.executionId,
        workflowType: plan.workflowType,
        workflowVersion: plan.workflowVersion,
        preparedAt: new Date().toISOString(),
        plan,
        payload: {
          stub: true,
          label,
          message: `${label} prepare stub`,
          inputHash: plan.inputHash,
        },
      };
    },
    async execute(prepared: PreparedExecution): Promise<ExecutionEvidence> {
      return {
        executionId: prepared.executionId,
        workflowType: prepared.workflowType,
        workflowVersion: prepared.workflowVersion,
        recordedAt: new Date().toISOString(),
        prepared,
        payload: {
          stub: true,
          label,
          executorType,
          message: `${label} execute stub — wallet/user confirms on client`,
        },
      };
    },
    async *observe(evidence: ExecutionEvidence) {
      yield {
        id: `stub-${evidence.executionId}`,
        executionId: evidence.executionId,
        seq: 1,
        type: "note" as const,
        payload: { stub: true, label, phase: "observing" },
        createdAt: new Date().toISOString(),
      };
    },
    async verify(evidence: ExecutionEvidence): Promise<VerificationResult> {
      return {
        executionId: evidence.executionId,
        verified: false,
        outcome: "needs_review",
        details: { stub: true, label },
      };
    },
  };
}

const swapAdapter: ExecutionAdapter = {
  async prepare(plan) {
    const input = plan.immutableInput as {
      amountInUnits?: string;
      recipient?: string;
    };
    const amountInUnits = input.amountInUnits ?? "1";
    const recipient = input.recipient ?? plan.walletIdentity;
    const prep = await prepareUsdt0ToFxrpSwap({ amountInUnits, recipient });
    return {
      executionId: plan.executionId,
      workflowType: plan.workflowType,
      workflowVersion: plan.workflowVersion,
      preparedAt: new Date().toISOString(),
      plan,
      payload: { ...prep, paymentMode: plan.paymentMode, stub: false },
    };
  },
  async execute(prepared) {
    return {
      executionId: prepared.executionId,
      workflowType: prepared.workflowType,
      workflowVersion: prepared.workflowVersion,
      recordedAt: new Date().toISOString(),
      prepared,
      payload: {
        stub: false,
        awaitingWallet: true,
        message: "Client must run approve + SparkDEX swap; engine records evidence after receipts",
        prepared: prepared.payload,
      },
    };
  },
  async *observe(evidence) {
    yield {
      id: `swap-obs-${evidence.executionId}`,
      executionId: evidence.executionId,
      seq: 1,
      type: "note" as const,
      payload: { awaiting: "wallet_receipts" },
      createdAt: new Date().toISOString(),
    };
  },
  async verify(evidence) {
    const p = evidence.payload as { swapHash?: string };
    return {
      executionId: evidence.executionId,
      verified: Boolean(p.swapHash),
      outcome: p.swapHash ? "pass" : "needs_review",
      details: evidence.payload,
    };
  },
};

const bridgeAdapter: ExecutionAdapter = {
  async prepare(plan) {
    const input = plan.immutableInput as {
      amountFxrpUnits?: string;
      recipient?: string;
      dstEid?: number;
    };
    const prep = await prepareFxrpOftBridge({
      amountFxrpUnits: input.amountFxrpUnits ?? "1",
      recipient: input.recipient ?? plan.walletIdentity,
      dstEid: input.dstEid ?? 40161,
    });
    return {
      executionId: plan.executionId,
      workflowType: plan.workflowType,
      workflowVersion: plan.workflowVersion,
      preparedAt: new Date().toISOString(),
      plan,
      payload: { ...prep, paymentMode: plan.paymentMode, stub: false },
    };
  },
  async execute(prepared) {
    return {
      executionId: prepared.executionId,
      workflowType: prepared.workflowType,
      workflowVersion: prepared.workflowVersion,
      recordedAt: new Date().toISOString(),
      prepared,
      payload: {
        stub: false,
        awaitingWallet: true,
        message: "Client must run approve + OFT send with nativeFee; track LayerZero Scan after source confirm",
        prepared: prepared.payload,
      },
    };
  },
  async *observe(evidence) {
    yield {
      id: `bridge-obs-${evidence.executionId}`,
      executionId: evidence.executionId,
      seq: 1,
      type: "note" as const,
      payload: { awaiting: "source_tx_and_lz_scan" },
      createdAt: new Date().toISOString(),
    };
  },
  async verify(evidence) {
    const p = evidence.payload as { sendHash?: string; destinationReceived?: boolean };
    return {
      executionId: evidence.executionId,
      verified: Boolean(p.sendHash),
      outcome: p.destinationReceived ? "pass" : p.sendHash ? "needs_review" : "fail",
      details: {
        ...((evidence.payload as object) ?? {}),
        honesty: "Destination fill requires LayerZero Scan + dest receipt — source hash alone is not a fill",
      },
    };
  },
};

let registry: WorkflowRegistry | null = null;

export function getWorkflowRegistry(): WorkflowRegistry {
  if (registry) return registry;

  registry = new WorkflowRegistry();
  registry.register("swap.usdt0_fxrp", WORKFLOW_VERSION, swapAdapter);
  registry.register("bridge.fxrp_oft", WORKFLOW_VERSION, bridgeAdapter);
  registry.register("media.image", WORKFLOW_VERSION, stubAdapter("Image generation", "x402_media"));
  registry.register("research.report", WORKFLOW_VERSION, stubAdapter("Research report", "x402_research"));
  registry.register("bound_work", WORKFLOW_VERSION, stubAdapter("Bound Work escrow job", "beacon_escrow"));
  registry.register("trade.signal_action", WORKFLOW_VERSION, stubAdapter("Trade signal action", "ftso_trade"));
  registry.register("signals.deep", WORKFLOW_VERSION, stubAdapter("Deep signals analysis", "signals_pipeline"));

  return registry;
}

export function listRegisteredWorkflows() {
  return getWorkflowRegistry().list().map(({ workflowType, version }) => ({
    workflowType,
    version,
    status:
      workflowType === "swap.usdt0_fxrp" || workflowType === "bridge.fxrp_oft"
        ? "live_prepare"
        : "stub",
  }));
}
