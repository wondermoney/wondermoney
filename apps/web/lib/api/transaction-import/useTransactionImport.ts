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

/** The file formats a session reads; `pdf` is a PDF statement read by the vision model. */
export type ImportFormat =
  | "actual"
  | "camt053"
  | "generic-csv"
  | "ofx"
  | "pdf"
  | "qif"
  | "statement"
  | "ynab";

/**
 * Whether a PDF statement's balances add up: its opening balance plus its rows is its closing
 * balance (`matched`), or not (`mismatch`, with the `difference` the rows are missing), or it prints
 * no balances to check (`unavailable`).
 */
export interface StatementReconciliation {
  closingBalance: number | null;
  currency: string | null;
  difference: number | null;
  openingBalance: number | null;
  rowsTotal: number;
  status: "matched" | "mismatch" | "unavailable";
}

/** A PDF statement's read: its pages, how many are read, and once all are, its balance check. */
export interface StatementExtraction {
  pageCount: number | null;
  pagesRead: number;
  reconciliation?: StatementReconciliation;
}

/** A category the file uses (YNAB, Actual Budget), for the category-mapping step. */
export interface ImportSourceCategory {
  /** The group the source app files it under. */
  group?: string;
  label: string;
  /** The category's own name, without its group. */
  name: string;
  rowCount: number;
  /** The household category whose stored name matches, when exactly one does. */
  suggestedCategoryId?: number;
}

export interface TransactionImportSession {
  accountId: number | null;
  accountMapping: Record<string, number>;
  canCommit: boolean;
  canRetry: boolean;
  /** The person's choices: a file category's label to a category id, or null for uncategorised. */
  categoryMapping: Record<string, number | null>;
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
  /** The name the file had on the person's device; null on imports started before it was kept. */
  fileName: string | null;
  format: ImportFormat;
  id: string;
  sourceAccounts: {
    currency?: string;
    label: string;
    rowCount: number;
    /** The account whose number holds this statement's IBAN, or whose name matches, to pre-fill the mapping. */
    suggestedAccountId?: number;
  }[];
  /** The file's categories, for the category-mapping step; empty for a format that maps none. */
  sourceCategories: ImportSourceCategory[];
  /** A PDF statement's pages and balance check; null for other formats, absent on an older API. */
  statementExtraction?: StatementExtraction | null;
  status: ImportSessionStatus;
  upload: { key: string; url: string } | null;
  warnings: { code: string; detail?: string; sourceRow?: number }[];
}

/**
 * Why a row is a duplicate or a possible one: its id is on the account (`same_id`), it repeats an
 * earlier row of the file (`earlier_in_file`), it likely repeats the matched transaction
 * (`likely`), or several transactions could be it and none is matched (`ambiguous`).
 */
export type ImportMatchReason =
  "same_id" | "earlier_in_file" | "likely" | "ambiguous";

export interface TransactionImportRow {
  decision: ImportDecision | null;
  error: string | null;
  id: number;
  /** Absent from an API that predates it. */
  matchReason?: ImportMatchReason | null;
  /** The transaction on the account the row repeats, or likely repeats. */
  matchedTransaction: {
    amount: number | null;
    date: string | null;
    description: string | null;
    id: number;
  } | null;
  normalized: {
    amount: number;
    categoryLabel?: string;
    currency?: string;
    date: string;
    description: string;
    merchant?: string;
    sourceAccountLabel?: string;
    transferAccountLabel?: string;
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
  /** The name the file had on the person's device, kept for the import's history. */
  fileName?: string;
  /** The format the file is read in; `statement` unless the file is OFX/QFX, QIF, CAMT.053, a YNAB or an Actual Budget export. */
  format?: "actual" | "camt053" | "ofx" | "qif" | "statement" | "ynab";
  /** The file, already uploaded for this account. */
  key: string;
  /** The columns confirmed in the preview; absent when the bank's own parser reads the file. */
  mapping?: StatementMapping;
}

export function useCreateTransactionImport() {
  return useMutation({
    mutationFn: ({
      accountId,
      fileName,
      format = "statement",
      key,
      mapping,
    }: CreateTransactionImportRequest) =>
      api
        .post<{ session: TransactionImportSession }>(base, {
          accountId: Number(accountId),
          ...(fileName ? { fileName } : {}),
          format,
          key,
          ...(mapping ? { options: { mapping } } : {}),
        })
        .then((response) => response.data.session),
  });
}

export interface CreatePdfTransactionImportRequest {
  accountId: number | string;
  /** The PDF's size in bytes; the upload link is signed for exactly this. */
  contentLength: number;
  fileName?: string;
}

/**
 * Start a PDF statement import: the session waits for the PDF, and carries the link to PUT it to.
 * Spends one of the household's daily statement imports.
 */
export function useCreatePdfTransactionImport() {
  return useMutation({
    mutationFn: ({
      accountId,
      contentLength,
      fileName,
    }: CreatePdfTransactionImportRequest) =>
      api
        .post<{ session: TransactionImportSession }>(`${base}/pdf`, {
          accountId: Number(accountId),
          contentLength,
          ...(fileName ? { fileName } : {}),
        })
        .then((response) => response.data.session),
  });
}

/** Read the uploaded file: the first read of a PDF statement, once it is uploaded. */
export function useStartTransactionImportRead() {
  return useMutation({
    mutationFn: (id: string) =>
      api
        .post<{ session: TransactionImportSession }>(`${base}/${id}/parse`, {})
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

export interface TransactionImportAccountMapping {
  /** The file's account labels to the person's account ids. */
  mapping: Record<string, number>;
  /** The file's account labels to import into a new manual account each, named after it. */
  create?: string[];
}

export function useMapTransactionImportAccounts() {
  return useSessionMutation(
    (id: string, { create, mapping }: TransactionImportAccountMapping) =>
      api.patch(`${base}/${id}/account-mapping`, {
        mapping,
        ...(create && create.length > 0 ? { create } : {}),
      }),
  );
}

/** The file's category labels to category ids, or null to leave their rows uncategorised. */
export function useMapTransactionImportCategories() {
  return useSessionMutation(
    (id: string, mapping: Record<string, number | null>) =>
      api.patch(`${base}/${id}/category-mapping`, { mapping }),
  );
}

/** Read the file again with corrected reader options: a QIF or YNAB file's date order. */
export function useParseTransactionImport() {
  return useSessionMutation(
    (
      id: string,
      input: { dateOrder: "day-first" | "month-first" } | undefined,
    ) => api.post(`${base}/${id}/parse`, input ? { options: input } : {}),
  );
}

/** `acknowledgeMismatch`: the person saw that a PDF statement's balances do not add up, and imports it anyway. */
export function useCommitTransactionImport() {
  return useSessionMutation(
    (id: string, input: { acknowledgeMismatch?: boolean } | undefined) =>
      api.post(
        `${base}/${id}/commit`,
        input?.acknowledgeMismatch ? { acknowledgeMismatch: true } : undefined,
      ),
  );
}

export function useCancelTransactionImport() {
  return useSessionMutation((id: string, _input: undefined) =>
    api.post(`${base}/${id}/cancel`),
  );
}
