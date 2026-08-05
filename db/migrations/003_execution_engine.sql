-- Universal execution engine persistence (Gate 1)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet TEXT NOT NULL,
  conversation_id UUID REFERENCES flow_conversations(id) ON DELETE SET NULL,
  workflow_type TEXT NOT NULL,
  workflow_version TEXT NOT NULL,
  immutable_input JSONB NOT NULL DEFAULT '{}'::jsonb,
  input_hash TEXT NOT NULL,
  phase TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  active_step TEXT,
  payment_mode TEXT NOT NULL DEFAULT 'none'
    CHECK (payment_mode IN ('none', 'x402', 'escrow', 'wallet')),
  executor_type TEXT,
  quote_id UUID,
  idempotency_key TEXT,
  error_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS executions_idempotency_key_idx
  ON executions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS executions_wallet_updated_idx
  ON executions (LOWER(wallet), updated_at DESC);

CREATE INDEX IF NOT EXISTS executions_phase_idx
  ON executions (phase);

CREATE INDEX IF NOT EXISTS executions_conversation_idx
  ON executions (conversation_id)
  WHERE conversation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS execution_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  step_key TEXT NOT NULL,
  step_order INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  input_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_json JSONB,
  error_json JSONB,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (execution_id, step_key)
);

CREATE INDEX IF NOT EXISTS execution_steps_execution_order_idx
  ON execution_steps (execution_id, step_order);

CREATE TABLE IF NOT EXISTS execution_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  seq BIGINT NOT NULL,
  event_type TEXT NOT NULL,
  phase TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (execution_id, seq)
);

CREATE INDEX IF NOT EXISTS execution_events_execution_created_idx
  ON execution_events (execution_id, created_at ASC);

CREATE TABLE IF NOT EXISTS execution_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  price_usdt0 BIGINT,
  fees_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  eta_seconds INT,
  expires_at TIMESTAMPTZ NOT NULL,
  quote_hash TEXT NOT NULL,
  source_timestamps JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_quote JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS execution_quotes_execution_created_idx
  ON execution_quotes (execution_id, created_at DESC);

CREATE TABLE IF NOT EXISTS execution_risk_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  policy_version TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('allow', 'block', 'review')),
  reason TEXT,
  balance_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  allowance_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  chain_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  simulation_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ftso_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  budget_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS execution_risk_decisions_execution_created_idx
  ON execution_risk_decisions (execution_id, created_at DESC);

CREATE TABLE IF NOT EXISTS execution_authorizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  rail TEXT NOT NULL CHECK (rail IN ('none', 'x402', 'escrow', 'wallet')),
  idempotency_key TEXT NOT NULL,
  x402_nonce TEXT,
  escrow_lock_tx TEXT,
  wallet_action_json JSONB,
  xrpl_tx_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  authorized_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS execution_authorizations_execution_created_idx
  ON execution_authorizations (execution_id, created_at DESC);

CREATE TABLE IF NOT EXISTS execution_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  receipt_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  explorer_links JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  artifact_refs JSONB NOT NULL DEFAULT '{}'::jsonb,
  verification_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (execution_id)
);

-- Link legacy Bound Work jobs to universal executions (incremental migration).
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS execution_id UUID REFERENCES executions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS jobs_execution_id_idx
  ON jobs (execution_id)
  WHERE execution_id IS NOT NULL;

-- Optional FK from executions to the active quote row once quoted.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'executions_quote_id_fkey'
  ) THEN
    ALTER TABLE executions
      ADD CONSTRAINT executions_quote_id_fkey
      FOREIGN KEY (quote_id) REFERENCES execution_quotes(id) ON DELETE SET NULL;
  END IF;
END $$;
