import type {
  ApiErrorBody,
  Artifact,
  JobEvent,
  JobRow,
  QuoteDto,
  ServiceId,
  ServiceItem,
} from "./types";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;

  constructor(status: number, body: ApiErrorBody) {
    const message =
      body.error?.message ?? body.message ?? `Request failed (${status})`;
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.error?.code ?? "UNKNOWN";
    this.details = body.error?.details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;

  if (!res.ok) {
    throw new ApiError(res.status, (data as ApiErrorBody) ?? {});
  }

  return data as T;
}

export const api = {
  health: () =>
    request<{
      ok: boolean;
      service: string;
      simulatedTee?: boolean;
      fccMode?: "simulated" | "unavailable" | "verified";
      honesty?: string;
    }>("/health"),
  getFccStatus: () =>
    request<{
      ok: boolean;
      mode: "simulated" | "unavailable" | "verified";
      simulatedTee: boolean;
      localMode?: boolean;
      proxyReachable: boolean;
      extensionId?: string;
      extProxyConfigured?: boolean;
      honesty: string;
    }>("/v1/fcc/status"),
  ready: () =>
    request<{ ready: boolean; checks: Record<string, { ok: boolean }> }>("/ready"),
  createSafeSessionChallenge: (wallet: string) =>
    request<{
      ok: true;
      message: string;
      expiresAt: number;
      scope: string;
    }>("/v1/auth/safe-session/challenge", {
      method: "POST",
      body: JSON.stringify({ wallet }),
    }),
  verifySafeSession: (body: {
    wallet: string;
    message: string;
    signature: string;
  }) =>
    request<{
      ok: true;
      token: string;
      wallet: string;
      issuedAt: number;
      expiresAt: number;
    }>("/v1/auth/safe-session/verify", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  services: () => request<{ services: ServiceItem[] }>("/v1/services"),
  createJob: (body: { serviceId: ServiceId; briefText: string; brandPackId?: string }) =>
    request<{ jobId: string; status: string }>("/v1/jobs", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  quoteJob: (jobId: string) =>
    request<{ jobId: string; quote: QuoteDto; offerId: string }>(`/v1/jobs/${jobId}/quote`, {
      method: "POST",
      body: "{}",
    }),
  approveJob: (
    jobId: string,
    offerId: string,
    authorization?: {
      payer: string;
      payee?: string;
      amount: string;
      validAfter?: string;
      validBefore: string;
      nonce: string;
      signature: string;
      lockTxHash?: string;
    },
    opts?: { mode?: "safe" | "wallet" },
  ) =>
    request<{
      jobId: string;
      status: string;
      offerId: string;
      mode?: string;
      lockTxHash?: string | null;
      spendTxHash?: string | null;
    }>(`/v1/jobs/${jobId}/approve`, {
      method: "POST",
      body: JSON.stringify({
        offerId,
        mode: opts?.mode ?? (authorization?.signature ? "wallet" : undefined),
        authorization: authorization
          ? {
              payer: authorization.payer,
              payee: authorization.payee,
              amount: authorization.amount,
              validAfter: authorization.validAfter,
              validBefore: authorization.validBefore,
              nonce: authorization.nonce,
              signature: authorization.signature,
            }
          : undefined,
        lockTxHash: authorization?.lockTxHash,
      }),
    }),
  approveJobFromSafe: async (
    jobId: string,
    offerId: string,
    opts: {
      ownerWallet: string;
      sessionToken: string;
    },
  ) => {
    return request<{
      jobId: string;
      status: string;
      offerId: string;
      mode: string;
      vault?: string;
      lockTxHash: string;
      spendTxHash: string;
      explorerLock?: string;
      explorerSpend?: string;
    }>(`/v1/jobs/${jobId}/approve-safe`, {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.sessionToken}` },
      body: JSON.stringify({
        offerId,
        ownerWallet: opts.ownerWallet,
      }),
    });
  },
  getJob: (jobId: string) =>
    request<{
      job: JobRow;
      recentEvents: JobEvent[];
      paymentRail: {
        mode: "safe" | "wallet";
        lockTxHash: string | null;
        spendTxHash: string | null;
        payer: string | null;
        ownerWallet: string | null;
      } | null;
      acceptance: import("./types").AcceptanceSummary | null;
    }>(`/v1/jobs/${jobId}`),
  artifacts: (jobId: string) =>
    request<{ jobId: string; artifacts: Artifact[] }>(`/v1/jobs/${jobId}/artifacts`),
  artifactContent: (jobId: string, artifactId: string) =>
    request<{
      id: string;
      kind: string;
      mimeType: string;
      content: string | null;
      truncated: boolean;
      available: boolean;
      rawUrl?: string;
    }>(`/v1/jobs/${jobId}/artifacts/${artifactId}`),
  artifactRawUrl: (jobId: string, artifactId: string) =>
    `${API_BASE}/v1/jobs/${jobId}/artifacts/${artifactId}/raw`,
  jobReceipt: (jobId: string) =>
    request<{
      jobId: string;
      receipt: {
        id: string;
        txHash?: string | null;
        payment?: { txHash?: string; settled?: boolean; amountUsdt0?: string };
      } | null;
    }>(`/v1/jobs/${jobId}/receipt`),
  look: (jobId: string, decision: "accept" | "reject") =>
    request<{ jobId: string; status: string }>(`/v1/jobs/${jobId}/look`, {
      method: "POST",
      body: JSON.stringify({ decision }),
    }),
  receipt: (receiptId: string) => request<Record<string, unknown>>(`/v1/receipts/${receiptId}`),
  prepareCredit: (amountXrp = "10") =>
    request<{
      kind: string;
      destination: string;
      amountXrp: string;
      memo: string;
      beaconRef: string;
    }>("/v1/credit/prepare", {
      method: "POST",
      body: JSON.stringify({ amountXrp }),
    }),
  agents: () =>
    request<{
      network: string;
      chainId: number;
      agents: Array<{
        id: string;
        name: string;
        blurb: string;
        builtIn: boolean;
        x402PriceUsdt0: number;
        mention: string;
      }>;
      rails: Record<string, string>;
    }>("/v1/agents"),
  agentChat: (body: {
    agentId?: string;
    message: string;
    wallet?: string;
    conversationId?: string;
    serviceId?: string;
    resource?: string;
    quoteId?: string;
    state?: {
      intent: string;
      phase: string;
      amountInUnits?: string;
      bridgeFrom?: string;
      bridgeTo?: string;
      serviceId?: string;
      creativeBrief?: string;
      quotePrice?: string;
    } | null;
    payment?: Record<string, unknown>;
  }) =>
    request<{
      ok: boolean;
      conversationId?: string | null;
      agentId: string;
      text: string;
      cards: Array<Record<string, unknown> & { type: string }>;
      model: string;
      displayModel: string;
      paid: boolean;
      state: {
        intent: string;
        phase: string;
        amountInUnits?: string;
        bridgeFrom?: string;
        bridgeTo?: string;
        serviceId?: string;
        creativeBrief?: string;
        quotePrice?: string;
      };
    }>("/v1/agents/chat", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listFlowConversations: (wallet: string) =>
    request<{
      ok: boolean;
      conversations: Array<{
        id: string;
        title: string;
        agent_id: string;
        pinned: boolean;
        updated_at: string;
        created_at: string;
      }>;
    }>(`/v1/flow/conversations?wallet=${encodeURIComponent(wallet)}`),
  createFlowConversation: (wallet: string, title?: string, agentId?: string) =>
    request<{
      ok: boolean;
      conversation: {
        id: string;
        title: string;
        agent_id: string;
        pinned: boolean;
        updated_at: string;
        created_at: string;
      };
    }>("/v1/flow/conversations", {
      method: "POST",
      body: JSON.stringify({ wallet, title, agentId }),
    }),
  getFlowConversation: (id: string, wallet: string) =>
    request<{
      ok: boolean;
      conversation: {
        id: string;
        title: string;
        agent_id: string;
        pinned: boolean;
        state_json: Record<string, unknown>;
        updated_at: string;
        created_at: string;
      };
      messages: Array<{
        id: string;
        role: string;
        agentId?: string;
        text: string;
        cards?: Array<Record<string, unknown> & { type: string }>;
        displayModel?: string;
        createdAt: string;
      }>;
    }>(`/v1/flow/conversations/${id}?wallet=${encodeURIComponent(wallet)}`),
  patchFlowConversation: (
    id: string,
    body: { wallet: string; title?: string; pinned?: boolean; archive?: boolean },
  ) =>
    request<{ ok: boolean }>(`/v1/flow/conversations/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  listFlowActivity: (wallet: string) =>
    request<{
      ok: boolean;
      activity: Array<{
        id: string;
        kind: string;
        title: string;
        meta: Record<string, unknown>;
        explorer_url?: string;
        ref_id?: string;
        created_at: string;
      }>;
    }>(`/v1/flow/activity?wallet=${encodeURIComponent(wallet)}`),
  recordFlowActivity: (body: {
    wallet: string;
    kind: "swap" | "bridge" | "payment" | "media" | "execution";
    title: string;
    explorerUrl?: string;
    refId?: string;
    meta?: Record<string, unknown>;
  }) =>
    request<{ ok: boolean }>("/v1/flow/activity", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  agentSignals: () =>
    request<{
      ok: boolean;
      ftsoV2: string;
      timestamp: number;
      feeds: Array<{ symbol: string; value: number }>;
    }>("/v1/agents/signals"),
  agentBridgeRoutes: (force?: boolean) =>
    request<{
      ok: boolean;
      routes: Array<{
        chain: string;
        eid: number;
        peer: string;
        asset: string;
        status: string;
        live?: boolean;
        eta: string;
        fees: string;
      }>;
      source: "onchain" | "fallback";
      discoveredAt: number;
      oftAdapter: string;
      honesty?: string;
    }>(`/v1/agents/bridge/routes${force ? "?force=1" : ""}`),
  agentBridgeDelivery: (params: { tx: string; dstEid?: number; peer?: string; guid?: string }) => {
    const q = new URLSearchParams({ tx: params.tx });
    if (params.dstEid != null) q.set("dstEid", String(params.dstEid));
    if (params.peer) q.set("peer", params.peer);
    if (params.guid) q.set("guid", params.guid);
    return request<{
      ok: boolean;
      delivery: {
        phase: string;
        sourceTxHash: string;
        guid: string | null;
        dstEid: number | null;
        destination: string | null;
        destTxHash: string | null;
        layerZeroScanUrl: string;
        explorerUrl: string;
        destExplorerUrl: string | null;
        note: string;
        uiPhases: Array<{ id: string; label: string; status: string }>;
      };
    }>(`/v1/agents/bridge/delivery?${q.toString()}`);
  },
  agentBalances: (wallet: string) =>
    request<{
      ok: boolean;
      wallet: string;
      balances: {
        usdt0: { address: string; formatted: string; symbol: string };
        fxrp: { address: string; formatted: string; symbol: string };
        mockUsdt0: { address: string; formatted: string; symbol: string } | null;
      };
    }>(`/v1/agents/balances?wallet=${encodeURIComponent(wallet)}`),
  getSecurityPolicy: (wallet: string) =>
    request<{
      ok: boolean;
      policy: SecurityPolicy;
      source: string;
      receipt?: {
        title: string;
        spentTodayUsdt0: number;
        remainingUsdt0: number;
        dailyBudgetUsdt0: number;
        perJobLimitUsdt0: number;
        emergencyPause: boolean;
        allowedAgents: string[];
        note: string;
      };
    }>(`/v1/security/policy?wallet=${encodeURIComponent(wallet)}`),
  putSecurityPolicy: (wallet: string, policy: SecurityPolicy, sessionToken: string) =>
    request<{ ok: boolean; policy: SecurityPolicy; source: string }>("/v1/security/policy", {
      method: "PUT",
      headers: { Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ wallet, policy }),
    }),
  revokeSecurity: (wallet: string, sessionToken: string) =>
    request<{ ok: boolean; message: string }>("/v1/security/revoke", {
      method: "POST",
      headers: { Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ wallet }),
    }),
  getVaultStatus: (opts?: { address?: string; wallet?: string } | string) => {
    // Back-compat: getVaultStatus(addressString)
    const normalized =
      typeof opts === "string" ? { address: opts } : opts ?? {};
    const params = new URLSearchParams();
    if (normalized.address) params.set("address", normalized.address);
    if (normalized.wallet) params.set("wallet", normalized.wallet);
    const q = params.toString() ? `?${params}` : "";
    return request<{ ok: boolean; status: AgentVaultStatus }>(`/v1/vault/status${q}`);
  },
  prepareVault: (body: {
    action: "deposit" | "withdraw" | "setPolicy" | "setPaused" | "setExecutor" | "createSafe";
    address?: string;
    wallet?: string;
    amountUsdt0?: string;
    maxSpendPerTxUsdt0?: string;
    rollingWindowBudgetUsdt0?: string;
    rollingWindowSeconds?: number;
    sessionExpiresAt?: number;
    paused?: boolean;
    executor?: string;
    revoke?: boolean;
  }) =>
    request<{ ok: boolean; prep: AgentVaultPrep }>("/v1/vault/prepare", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  executeSafeSwap: (body: {
    wallet: string;
    amountInUnits: string;
    recipient: string;
    slippageBps?: number;
    sessionToken: string;
  }) => {
    const { sessionToken, ...payload } = body;
    return request<{
      ok: boolean;
      spendHash: string;
      fulfillHash: string;
      amountIn: string;
      amountOut: string;
      recipient: string;
      explorerSpend: string;
      explorerFulfill: string;
      chainId: number;
      honesty: string;
      error?: string;
    }>(
      "/v1/vault/safe-swap/execute",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify(payload),
      },
    );
  },
  executeAgentBridge: (body: {
    wallet: string;
    amountFxrpUnits: string;
    recipient: string;
    destination: string;
    sessionToken: string;
  }) => {
    const { sessionToken, ...payload } = body;
    return request<{
      ok: boolean;
      approveHash: string | null;
      sendHash: string;
      explorerSend: string;
      layerZeroScanUrl: string;
      amountDisplay: string;
      destination: string;
      dstEid: number;
      peer: string;
      honesty: string;
    }>(
      "/v1/agents/bridge/execute",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify(payload),
      },
    );
  },
};

export type AgentVaultStatus =
  | {
      configured: false;
      readiness: string;
      address: null;
      note: string;
      honesty: string;
      distinction: string;
      code?: string;
      factory?: string | null;
      wallet?: string | null;
    }
  | {
      configured: true;
      address: string;
      network: string;
      chainId: number;
      token: string;
      tokenSymbol: string;
      tokenDecimals: number;
      balance: string;
      balanceDisplay: string;
      owner: string;
      executor: string;
      paused: boolean;
      maxSpendPerTxDisplay: string;
      rollingWindowBudgetDisplay: string;
      rollingWindowSeconds: string;
      windowSpentDisplay: string;
      windowStart?: string;
      windowRemainingDisplay?: string;
      windowResetsAt?: number;
      windowResetsAtIso?: string | null;
      sessionExpiresAt: number;
      sessionExpiresAtIso: string | null;
      sessionActive: boolean;
      executeNonce: string;
      allowlists: {
        targets: Array<{ address: string; allowed: boolean }>;
        selectors: Array<{ selector: string; allowed: boolean }>;
        note: string;
      };
      explorer: string;
      honesty: string;
      distinction: string;
      factory?: string | null;
      wallet?: string | null;
      source?: string;
      isOwner?: boolean;
    };

export type AgentVaultPrep = {
  action: string;
  chainId: number;
  network: string;
  to: string;
  data: string;
  approveTo?: string;
  approveData?: string;
  token?: string;
  amount?: string;
  mode?: "eip3009" | "approve";
  value: "0";
  ownerOnly: boolean;
  note: string;
  honesty: string;
};

export type SecurityPolicy = {
  dailySpendUsdt0: number;
  perJobLimitUsdt0: number;
  allowedAgents: string[];
  allowedChains: number[];
  maxImageCostUsdt0: number;
  maxVideoSeconds: number;
  emergencyPause: boolean;
  sessionExpiryHours: number;
};

/** Live job event stream — production SSE from the API. */
export function subscribeJobEvents(
  jobId: string,
  onEvent: (event: string, data: unknown) => void,
): () => void {
  const es = new EventSource(`${API_BASE}/v1/jobs/${jobId}/events`);

  const handle = (type: string) => (e: MessageEvent) => {
    try {
      onEvent(type, JSON.parse(String(e.data)));
    } catch {
      onEvent(type, e.data);
    }
  };

  es.addEventListener("connected", handle("connected"));
  es.addEventListener("message", handle("message"));
  es.addEventListener("heartbeat", handle("heartbeat"));
  es.onmessage = handle("message");
  es.onerror = () => onEvent("error", { ok: false });

  return () => es.close();
}
