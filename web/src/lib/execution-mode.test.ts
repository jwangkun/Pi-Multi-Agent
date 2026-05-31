import { describe, expect, it } from "vitest";
import { resolveAutoExecution } from "./execution-mode";

describe("resolveAutoExecution", () => {
  it("routes deep analysis to the deep cluster pipeline", () => {
    expect(resolveAutoExecution({ level: "deep", mode: "deep", agentCount: 8 })).toEqual({
      kind: "deep",
      mode: "deep",
      agentCount: 8,
    });
  });

  it("does not send deep mode to the collaboration endpoint", () => {
    const execution = resolveAutoExecution({
      level: "complex",
      mode: "deep",
      agentCount: 8,
    });

    expect(execution.kind).toBe("deep");
  });

  it("keeps medium parallel analysis on a supported collaboration mode", () => {
    expect(resolveAutoExecution({ level: "medium", mode: "parallel", agentCount: 3 })).toEqual({
      kind: "collaboration",
      mode: "parallel",
      agentCount: 3,
    });
  });
});
