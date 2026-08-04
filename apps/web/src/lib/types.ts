export type ServiceId =
  | "video"
  | "image"
  | "voice"
  | "presentations"
  | "coding"
  | "research"
  | "documents";

export type JobStatus =
  | "DRAFT"
  | "QUOTING"
  | "QUOTED"
  | "AUTHORIZED"
  | "PREPARING"
  | "GENERATING"
  | "COMPOSING"
  | "ACCEPTING"
  | "NEEDS_LOOK"
  | "PASSED"
  | "FAILED"
  | "SETTLING"
  | "REFUSING"
  | "CLOSED"
  | "EXPIRED"
  | "CANCELED";

export interface ServiceItem {
  id: ServiceId;
  name: string;
  description: string;
}

export interface QuoteDto {
  quoteId: string;
  priceDisplay: string;
  etaSeconds: number;
  includes: string[];
  expiresAt: string;
  capability: "FIT" | "NO_FIT";
}

export interface JobRow {
  id: string;
  user_id: string | null;
  service_id: ServiceId;
  status: JobStatus;
  brief_text: string | null;
  created_at?: string;
  updated_at?: string;
  receipt_id?: string | null;
}

export interface JobEvent {
  type: string;
  payload: unknown;
  ts: string;
}

export interface AcceptanceSummary {
  result: "PASS" | "FAIL" | "NEEDS_LOOK";
  confidence: number;
  summary: string | null;
  notes?: string[];
}

export interface Artifact {
  id: string;
  kind: string;
  uri: string;
  sha256: string | null;
  meta: Record<string, unknown> | null;
}

export interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
  message?: string;
}
