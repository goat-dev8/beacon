import { describe, expect, it } from "vitest";
import { JobStatus, transition, canTransition } from "@beacon/shared";

describe("job state machine", () => {
  it("creates job into quoting", () => {
    expect(transition(JobStatus.DRAFT, "create_job")).toBe(JobStatus.QUOTING);
  });

  it("quotes on fit", () => {
    expect(transition(JobStatus.QUOTING, "sealed_fit_fit")).toBe(JobStatus.QUOTED);
  });

  it("accept report branches", () => {
    expect(transition(JobStatus.ACCEPTING, "accept_report", "NEEDS_LOOK")).toBe(JobStatus.NEEDS_LOOK);
    expect(transition(JobStatus.ACCEPTING, "accept_report", "PASS")).toBe(JobStatus.PASSED);
  });

  it("guards illegal transitions", () => {
    expect(canTransition(JobStatus.CLOSED, "create_job")).toBe(false);
  });
});
