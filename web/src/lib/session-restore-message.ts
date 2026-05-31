type SessionStatus = "idle" | "running" | "completed" | "failed";

interface RestoreMessageInput {
  status: SessionStatus;
  active: boolean;
}

export function getRestoreMessage({ status, active }: RestoreMessageInput): string {
  if (status === "running") {
    return active
      ? "Reconnected to running session."
      : "Previous execution was interrupted by a server restart.";
  }

  return `Restored ${status} session from disk.`;
}
