import { describe, expect, it, vi } from "vitest";
import { AppError } from "@beacon/shared";
import { runAfterPolicyAllows } from "./policyBeforeSpend.js";
import * as securityPolicy from "./securityPolicy.js";

describe("policy-before-spend gate", () => {
  it("does not invoke the action when policy denies", async () => {
    const action = vi.fn(async () => {
      throw new Error("executeSafeJobLock must never run");
    });
    vi.spyOn(securityPolicy, "assertPolicyAllows").mockRejectedValueOnce(
      new AppError("VALIDATION", { message: "Emergency pause is active" }),
    );

    await expect(
      runAfterPolicyAllows(
        null,
        { wallet: "0x1111111111111111111111111111111111111111", amountUsdt0: 1, agentId: "desk" },
        action,
      ),
    ).rejects.toMatchObject({ message: expect.stringMatching(/pause|policy|denied|Emergency/i) });

    expect(action).not.toHaveBeenCalled();
  });

  it("invokes the action only after policy allows", async () => {
    vi.spyOn(securityPolicy, "assertPolicyAllows").mockResolvedValueOnce({
      policy: securityPolicy.DEFAULT_SECURITY_POLICY,
      spentToday: 0,
    });
    const action = vi.fn(async () => ({ lockTxHash: "0xabc" }));

    const result = await runAfterPolicyAllows(
      null,
      { wallet: "0x1111111111111111111111111111111111111111", amountUsdt0: 1, agentId: "desk" },
      action,
    );

    expect(action).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ lockTxHash: "0xabc" });
  });

  it("source order: Safe approve routes gate policy before executeSafeJobLock", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const src = await fs.readFile(path.join(process.cwd(), "apps/api/src/index.ts"), "utf8");

    const approveSafeStart = src.indexOf('app.post("/v1/jobs/:id/approve-safe"');
    const approveStart = src.indexOf('app.post("/v1/jobs/:id/approve"');
    expect(approveSafeStart).toBeGreaterThan(-1);
    expect(approveStart).toBeGreaterThan(-1);

    const approveSafeBlock = src.slice(approveSafeStart, approveSafeStart + 2500);
    const policyIdx = approveSafeBlock.indexOf("runAfterPolicyAllows");
    const lockIdx = approveSafeBlock.indexOf("executeSafeJobLock");
    expect(policyIdx).toBeGreaterThan(-1);
    expect(lockIdx).toBeGreaterThan(-1);
    expect(policyIdx).toBeLessThan(lockIdx);

    // Safe branch inside /approve: policy gate before lock
    const modeSafe = src.indexOf('if (mode === "safe")', approveStart);
    const modeSafeBlock = src.slice(modeSafe, modeSafe + 1800);
    const p2 = modeSafeBlock.indexOf("runAfterPolicyAllows");
    const l2 = modeSafeBlock.indexOf("executeSafeJobLock");
    expect(p2).toBeGreaterThan(-1);
    expect(l2).toBeGreaterThan(-1);
    expect(p2).toBeLessThan(l2);
  });
});
