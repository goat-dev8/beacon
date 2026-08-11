import type { McpScope } from "./scopes.js";

export type McpClientKind = "claude" | "cursor" | "generic";

export type McpGrant = {
  id: string;
  wallet: string;
  safeAddress: string | null;
  clientKind: McpClientKind;
  clientLabel: string;
  scopes: McpScope[];
  /** Soft MCP-layer cap in USDT0 (also checked against Safe/server policy). */
  maxSpendPerTxUsdt0: number;
  dailyLimitUsdt0: number;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  refreshTokenHash: string | null;
};

export type McpAuditEvent = {
  at: string;
  grantId: string;
  wallet: string;
  tool: string;
  ok: boolean;
  detail: string;
  amountUsdt0?: number;
  txHash?: string;
};

export type RedisLike = {
  get: <T = unknown>(key: string) => Promise<T | null>;
  set: (key: string, value: unknown, opts?: { ex?: number }) => Promise<unknown>;
  del: (...keys: string[]) => Promise<unknown>;
  lpush?: (key: string, ...values: string[]) => Promise<unknown>;
  ltrim?: (key: string, start: number, stop: number) => Promise<unknown>;
  lrange?: (key: string, start: number, stop: number) => Promise<string[]>;
  sadd?: (key: string, ...members: string[]) => Promise<unknown>;
  smembers?: (key: string) => Promise<string[]>;
  srem?: (key: string, ...members: string[]) => Promise<unknown>;
  incr?: (key: string) => Promise<number>;
  expire?: (key: string, seconds: number) => Promise<unknown>;
};

function grantKey(id: string): string {
  return `mcp:grant:${id}`;
}

function walletGrantsKey(wallet: string): string {
  return `mcp:wallet-grants:${wallet.toLowerCase()}`;
}

function auditKey(grantId: string): string {
  return `mcp:audit:${grantId}`;
}

function rateKey(grantId: string, bucket: string): string {
  return `mcp:rate:${grantId}:${bucket}`;
}

export async function saveGrant(redis: RedisLike, grant: McpGrant): Promise<void> {
  const ttl = Math.max(
    60,
    Math.floor((Date.parse(grant.expiresAt) - Date.now()) / 1000) + 7 * 24 * 3600,
  );
  await redis.set(grantKey(grant.id), grant, { ex: ttl });
  if (redis.sadd) {
    await redis.sadd(walletGrantsKey(grant.wallet), grant.id);
  } else {
    const existing =
      (await redis.get<string[]>(walletGrantsKey(grant.wallet))) ?? [];
    if (!existing.includes(grant.id)) {
      await redis.set(walletGrantsKey(grant.wallet), [...existing, grant.id], {
        ex: ttl,
      });
    }
  }
}

export async function getGrant(
  redis: RedisLike,
  grantId: string,
): Promise<McpGrant | null> {
  return (await redis.get<McpGrant>(grantKey(grantId))) ?? null;
}

export async function listGrantsForWallet(
  redis: RedisLike,
  wallet: string,
): Promise<McpGrant[]> {
  let ids: string[] = [];
  if (redis.smembers) {
    ids = (await redis.smembers(walletGrantsKey(wallet))) ?? [];
  } else {
    ids = (await redis.get<string[]>(walletGrantsKey(wallet))) ?? [];
  }
  const grants: McpGrant[] = [];
  for (const id of ids) {
    const g = await getGrant(redis, id);
    if (g) grants.push(g);
  }
  return grants.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export async function revokeGrant(
  redis: RedisLike,
  grantId: string,
  nowIso = new Date().toISOString(),
): Promise<McpGrant | null> {
  const grant = await getGrant(redis, grantId);
  if (!grant) return null;
  const next: McpGrant = { ...grant, revokedAt: nowIso, refreshTokenHash: null };
  await saveGrant(redis, next);
  return next;
}

export async function revokeAllGrantsForWallet(
  redis: RedisLike,
  wallet: string,
): Promise<number> {
  const grants = await listGrantsForWallet(redis, wallet);
  let n = 0;
  for (const g of grants) {
    if (!g.revokedAt) {
      await revokeGrant(redis, g.id);
      n += 1;
    }
  }
  return n;
}

export function isGrantActive(
  grant: McpGrant,
  nowMs = Date.now(),
): { ok: true } | { ok: false; reason: string } {
  if (grant.revokedAt) return { ok: false, reason: "GRANT_REVOKED" };
  if (Date.parse(grant.expiresAt) <= nowMs) return { ok: false, reason: "GRANT_EXPIRED" };
  return { ok: true };
}

export async function appendAudit(
  redis: RedisLike,
  event: McpAuditEvent,
): Promise<void> {
  const key = auditKey(event.grantId);
  const line = JSON.stringify(event);
  if (redis.lpush && redis.ltrim) {
    await redis.lpush(key, line);
    await redis.ltrim(key, 0, 199);
    if (redis.expire) await redis.expire(key, 30 * 24 * 3600);
    return;
  }
  const prev = (await redis.get<McpAuditEvent[]>(key)) ?? [];
  await redis.set(key, [event, ...prev].slice(0, 200), { ex: 30 * 24 * 3600 });
}

export async function listAudit(
  redis: RedisLike,
  grantId: string,
  limit = 50,
): Promise<McpAuditEvent[]> {
  if (redis.lrange) {
    const rows = await redis.lrange(auditKey(grantId), 0, limit - 1);
    return rows
      .map((r) => {
        try {
          return JSON.parse(r) as McpAuditEvent;
        } catch {
          return null;
        }
      })
      .filter((x): x is McpAuditEvent => Boolean(x));
  }
  const prev = (await redis.get<McpAuditEvent[]>(auditKey(grantId))) ?? [];
  return prev.slice(0, limit);
}

/** Simple per-grant rate limit: max N tool calls per minute. */
export async function checkRateLimit(
  redis: RedisLike,
  grantId: string,
  maxPerMinute = 60,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const bucket = new Date().toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
  const key = rateKey(grantId, bucket);
  if (redis.incr && redis.expire) {
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, 120);
    if (n > maxPerMinute) return { ok: false, reason: "RATE_LIMITED" };
    return { ok: true };
  }
  const n = Number((await redis.get<number>(key)) ?? 0) + 1;
  await redis.set(key, n, { ex: 120 });
  if (n > maxPerMinute) return { ok: false, reason: "RATE_LIMITED" };
  return { ok: true };
}
