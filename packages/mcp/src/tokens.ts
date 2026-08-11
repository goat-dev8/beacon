import { createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";

type Envelope = {
  v: 1;
  kind: "mcp_access" | "mcp_refresh";
  grantId: string;
  wallet: string;
  nonce: string;
  iat: number;
  exp: number;
};

export const MCP_ACCESS_TTL_SECONDS = 60 * 60; // 1h
export const MCP_REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60; // 7d max default

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function mac(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function signEnvelope(value: Envelope, secret: string): string {
  const payload = encode(JSON.stringify(value));
  return `${payload}.${mac(payload, secret)}`;
}

function readEnvelope(token: string, secret: string): Envelope | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expected = Buffer.from(mac(payload, secret), "utf8");
  const received = Buffer.from(signature, "utf8");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return null;
  }
  try {
    const parsed = JSON.parse(decode(payload)) as Partial<Envelope>;
    if (
      parsed.v !== 1 ||
      (parsed.kind !== "mcp_access" && parsed.kind !== "mcp_refresh") ||
      typeof parsed.grantId !== "string" ||
      typeof parsed.wallet !== "string" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.iat !== "number" ||
      typeof parsed.exp !== "number"
    ) {
      return null;
    }
    return parsed as Envelope;
  } catch {
    return null;
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function issueMcpAccessToken(opts: {
  grantId: string;
  wallet: string;
  secret: string;
  ttlSeconds?: number;
  nowSeconds?: number;
}): { token: string; expiresAt: number } {
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  const ttl = opts.ttlSeconds ?? MCP_ACCESS_TTL_SECONDS;
  const expiresAt = now + ttl;
  const token = signEnvelope(
    {
      v: 1,
      kind: "mcp_access",
      grantId: opts.grantId,
      wallet: opts.wallet.toLowerCase(),
      nonce: randomBytes(16).toString("hex"),
      iat: now,
      exp: expiresAt,
    },
    opts.secret,
  );
  return { token, expiresAt };
}

export function issueMcpRefreshToken(opts: {
  grantId: string;
  wallet: string;
  secret: string;
  expiresAt: number;
  nowSeconds?: number;
}): string {
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  return signEnvelope(
    {
      v: 1,
      kind: "mcp_refresh",
      grantId: opts.grantId,
      wallet: opts.wallet.toLowerCase(),
      nonce: randomBytes(16).toString("hex"),
      iat: now,
      exp: opts.expiresAt,
    },
    opts.secret,
  );
}

export function verifyMcpAccessToken(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): { grantId: string; wallet: string; issuedAt: number; expiresAt: number } | null {
  const env = readEnvelope(token, secret);
  if (!env || env.kind !== "mcp_access") return null;
  if (env.exp < nowSeconds || env.iat > nowSeconds + 30) return null;
  return {
    grantId: env.grantId,
    wallet: env.wallet.toLowerCase(),
    issuedAt: env.iat,
    expiresAt: env.exp,
  };
}

export function verifyMcpRefreshToken(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): { grantId: string; wallet: string; issuedAt: number; expiresAt: number } | null {
  const env = readEnvelope(token, secret);
  if (!env || env.kind !== "mcp_refresh") return null;
  if (env.exp < nowSeconds || env.iat > nowSeconds + 30) return null;
  return {
    grantId: env.grantId,
    wallet: env.wallet.toLowerCase(),
    issuedAt: env.iat,
    expiresAt: env.exp,
  };
}

export function newGrantId(): string {
  return `mcp_${randomBytes(12).toString("hex")}`;
}

export function newAuthCode(): string {
  return randomBytes(24).toString("base64url");
}
