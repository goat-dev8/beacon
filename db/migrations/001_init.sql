-- Beacon v1 initial schema (IMPLEMENTATION §21)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  display_name TEXT,
  primary_auth TEXT
);

CREATE TABLE IF NOT EXISTS auth_identities (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('xrpl', 'evm', 'email')),
  subject TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (user_id, kind, subject)
);

CREATE TABLE IF NOT EXISTS credits_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_usdt0 BIGINT NOT NULL,
  reason TEXT NOT NULL,
  ref_type TEXT,
  ref_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  service_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  brief_uri TEXT,
  brief_text TEXT,
  brand_pack_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  price_usdt0 BIGINT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  brief_hash TEXT NOT NULL,
  rubric_hash TEXT NOT NULL,
  tee_sig TEXT,
  raw_offer_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS authorizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id UUID NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  eip3009_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  valid_before TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE UNIQUE INDEX IF NOT EXISTS authorizations_active_offer_idx
  ON authorizations (offer_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  uri TEXT NOT NULL,
  sha256 TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS accept_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  offer_id UUID REFERENCES offers(id) ON DELETE SET NULL,
  result TEXT NOT NULL CHECK (result IN ('PASS', 'FAIL', 'NEEDS_LOOK')),
  report_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  tee_sig TEXT,
  confidence DOUBLE PRECISION
);

CREATE TABLE IF NOT EXISTS receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  payment_id TEXT,
  tx_hash TEXT,
  offer_id UUID REFERENCES offers(id) ON DELETE SET NULL,
  accept_id UUID REFERENCES accept_reports(id) ON DELETE SET NULL,
  pdf_uri TEXT,
  receipt_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS cost_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  units DOUBLE PRECISION NOT NULL DEFAULT 0,
  usd_estimate DOUBLE PRECISION NOT NULL DEFAULT 0,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS jobs_user_created_idx ON jobs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs (status);
CREATE INDEX IF NOT EXISTS offers_job_id_idx ON offers (job_id);
CREATE INDEX IF NOT EXISTS job_events_job_ts_idx ON job_events (job_id, ts);
CREATE INDEX IF NOT EXISTS credits_ledger_user_created_idx ON credits_ledger (user_id, created_at);
