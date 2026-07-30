import { loadEnv } from "@beacon/shared";

export * from "./fcc.js";

export type AttestationKind = "Payment" | "EVMTransaction" | "Web2Json" | "AddressValidity";

export interface PrepareRequest {
  kind: AttestationKind;
  source: "xrp" | "evm";
  payload: Record<string, unknown>;
}

export interface PrepareResponse {
  requestId: string;
  status: "prepared" | "error";
  message?: string;
  raw?: unknown;
}

export interface SubmitResponse {
  requestId: string;
  status: "submitted" | "error";
  message?: string;
  raw?: unknown;
}

export interface FdcClientConfig {
  verifierXrpUrl: string;
  verifierEvmUrl: string;
  apiKey?: string;
  daLayerUrl?: string;
}

export function fdcClientFromEnv(): FdcClient {
  const env = loadEnv();
  return new FdcClient({
    verifierXrpUrl: env.FDC_VERIFIER_XRP_URL ?? "",
    verifierEvmUrl: env.FDC_VERIFIER_EVM_URL ?? "",
    apiKey: env.FDC_API_KEY || undefined,
    daLayerUrl: env.DA_LAYER_URL || undefined,
  });
}

export class FdcClient {
  constructor(private readonly cfg: FdcClientConfig) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.cfg.apiKey) h["X-API-KEY"] = this.cfg.apiKey;
    return h;
  }

  private baseUrl(source: "xrp" | "evm"): string {
    const url = source === "xrp" ? this.cfg.verifierXrpUrl : this.cfg.verifierEvmUrl;
    if (!url) throw new Error(`FDC verifier URL missing for ${source}`);
    return url.replace(/\/$/, "");
  }

  async prepare(req: PrepareRequest): Promise<PrepareResponse> {
    const url = `${this.baseUrl(req.source)}/prepare`;
    const response = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ attestationType: req.kind, ...req.payload }),
    });

    const raw = await safeJson(response);
    if (!response.ok) {
      return {
        requestId: "",
        status: "error",
        message: `Prepare failed (${response.status})`,
        raw,
      };
    }

    const requestId = extractRequestId(raw);
    return { requestId, status: "prepared", raw };
  }

  async submit(requestId: string, source: "xrp" | "evm"): Promise<SubmitResponse> {
    const url = `${this.baseUrl(source)}/submit`;
    const response = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ requestId }),
    });

    const raw = await safeJson(response);
    if (!response.ok) {
      return {
        requestId,
        status: "error",
        message: `Submit failed (${response.status})`,
        raw,
      };
    }

    return { requestId, status: "submitted", raw };
  }

  async fetchProof(requestId: string): Promise<{ ok: boolean; proof?: unknown; message?: string }> {
    if (!this.cfg.daLayerUrl) {
      return { ok: false, message: "DA layer URL not configured" };
    }
    const url = `${this.cfg.daLayerUrl.replace(/\/$/, "")}/proof/${encodeURIComponent(requestId)}`;
    const response = await fetch(url, { headers: this.headers() });
    const raw = await safeJson(response);
    if (!response.ok) {
      return { ok: false, message: `Proof fetch failed (${response.status})`, proof: raw };
    }
    return { ok: true, proof: raw };
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return { text: await response.text() };
  }
}

function extractRequestId(raw: unknown): string {
  if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.requestId === "string") return obj.requestId;
    if (typeof obj.id === "string") return obj.id;
  }
  return crypto.randomUUID();
}
