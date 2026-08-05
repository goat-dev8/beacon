import { describe, expect, it } from "vitest";
import {
  ALLOWED_TRANSITIONS,
  assertTransition,
  canTransition,
  ExecutionTransitionError,
  hashImmutableInput,
  isTerminalPhase,
} from "./index.js";
import type { ExecutionPhase } from "./types.js";

describe("execution phase transitions", () => {
  it("allows the happy-path lifecycle", () => {
    const path: ExecutionPhase[] = [
      "understanding",
      "clarifying",
      "job_created",
      "quoting",
      "risk_checking",
      "awaiting_authorization",
      "authorized",
      "executing",
      "observing",
      "verifying",
      "settling",
      "completed",
    ];

    for (let i = 0; i < path.length - 1; i += 1) {
      expect(() => assertTransition(path[i], path[i + 1])).not.toThrow();
    }
  });

  it("allows idempotent same-phase transitions", () => {
    expect(canTransition("executing", "executing")).toBe(true);
    expect(() => assertTransition("awaiting_authorization", "awaiting_authorization")).not.toThrow();
  });

  it("rejects illegal backward jumps", () => {
    expect(() => assertTransition("executing", "quoting")).toThrow(ExecutionTransitionError);
    expect(() => assertTransition("completed", "executing")).toThrow(ExecutionTransitionError);
    expect(() => assertTransition("authorized", "understanding")).toThrow(ExecutionTransitionError);
  });

  it("allows recovery from blocked state", () => {
    expect(canTransition("blocked", "risk_checking")).toBe(true);
    expect(canTransition("blocked", "quoting")).toBe(true);
    expect(canTransition("blocked", "executing")).toBe(false);
  });

  it("marks terminal phases", () => {
    expect(isTerminalPhase("completed")).toBe(true);
    expect(isTerminalPhase("canceled")).toBe(true);
    expect(isTerminalPhase("executing")).toBe(false);
  });

  it("defines outgoing edges for every phase", () => {
    const phases = Object.keys(ALLOWED_TRANSITIONS) as ExecutionPhase[];
    expect(phases).toHaveLength(17);
    for (const phase of phases) {
      expect(Array.isArray(ALLOWED_TRANSITIONS[phase])).toBe(true);
    }
  });
});

describe("immutable input hashing", () => {
  it("produces stable hashes regardless of key order", () => {
    const a = { brief: "logo", serviceId: "image", meta: { z: 1, a: 2 } };
    const b = { serviceId: "image", meta: { a: 2, z: 1 }, brief: "logo" };
    expect(hashImmutableInput(a)).toBe(hashImmutableInput(b));
  });

  it("supports idempotency keys derived from frozen job input", () => {
    const frozenJob = {
      executionId: "exec-1",
      workflowType: "media.image",
      workflowVersion: "1",
      brief: "mint mark on dark background",
      priceCents: 588,
    };

    const idempotencyKey = `${frozenJob.executionId}:${hashImmutableInput(frozenJob)}`;
    expect(idempotencyKey).toMatch(/^exec-1:[a-f0-9]{64}$/);
    expect(idempotencyKey).toBe(
      `${frozenJob.executionId}:${hashImmutableInput({ ...frozenJob })}`,
    );
  });

  it("changes hash when immutable input changes", () => {
    const base = { brief: "logo", amount: "10" };
    const changed = { brief: "logo", amount: "11" };
    expect(hashImmutableInput(base)).not.toBe(hashImmutableInput(changed));
  });
});
