import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import type { StatementMapping } from "../account/usePreviewAccountCsvImport";
import api from "../api";

/*
 * Staged transaction imports (`/v1/transaction-import-sessions`): a file is read into rows, the
 * rows are reviewed and decided, and only the commit writes transactions.
 */

export type ImportRowStatus =
  | "duplicate"
  | "failed"
  | "imported"
  | "invalid"
  | "new"
  | "possible_duplicate"
  | "skipped";

export type ImportDecision = "import" | "skip";

export type ImportSessionStatus =
  | "cancelled"
  | "expired"
  | "failed"
  | "importing"
  | "needs_mapping"
  | "parsing"
  | "partial"
  | "ready"
  | "succeeded"
  | "waiting_for_upload";

export interface TransactionImportSession {
  accountId: number | null;
  accountMapping: Record<string, number>;
  canCommit: boolean;
  canRetry: boolean;
  /** When the commit finished. */
  committedAt: string | null;
  correlationId: string | null;
  counts: Record<ImportRowStatus, number>;
  createdAt: string;
  decisions: Record<ImportDecision, number>;
  /** Set 7 days after a commit, when the rows and file are deleted: only the summary (`counts`) is left. */
  detailsDeletedAt: string | null;
  errorCode: string | null;
  expiresAt: string;
  format: "statement";
  id: string;
  sourceAccounts: { currency?: string; label: string; rowCount: number }[];
  status: ImportSessionStatus;
  upload: { key: string; url: string } | null;
  warnings: { code: string; detail?: string; sourceRow?: number }[];
}

export interface TransactionImportRow {
  decision: ImportDecision | null;
  error: string | null;
  id: number;
  matchedTransaction: {
    amount: number | null;
    date: string | null;
    description: string | null;
    id: number;
  } | null;
  normalized: {
    amount: number;
    currency?: string;
    date: string;
    description: string;
    merchant?: string;
    sourceAccountLabel?: string;
  } | null;
  sourceRow: number;
  status: ImportRowStatus;
  targetAccountId: number | null;
}

export interface TransactionImportView {
  rows: {
    items: TransactionImportRow[];
    page: number;
    pageSize: number;
    total: number;
  };
  session: TransactionImportSession;
}

export interface TransactionImportRowQuery {
  page?: number;
  pageSize?: number;
  status?: ImportRowStatus;
}

/** Statuses the review waits on: the worker is reading or writing. */
const WORKING_STATUSES: ReadonlySet<ImportSessionStatus> =
  new Set<ImportSessionStatus>(["parsing", "importing"]);

/** Statuses that end a session. */
export const FINISHED_IMPORT_STATUSES: ReadonlySet<ImportSessionStatus> =
  new Set<ImportSessionStatus>([
    "succeeded",
    "partial",
    "failed",
    "cancelled",
    "expired",
  ]);

const POLL_MS = 2000;

/** How often to read a session again: while the worker is on it, every two seconds; otherwise not. */
export function getTransactionImportRefetchInterval(
  session: Pick<TransactionImportSession, "canRetry" | "status"> | undefined,
): false | number {
  if (!session) return false;
  return WORKING_STATUSES.has(session.status) && !session.canRetry
    ? POLL_MS
    : false;
}

export const transactionImportKey = (
  id: string | undefined,
  query: TransactionImportRowQuery = {},
) => ["transaction-import", id, query] as const;

const base = "/v1/transaction-import-sessions";

export function useTransactionImport(
  id: string | undefined,
  query: TransactionImportRowQuery = {},
) {
  return useQuery({
    enabled: !!id,
    placeholderData: keepPreviousData,
    queryKey: transactionImportKey(id, query),
    queryFn: () =>
      api
        .get<TransactionImportView>(`${base}/${id}`, { params: query })
        .then((response) => response.data),
    refetchInterval: (state) =>
      getTransactionImportRefetchInterval(state.state.data?.session),
  });
}

export interface CreateTransactionImportRequest {
  accountId: number | string;
  /** The file, already uploaded for this account. */
  key: string;
  /** The columns confirmed in the preview; absent when the bank's own parser reads the file. */
  mapping?: StatementMapping;
}

export function useCreateTransactionImport() {
  return useMutation({
    mutationFn: ({ accountId, key, mapping }: CreateTransactionImportRequest) =>
      api
        .post<{ session: TransactionImportSession }>(base, {
          accountId: Number(accountId),
          format: "statement",
          key,
          ...(mapping ? { options: { mapping } } : {}),
        })
        .then((response) => response.data.session),
  });
}

/** A mutation on one session that refreshes every page of it read so far. */
function useSessionMutation<TInput>(
  request: (id: string, input: TInput) => Promise<unknown>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: TInput }) =>
      request(id, input),
    onSuccess: (_data, { id }) =>
      queryClient.invalidateQueries({ queryKey: ["transaction-import", id] }),
  });
}

export function useDecideTransactionImportRows() {
  return useSessionMutation(
    (
      id: string,
      input: {
        decision: ImportDecision;
        rowIds?: number[];
        status?: ImportRowStatus;
      },
    ) => api.patch(`${base}/${id}/rows`, input),
  );
}

export function useMapTransactionImportAccounts() {
  return useSessionMutation((id: string, mapping: Record<string, number>) =>
    api.patch(`${base}/${id}/account-mapping`, { mapping }),
  );
}

export function useCommitTransactionImport() {
  return useSessionMutation((id: string, _input: undefined) =>
    api.post(`${base}/${id}/commit`),
  );
}

export function useCancelTransactionImport() {
  return useSessionMutation((id: string, _input: undefined) =>
    api.post(`${base}/${id}/cancel`),
  );
}
