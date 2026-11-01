export type BankAccountSyncStatus = "idle" | "processing" | "ready" | "error";

const BANK_ACCOUNT_SYNC_POLL_INTERVAL_MS = 2500;

interface SyncAccountLike {
  refreshedAt?: string | null;
}

interface SyncRequisitionLike {
  accounts?: SyncAccountLike[];
  requisitionId?: string | null;
  status?: string | null;
}

interface GetBankAccountSyncStatusInput {
  hasRequisitionId: boolean;
  isError: boolean;
  isFetched: boolean;
  requisition?: SyncRequisitionLike | null;
}

const ERROR_REQUISITION_STATUSES = new Set(["error", "expired"]);

export function getBankAccountSyncStatus({
  hasRequisitionId,
  isError,
  isFetched,
  requisition,
}: GetBankAccountSyncStatusInput): BankAccountSyncStatus {
  if (!hasRequisitionId) return "idle";
  if (isError) return "error";
  if (!isFetched) return "processing";
  if (!requisition?.requisitionId) return "error";
  if (requisition.status && ERROR_REQUISITION_STATUSES.has(requisition.status)) {
    return "error";
  }

  const accounts = requisition.accounts ?? [];
  if (accounts.length === 0) return "processing";

  return accounts.every((account) => Boolean(account.refreshedAt))
    ? "ready"
    : "processing";
}

export function getBankAccountSyncRefetchInterval(
  status: BankAccountSyncStatus,
) {
  return status === "processing" ? BANK_ACCOUNT_SYNC_POLL_INTERVAL_MS : false;
}
