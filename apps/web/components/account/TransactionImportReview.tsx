"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Amount } from "@/components/ui/Amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import type { Account } from "@/lib/api/account/useAccounts";
import {
  FINISHED_IMPORT_STATUSES,
  type ImportRowStatus,
  type ImportSessionStatus,
  type TransactionImportRow,
  type TransactionImportSession,
  useCancelTransactionImport,
  useCommitTransactionImport,
  useDecideTransactionImportRows,
  useMapTransactionImportAccounts,
  useParseTransactionImport,
  useTransactionImport,
} from "@/lib/api/transaction-import/useTransactionImport";
import { useRateLimitToast } from "@/lib/api/useRateLimitToast";
import { useFormatShortDate } from "@/lib/utils/useFormatShortDate";

const PAGE_SIZE = 50;
/** The filters the review offers, in order; a status with no rows is not offered. */
const FILTERS = ["new", "duplicate", "possible_duplicate", "invalid"] as const;
type Filter = (typeof FILTERS)[number] | "all";
const DECIDABLE: ReadonlySet<ImportRowStatus> = new Set<ImportRowStatus>([
  "new",
  "duplicate",
  "possible_duplicate",
]);

/** A QIF file whose dates the reader could not order: it read them day-first and asks. */
const dateOrderAmbiguous = (session: TransactionImportSession) =>
  session.warnings.some(
    (warning) =>
      warning.code === "date_order_ambiguous" ||
      warning.code === "date_order_conflict",
  );

/** A row date (an ISO timestamp) as its calendar day, wherever the reader is. */
const calendarDay = (iso: string) => {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day);
};

interface TransactionImportReviewProps {
  importId: string;
  /** The accounts a file with several accounts can map to: the person's own. */
  accounts: Account[];
  /** Called once when the import ends, however it ended. */
  onFinished: (session: TransactionImportSession) => void;
  /** Called when the person cancels before committing. */
  onCancelled: () => void;
}

/**
 * The review step of a staged import: the file's rows by status (new, already
 * in the account, unreadable), each included or skipped, in bulk or one by
 * one; an account per source account when the file holds several; then the
 * commit, which runs in the background and can be retried where it stopped.
 * Seven days after a commit only its summary is kept, and the outcome says so.
 */
