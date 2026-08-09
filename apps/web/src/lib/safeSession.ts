import { api } from "./api";
import { signPersonalMessage } from "./wallet";

export type SafeAgentSession = {
  token: string;
  wallet: string;
  issuedAt: number;
  expiresAt: number;
};

const inFlight = new Map<string, Promise<SafeAgentSession>>();

function storageKey(wallet: string): string {
  return `beacon.safe-agent-session.${wallet.toLowerCase()}`;
}

export function readSafeAgentSession(wallet: string | null): SafeAgentSession | null {
  if (!wallet || typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(storageKey(wallet));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SafeAgentSession>;
    if (
      typeof parsed.token !== "string" ||
      typeof parsed.wallet !== "string" ||
      typeof parsed.issuedAt !== "number" ||
      typeof parsed.expiresAt !== "number" ||
      parsed.wallet.toLowerCase() !== wallet.toLowerCase() ||
      parsed.expiresAt <= Math.floor(Date.now() / 1000) + 30
    ) {
      sessionStorage.removeItem(storageKey(wallet));
      return null;
    }
    return parsed as SafeAgentSession;
  } catch {
    return null;
  }
}

export function clearSafeAgentSession(wallet: string | null): void {
  if (!wallet || typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(storageKey(wallet));
}

/**
 * One wallet signature per browser tab/session. After this, the Beacon executor
 * submits Jobs, Safe swaps, and bridges while the vault contract enforces caps.
 */
export async function ensureSafeAgentSession(wallet: string): Promise<SafeAgentSession> {
  const current = readSafeAgentSession(wallet);
  if (current) return current;

  const key = wallet.toLowerCase();
  const pending = inFlight.get(key);
  if (pending) return pending;

  const next = (async () => {
    const challenge = await api.createSafeSessionChallenge(wallet);
    const signature = await signPersonalMessage(challenge.message);
    const issued = await api.verifySafeSession({
      wallet,
      message: challenge.message,
      signature,
    });
    const session: SafeAgentSession = {
      token: issued.token,
      wallet: issued.wallet,
      issuedAt: issued.issuedAt,
      expiresAt: issued.expiresAt,
    };
    sessionStorage.setItem(storageKey(wallet), JSON.stringify(session));
    return session;
  })();

  inFlight.set(key, next);
  try {
    return await next;
  } finally {
    inFlight.delete(key);
  }
}
