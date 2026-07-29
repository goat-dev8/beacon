import { describe, expect, it } from "vitest";
import { runL1Objective, runL3Brand } from "./index.js";

describe("acceptance L1/L3", () => {
  it("passes objective checks for documents markdown", () => {
    const result = runL1Objective({
      jobId: "j1",
      serviceId: "documents",
      rubricVersion: "v1",
      artifacts: [{ kind: "document", uri: "/tmp/a.md", mimeType: "text/markdown" }],
    });
    expect(result.passed).toBe(true);
  });

  it("fails brand rules when forbidden term appears", () => {
    const result = runL3Brand({
      jobId: "j1",
      serviceId: "documents",
      rubricVersion: "v1",
      brandForbiddenWords: ["CompetitorCo"],
      artifacts: [
        {
          kind: "document",
          uri: "out.md",
          mimeType: "text/markdown",
          payload: "Hello CompetitorCo world",
        },
      ],
    });
    expect(result.passed).toBe(false);
  });
});
