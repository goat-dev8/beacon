/**
 * Value-moving actions MUST evaluate policy before any irreversible chain effect.
 * Denied policy → zero transaction, zero token movement, zero spend accounting.
 */
import type { Redis } from "@upstash/redis";
import {
  assertPolicyAllows,
  type PolicyCheckInput,
} from "./securityPolicy.js";

export type PolicyGateResult<T> =
  | { ok: true; value: T; spentToday: number }
  | { ok: false; reason: string; executed: false };

/**
 * Run `action` only after policy allows. If policy throws/denies, `action` is never invoked.
 */
export async function runAfterPolicyAllows<T>(
  redis: Redis | null,
  input: PolicyCheckInput,
  action: () => Promise<T>,
): Promise<T> {
  const gate = await assertPolicyAllows(redis, input);
  void gate;
  return action();
}
