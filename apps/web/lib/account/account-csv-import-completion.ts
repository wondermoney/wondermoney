export type AccountCsvImportSuccessCallback = () => void;

export interface AccountCsvImportSuccessTracker {
  current: string | undefined;
}

export function notifyAccountCsvImportSuccess({
  authoritativeCorrelationId,
  authoritativeStatus,
  correlationId,
  onSuccess,
  tracker,
}: {
  authoritativeCorrelationId?: string;
  authoritativeStatus?: string;
  correlationId?: string;
  onSuccess?: AccountCsvImportSuccessCallback;
  tracker: AccountCsvImportSuccessTracker;
}): boolean {
  if (
    authoritativeStatus !== "succeeded" ||
    !correlationId ||
    authoritativeCorrelationId !== correlationId ||
    tracker.current === correlationId
  ) {
    return false;
  }

  tracker.current = correlationId;
  onSuccess?.();
  return true;
}
