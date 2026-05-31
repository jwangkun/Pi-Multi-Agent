import { describe, expect, it } from "vitest";
import { getRestoreMessage } from "./session-restore-message";

describe("getRestoreMessage", () => {
  it("describes active running sessions as reconnections", () => {
    expect(getRestoreMessage({ status: "running", active: true })).toBe("Reconnected to running session.");
  });

  it("describes inactive running sessions as interrupted", () => {
    expect(getRestoreMessage({ status: "running", active: false })).toBe(
      "Previous execution was interrupted by a server restart."
    );
  });

  it("describes completed historical sessions as restored from disk", () => {
    expect(getRestoreMessage({ status: "completed", active: false })).toBe("Restored completed session from disk.");
  });
});
