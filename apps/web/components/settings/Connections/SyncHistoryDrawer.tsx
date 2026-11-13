"use client";

import {
  BANK_SYNC_ERROR_ACTION_KEYS,
  bankSyncErrorCopy,
} from "@wondermoney/shared/bank-sync";
import { useLocale, useTranslations } from "next-intl";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { InspectorDrawer } from "@/components/ui/InspectorDrawer";
import { Spinner } from "@/components/ui/Spinner";
import { Text } from "@/components/ui/Typography";
import useBankSyncHistory, {
  type BankSyncHistoryProvider,
  type BankSyncHistoryRun,
} from "@/lib/api/banking/useBankSyncHistory";

const RESULT_VARIANT: Record<
  NonNullable<BankSyncHistoryRun["result"]>,
  BadgeProps["variant"]
> = {
  failed: "destructive",
  full_success: "success",
  partial: "warning",
};

function formatDateTime(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

/**
 * "Sync history" — the last 20 runs of one bank connection, from the connection
 * row in Settings.
 *
 * Each run says what happened in plain words: when it started and finished, which
 * flow it was, how many accounts and new transactions it covered, and, when it
 * failed, a translated reason and the one action that can help. The provider's own
 * message is never stored or shown.
 */
export default function SyncHistoryDrawer({
  open,
  onOpenChange,
  connectionId,
  institutionName,
  provider = "EnableBanking",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: number | null;
  institutionName: string | null;
  /** Which provider's id space `connectionId` belongs to. */
  provider?: BankSyncHistoryProvider;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const query = useBankSyncHistory(connectionId, { enabled: open, provider });
  const runs = query.data?.syncs ?? [];

  return (
    <InspectorDrawer
      open={open}
      onOpenChange={onOpenChange}
      objectType={t("bank-sync.history.title")}
      title={institutionName ?? t("bank-sync.history.title")}
      subtitle={t("bank-sync.history.description")}
    >
      {query.isLoading ? (
        <div className="py-8">
          <Spinner size="small">
            <span className="text-muted-foreground mt-2 text-sm">
              {t("bank-sync.history.loading")}
            </span>
          </Spinner>
        </div>
      ) : query.isError ? (
        <Text variant="mutedText" className="py-6 text-sm">
          {t("bank-sync.history.error")}
        </Text>
      ) : runs.length === 0 ? (
        <Text variant="mutedText" className="py-6 text-sm">
          {t("bank-sync.history.empty")}
        </Text>
      ) : (
        <ul className="divide-border divide-y">
          {runs.map((run) => (
            <SyncRun key={`${run.startedAt}-${run.finishedAt ?? "running"}`} run={run} locale={locale} />
          ))}
        </ul>
      )}
    </InspectorDrawer>
  );
}

function SyncRun({
  run,
  locale,
}: {
  run: BankSyncHistoryRun;
  locale: string;
}) {
  const t = useTranslations();
  const copy = bankSyncErrorCopy(run.errorCode);
  const result = run.result
    ? t(`bank-sync.history.result.${run.result}`)
    : t("bank-sync.history.inProgress");
  const flow = run.flow ? t(`bank-sync.history.flow.${run.flow}`) : null;

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm">
          {formatDateTime(run.startedAt, locale)}
        </span>
        <Badge variant={run.result ? RESULT_VARIANT[run.result] : "muted"}>
          {result}
        </Badge>
      </div>

      <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {flow ? <span>{flow}</span> : null}
        {run.finishedAt ? (
          <span>
            {t("bank-sync.history.finished")}{" "}
            {formatDateTime(run.finishedAt, locale)}
          </span>
        ) : null}
        {run.accounts !== null ? (
          <span>{t("bank-sync.history.accounts", { count: run.accounts })}</span>
        ) : null}
        {run.rowsCreated !== null ? (
          <span>{t("bank-sync.history.rows", { count: run.rowsCreated })}</span>
        ) : null}
      </div>

      {run.errorCode ? (
        <div className="space-y-1">
          <p className="text-sm">{t(copy.messageKey)}</p>
          <p className="text-muted-foreground text-xs">
            {t(BANK_SYNC_ERROR_ACTION_KEYS[copy.action])}
          </p>
          {run.retryAt ? (
            <p className="text-muted-foreground text-xs">
              {t("bank-sync.history.nextAttempt", {
                date: formatDateTime(run.retryAt, locale),
              })}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
