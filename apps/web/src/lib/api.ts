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
  health: () => request<{ ok: boolean; service: string }>("/health"),
  ready: () =>
    request<{ ready: boolean; checks: Record<string, { ok: boolean }> }>("/ready"),
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
  ) =>
    request<{ jobId: string; status: string; offerId: string }>(`/v1/jobs/${jobId}/approve`, {
      method: "POST",
      body: JSON.stringify({
        offerId,
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
  getJob: (jobId: string) =>
    request<{
      job: JobRow;
      recentEvents: JobEvent[];
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