export default function TransactionImportReview({
  importId,
  accounts,
  onFinished,
  onCancelled,
}: TransactionImportReviewProps) {
  const t = useTranslations();
  const formatDate = useFormatShortDate();
  const notifyIfRateLimited = useRateLimitToast();
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const query = useTransactionImport(importId, {
    page,
    pageSize: PAGE_SIZE,
    ...(filter === "all" ? {} : { status: filter }),
  });
  const decide = useDecideTransactionImportRows();
  const mapAccounts = useMapTransactionImportAccounts();
  const parse = useParseTransactionImport();
  const commit = useCommitTransactionImport();
  const cancel = useCancelTransactionImport();
  const session = query.data?.session;
  const rows = query.data?.rows;

  const finishedRef = useRef(false);
  useEffect(() => {
    if (!session || finishedRef.current) return;
    if (!FINISHED_IMPORT_STATUSES.has(session.status)) return;
    if (session.status === "cancelled") return;
    finishedRef.current = true;
    onFinished(session);
  }, [onFinished, session]);

  if (!session || !rows) {
    return (
      <p className="text-muted-foreground text-sm" aria-live="polite">
        {t("import-review-reading")}
      </p>
    );
  }

  const busy =
    decide.isPending ||
    mapAccounts.isPending ||
    parse.isPending ||
    commit.isPending ||
    cancel.isPending;
  const onError = (error: unknown) => {
    notifyIfRateLimited(error);
  };
  const run = (mutation: Promise<unknown>) => mutation.catch(onError);

  if (session.status === "parsing" || session.status === "importing") {
    return (
      <Working
        session={session}
        disabled={busy}
        onRetry={() =>
          void run(commit.mutateAsync({ id: importId, input: undefined }))
        }
      />
    );
  }

  if (FINISHED_IMPORT_STATUSES.has(session.status)) {
    return <Outcome status={session.status} session={session} />;
  }

  const pages = Math.max(1, Math.ceil(rows.total / rows.pageSize));
  const reviewable =
    session.status === "ready" || session.status === "needs_mapping";

  return (
    <section
      className="flex flex-col gap-4 text-sm"
      data-testid="transaction-import-review"
      aria-live="polite"
    >
      <p className="text-muted-foreground">{t("import-review-summary")}</p>

      {session.status === "needs_mapping" ? (
        <AccountMapping
          accounts={accounts}
          disabled={busy}
          session={session}
          onSave={(mapping) =>
            void run(mapAccounts.mutateAsync({ id: importId, input: mapping }))
          }
        />
      ) : null}

      {dateOrderAmbiguous(session) ? (
        <DateOrder
          disabled={busy}
          session={session}
          onChoose={(dateOrder) =>
            void run(parse.mutateAsync({ id: importId, input: { dateOrder } }))
          }
        />
      ) : null}

      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label={t("import-review-filter")}
      >
        {(["all", ...FILTERS] as Filter[])
          .filter(
            (option) =>
              option === "all" ||
              option === filter ||
              session.counts[option] > 0,
          )
          .map((option) => (
            <Button
              key={option}
              type="button"
              size="xs"
              variant={filter === option ? "secondary" : "ghost"}
              aria-pressed={filter === option}
              onClick={() => {
                setFilter(option);
                setPage(1);
              }}
            >
              {t(`import-review-filter-${option}`, {
                count:
                  option === "all"
                    ? Object.values(session.counts).reduce((a, b) => a + b, 0)
                    : session.counts[option],
              })}
            </Button>
          ))}
      </div>

      {filter !== "all" && DECIDABLE.has(filter) ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || !reviewable}
            onClick={() =>
              void run(
                decide.mutateAsync({
                  id: importId,
                  input: { decision: "import", status: filter },
                }),
              )
            }
          >
            {t("import-review-include-all")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy || !reviewable}
            onClick={() =>
              void run(
                decide.mutateAsync({
                  id: importId,
                  input: { decision: "skip", status: filter },
                }),
              )
            }
          >
            {t("import-review-skip-all")}
          </Button>
        </div>
      ) : null}

      {rows.items.length === 0 ? (
        <p className="text-muted-foreground">{t("import-review-empty")}</p>
      ) : (
        <ul className="divide-border flex flex-col divide-y">
          {rows.items.map((row) => (
            <ReviewRow
              key={row.id}
              row={row}
              disabled={busy || !reviewable}
              formatDate={(iso) =>
                formatDate(calendarDay(iso), { alwaysShowYear: true })
              }
              onDecide={(decision) =>
                void run(
                  decide.mutateAsync({
                    id: importId,
                    input: { decision, rowIds: [row.id] },
                  }),
                )
              }
            />
          ))}
        </ul>
      )}

      {pages > 1 ? (
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
          >
            {t("previous")}
          </Button>
          <span className="text-muted-foreground tabular-nums">
            {t("import-review-page", { page, pages })}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={page >= pages}
            onClick={() => setPage((current) => current + 1)}
          >
            {t("next")}
          </Button>
        </div>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void run(
              cancel
                .mutateAsync({ id: importId, input: undefined })
                .then(onCancelled),
            )
          }
        >
          {t("import-review-cancel")}
        </Button>
        <Button
          type="button"
          size="lg"
          loading={commit.isPending}
          disabled={busy || !session.canCommit}
          onClick={() =>
            void run(commit.mutateAsync({ id: importId, input: undefined }))
          }
        >
          {t("import-review-commit", { count: session.decisions.import })}
        </Button>
      </div>
    </section>
  );
}

function ReviewRow({
  row,
  disabled,
  formatDate,
  onDecide,
}: {
  row: TransactionImportRow;
  disabled: boolean;
  formatDate: (iso: string) => string;
  onDecide: (decision: "import" | "skip") => void;
}) {
  const t = useTranslations();
  const decidable = DECIDABLE.has(row.status);
  return (
    <li className="flex items-start gap-3 py-2">
      <div className="flex h-5 w-5 shrink-0 items-center justify-center">
        {decidable ? (
          <Checkbox
            aria-label={t("import-review-include-row", { row: row.sourceRow })}
            checked={row.decision === "import"}
            disabled={disabled}
            onCheckedChange={(checked) =>
              onDecide(checked === true ? "import" : "skip")
            }
          />
        ) : null}
      </div>
      <div className="flex min-w-0 grow flex-col gap-0.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate">
            {row.normalized?.merchant ??
              row.normalized?.description ??
              t("import-review-row", { row: row.sourceRow })}
          </span>
          {row.normalized ? (
            <Amount
              value={row.normalized.amount}
              currency={row.normalized.currency}
              tone="delta"
            />
          ) : null}
        </div>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {row.normalized ? (
            <span className="tabular-nums">
              {formatDate(row.normalized.date)}
            </span>
          ) : (
            <span>{t("import-review-row", { row: row.sourceRow })}</span>
          )}
          <Badge variant={row.status === "new" ? "outline" : "muted"}>
            {t(`import-review-status-${row.status}`)}
          </Badge>
          {row.error ? <span>{row.error}</span> : null}
        </div>
      </div>
    </li>
  );
}

