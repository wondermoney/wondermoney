const BACKGROUND_OPERATION_POLL_INTERVAL_MS = 2000;

export const TERMINAL_BACKGROUND_OPERATION_STATUSES = [
  "succeeded",
  "partial",
  "failed",
  "needs_action",
  "stale",
] as const;

export type TerminalBackgroundOperationStatus =
  (typeof TERMINAL_BACKGROUND_OPERATION_STATUSES)[number];

export type BackgroundOperationStatus =
  | "queued"
  | "running"
  | TerminalBackgroundOperationStatus
  | string;

export function isTerminalBackgroundOperationStatus(
  status?: string,
): status is TerminalBackgroundOperationStatus {
  return !!status && (TERMINAL_BACKGROUND_OPERATION_STATUSES as readonly string[]).includes(status);
}

export function isKnownBackgroundOperationStatus(
  status?: string,
): status is BackgroundOperationStatus {
  return (
    !!status &&
    (["queued", "running", ...TERMINAL_BACKGROUND_OPERATION_STATUSES] as const).includes(
      status as BackgroundOperationStatus,
    )
  );
}

export function getBackgroundOperationRefetchInterval(
  status?: string,
  progress?: null | Record<string, unknown>,
) {
  return status === "queued" ||
    status === "running" ||
    ((status === "partial" || status === "succeeded") && !progress)
    ? BACKGROUND_OPERATION_POLL_INTERVAL_MS
    : false;
}
