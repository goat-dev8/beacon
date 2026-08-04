import type pg from "pg";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Idempotent schema ensure for Flow OS tables (safe on every boot). */
export async function ensureFlowSchema(pool: pg.Pool): Promise<void> {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  const sqlPath = path.join(__dirname, "../../../db/migrations/002_flow_persistence.sql");
  try {
    const sql = readFileSync(sqlPath, "utf8");
    await pool.query(sql);
  } catch (err) {
    // Fallback inline DDL if path resolution fails in bundled deploy
    await pool.query(`
CREATE TABLE IF NOT EXISTS flow_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'New chat',
  agent_id TEXT NOT NULL DEFAULT 'general',
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS flow_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES flow_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  agent_id TEXT,
  text TEXT NOT NULL DEFAULT '',
  cards_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  display_model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS flow_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet TEXT NOT NULL,
  kind TEXT NOT NULL,
  ref_id TEXT,
  title TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  explorer_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`);
    console.warn("flow schema fallback applied", err instanceof Error ? err.message : err);
  }
}

export async function listConversations(pool: pg.Pool, wallet: string) {
  const { rows } = await pool.query(
    `SELECT id, title, agent_id, pinned, updated_at, created_at
     FROM flow_conversations
     WHERE LOWER(wallet) = LOWER($1) AND archived = FALSE
     ORDER BY pinned DESC, updated_at DESC
     LIMIT 50`,
    [wallet],
  );
  return rows;
}

export async function createConversation(
  pool: pg.Pool,
  wallet: string,
  title = "New chat",
  agentId = "general",
) {
  const { rows } = await pool.query(
    `INSERT INTO flow_conversations (wallet, title, agent_id)
     VALUES ($1, $2, $3)
     RETURNING id, title, agent_id, pinned, updated_at, created_at`,
    [wallet, title, agentId],
  );
  return rows[0];
}

export async function getConversation(pool: pg.Pool, id: string, wallet: string) {
  const { rows } = await pool.query(
    `SELECT id, title, agent_id, pinned, state_json, updated_at, created_at
     FROM flow_conversations
     WHERE id = $1 AND LOWER(wallet) = LOWER($2) AND archived = FALSE`,
    [id, wallet],
  );
  return rows[0] ?? null;
}

export async function renameConversation(pool: pg.Pool, id: string, wallet: string, title: string) {
  await pool.query(
    `UPDATE flow_conversations SET title = $3, updated_at = NOW()
     WHERE id = $1 AND LOWER(wallet) = LOWER($2)`,
    [id, wallet, title.slice(0, 120)],
  );
}

export async function archiveConversation(pool: pg.Pool, id: string, wallet: string) {
  await pool.query(
    `UPDATE flow_conversations SET archived = TRUE, updated_at = NOW()
     WHERE id = $1 AND LOWER(wallet) = LOWER($2)`,
    [id, wallet],
  );
}

export async function pinConversation(pool: pg.Pool, id: string, wallet: string, pinned: boolean) {
  await pool.query(
    `UPDATE flow_conversations SET pinned = $3, updated_at = NOW()
     WHERE id = $1 AND LOWER(wallet) = LOWER($2)`,
    [id, wallet, pinned],
  );
}

export async function listMessages(pool: pg.Pool, conversationId: string) {
  const { rows } = await pool.query(
    `SELECT id, role, agent_id, text, cards_json, display_model, created_at
     FROM flow_messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC
     LIMIT 200`,
    [conversationId],
  );
  return rows;
}

export async function appendMessage(
  pool: pg.Pool,
  conversationId: string,
  msg: {
    role: string;
    agentId?: string;
    text: string;
    cards?: unknown[];
    displayModel?: string;
  },
) {
  const { rows } = await pool.query(
    `INSERT INTO flow_messages (conversation_id, role, agent_id, text, cards_json, display_model)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     RETURNING id, created_at`,
    [
      conversationId,
      msg.role,
      msg.agentId ?? null,
      msg.text,
      JSON.stringify(msg.cards ?? []),
      msg.displayModel ?? null,
    ],
  );
  await pool.query(`UPDATE flow_conversations SET updated_at = NOW() WHERE id = $1`, [conversationId]);
  return rows[0];
}

export async function updateConversationState(
  pool: pg.Pool,
  conversationId: string,
  state: unknown,
  agentId?: string,
) {
  if (agentId) {
    await pool.query(
      `UPDATE flow_conversations SET state_json = $2::jsonb, agent_id = $3, updated_at = NOW() WHERE id = $1`,
      [conversationId, JSON.stringify(state ?? {}), agentId],
    );
  } else {
    await pool.query(
      `UPDATE flow_conversations SET state_json = $2::jsonb, updated_at = NOW() WHERE id = $1`,
      [conversationId, JSON.stringify(state ?? {})],
    );
  }
}

export async function recordActivity(
  pool: pg.Pool,
  wallet: string,
  kind: string,
  title: string,
  meta: Record<string, unknown> = {},
  explorerUrl?: string,
  refId?: string,
) {
  await pool.query(
    `INSERT INTO flow_activity (wallet, kind, title, meta, explorer_url, ref_id)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
    [wallet, kind, title, JSON.stringify(meta), explorerUrl ?? null, refId ?? null],
  );
}

export async function listActivity(pool: pg.Pool, wallet: string) {
  const { rows } = await pool.query(
    `SELECT id, kind, title, meta, explorer_url, ref_id, created_at
     FROM flow_activity
     WHERE LOWER(wallet) = LOWER($1)
     ORDER BY created_at DESC
     LIMIT 40`,
    [wallet],
  );
  return rows;
}
