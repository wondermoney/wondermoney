export type LegacyBankSyncStatus =
  | "idle"
  | "processing"
  | "full_success"
  | "failed"
  | "transport_unavailable";

interface LegacyRequisitionStatusLike {
  requisition?: {
    status?: string | null;
    accounts?: Array<{ refreshedAt?: string | null }>;
  } | null;
}

interface LegacyBankSyncStatusInput {
  enabled: boolean;
  isError: boolean;
  isFetched: boolean;
  data?: LegacyRequisitionStatusLike;
}

export function getLegacyBankSyncStatus({
  enabled,
  isError,
  isFetched,
  data,
}: LegacyBankSyncStatusInput): LegacyBankSyncStatus {
  if (!enabled) return "idle";
  if (isError) return "transport_unavailable";
  if (!isFetched || !data?.requisition) return "processing";

  const status = data.requisition.status?.toLowerCase();
  if (status === "error" || status === "expired") return "failed";

  const accounts = data.requisition.accounts ?? [];
  return accounts.length > 0 &&
    accounts.every((account) => Boolean(account.refreshedAt))
    ? "full_success"
    : "processing";
}