function Working({
  session,
  disabled,
  onRetry,
}: {
  session: TransactionImportSession;
  disabled: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations();
  if (session.canRetry && session.status === "importing") {
    return (
      <div
        className="bg-muted flex flex-col gap-3 rounded-md p-4 text-sm"
        role="status"
      >
        <p>{t("import-review-stalled")}</p>
        <Button type="button" size="sm" disabled={disabled} onClick={onRetry}>
          {t("retry")}
        </Button>
      </div>
    );
  }
  const imported = session.counts.imported;
  return (
    <p
      className="text-muted-foreground bg-muted rounded-md p-4 text-sm"
      role="status"
      aria-live="polite"
    >
      {session.status === "parsing"
        ? t("import-review-reading")
        : t("import-review-importing", {
            imported,
            total: imported + session.decisions.import,
          })}
    </p>
  );
}

function Outcome({
  status,
  session,
}: {
  status: ImportSessionStatus;
  session: TransactionImportSession;
}) {
  const t = useTranslations();
  if (status === "expired" || status === "cancelled") {
    return (
      <p className="bg-muted rounded-md p-4 text-sm" role="status">
        {t("import-review-expired")}
      </p>
    );
  }
  // A file that could not be read ends the session with a code; a commit whose rows failed does not.
  if (status === "failed" && session.errorCode) {
    return (
      <p className="text-destructive-text text-sm" role="alert">
        {t("import-review-read-failed")}
      </p>
    );
  }
  return (
    <div
      className="bg-muted flex flex-col gap-1 rounded-md p-4 text-sm"
      role="status"
    >
      <p>
        {t("import-review-done", {
          imported: session.counts.imported,
          skipped: session.counts.skipped,
        })}
      </p>
      {session.counts.failed > 0 ? (
        <p className="text-muted-foreground">
          {t("import-review-done-failed", { failed: session.counts.failed })}
        </p>
      ) : null}
      {session.detailsDeletedAt ? (
        <p className="text-muted-foreground">
          {t("import-review-details-deleted")}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A QIF file whose dates could be day first or month first: the reader read them day-first and
 * asks. Choosing reads the file again, so the rows below are the ones that will import.
 */
function DateOrder({
  disabled,
  session,
  onChoose,
}: {
  disabled: boolean;
  session: TransactionImportSession;
  onChoose: (dateOrder: "day-first" | "month-first") => void;
}) {
  const t = useTranslations();
  const assumed = session.warnings.find(
    (warning) => warning.code === "date_order_ambiguous",
  )?.detail;
  return (
    <fieldset className="bg-muted flex flex-col gap-3 rounded-md p-4">
      <legend className="sr-only">{t("import-review-date-order-title")}</legend>
      <p className="font-medium">{t("import-review-date-order-title")}</p>
      <p className="text-muted-foreground">
        {assumed === "month-first"
          ? t("import-review-date-order-hint-month-first")
          : t("import-review-date-order-hint-day-first")}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => onChoose("day-first")}
        >
          {t("import-statement-date-dmy")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => onChoose("month-first")}
        >
          {t("import-statement-date-mdy")}
        </Button>
      </div>
    </fieldset>
  );
}

function AccountMapping({
  accounts,
  disabled,
  session,
  onSave,
}: {
  accounts: Account[];
  disabled: boolean;
  session: TransactionImportSession;
  onSave: (mapping: Record<string, number>) => void;
}) {
  const t = useTranslations();
  const [mapping, setMapping] = useState<Record<string, number>>(
    session.accountMapping,
  );
  const complete = session.sourceAccounts.every(
    (source) => mapping[source.label] !== undefined,
  );
  return (
    <fieldset className="bg-muted flex flex-col gap-3 rounded-md p-4">
      <legend className="sr-only">{t("import-review-mapping-title")}</legend>
      <p className="font-medium">{t("import-review-mapping-title")}</p>
      {session.sourceAccounts.map((source) => (
        <label key={source.label} className="flex flex-col gap-1">
          <span>
            {t("import-review-mapping-source", {
              label: source.label,
              count: source.rowCount,
            })}
          </span>
          <Select
            value={
              mapping[source.label] === undefined
                ? undefined
                : String(mapping[source.label])
            }
            onValueChange={(value) =>
              setMapping((current) => ({
                ...current,
                [source.label]: Number(value),
              }))
            }
            disabled={disabled}
          >
            <SelectTrigger aria-label={source.label}>
              <SelectValue placeholder={t("account")} />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((account) => (
                <SelectItem
                  key={account.accountKey}
                  value={String(account.accountKey)}
                >
                  {account.accountName ?? t("unknown")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      ))}
      <Button
        type="button"
        size="sm"
        className="self-start"
        disabled={disabled || !complete}
        onClick={() => onSave(mapping)}
      >
        {t("import-review-mapping-save")}
      </Button>
    </fieldset>
  );
}
