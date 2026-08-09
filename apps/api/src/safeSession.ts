import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { verifyMessage } from "ethers";

const CHALLENGE_TTL_SECONDS = 5 * 60;
export const SAFE_SESSION_TTL_SECONDS = 24 * 60 * 60;

type Envelope = {
  v: 1;
  kind: "challenge" | "session";
  wallet: string;
  nonce: string;
  iat: number;
  exp: number;
};

export type SafeSession = {
  wallet: string;
  issuedAt: number;
  expiresAt: number;
};

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
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const parsed = JSON.parse(decode(payload)) as Partial<Envelope>;
    if (
      parsed.v !== 1 ||
      (parsed.kind !== "challenge" && parsed.kind !== "session") ||
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

function normalizeWallet(wallet: string): string {
  return wallet.toLowerCase();
}

export function createSafeSessionChallenge(
  wallet: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): { message: string; expiresAt: number } {
  const expiresAt = nowSeconds + CHALLENGE_TTL_SECONDS;
  const proof = signEnvelope(
    {
      v: 1,
      kind: "challenge",
      wallet: normalizeWallet(wallet),
      nonce: randomBytes(16).toString("hex"),
      iat: nowSeconds,
      exp: expiresAt,
    },
    secret,
  );
  const message = [
    "Beacon Agent session",
    `wallet:${normalizeWallet(wallet)}`,
    "chain:114",
    "scope:Safe jobs, swaps, and bridges within your on-chain policy",
    `expires:${expiresAt}`,
    `proof:${proof}`,
  ].join("\n");
  return { message, expiresAt };
}

export function verifyChallengeAndIssueSession(opts: {
  wallet: string;
  message: string;
  signature: string;
  secret: string;
  nowSeconds?: number;
}): { token: string; session: SafeSession } | null {
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  const lines = opts.message.trim().split(/\r?\n/);
  if (lines[0] !== "Beacon Agent session") return null;
  const proof = lines.find((line) => line.startsWith("proof:"))?.slice(6);
  if (!proof) return null;
  const challenge = readEnvelope(proof, opts.secret);
  const wallet = normalizeWallet(opts.wallet);
  if (
    !challenge ||
    challenge.kind !== "challenge" ||
    challenge.wallet !== wallet ||
    challenge.exp < now ||
    challenge.iat > now + 30
  ) {
    return null;
  }
  if (!lines.includes(`wallet:${wallet}`) || !lines.includes("chain:114")) return null;

  let recovered: string;
  try {
    recovered = verifyMessage(opts.message, opts.signature).toLowerCase();
  } catch {
    return null;
  }
  if (recovered !== wallet) return null;

  // Bind every session minted from this signed challenge to the challenge's
  // issuance time so revocation also blocks replaying an older signature.
  const issuedAt = challenge.iat;
  const expiresAt = issuedAt + SAFE_SESSION_TTL_SECONDS;
  const token = signEnvelope(
    {
      v: 1,
      kind: "session",
      wallet,
      nonce: randomBytes(16).toString("hex"),
      iat: issuedAt,
      exp: expiresAt,
    },
    opts.secret,
  );
  return {
    token,
    session: { wallet, issuedAt, expiresAt },
  };
}

export function verifySafeSessionToken(
  token: string,
  wallet: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): SafeSession | null {
  const envelope = readEnvelope(token, secret);
  if (
    !envelope ||
    envelope.kind !== "session" ||
    envelope.wallet !== normalizeWallet(wallet) ||
    envelope.exp < nowSeconds ||
    envelope.iat > nowSeconds + 30
  ) {
    return null;
  }
  return {
    wallet: envelope.wallet,
    issuedAt: envelope.iat,
    expiresAt: envelope.exp,
  };
}
