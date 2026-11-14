"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { Amount } from "@/components/ui/Amount";
import { Badge } from "@/components/ui/badge";
import { Section } from "@/components/ui/RuledSection";
import { Spinner } from "@/components/ui/Spinner";
import useCreditCardStatements, {
  type CreditCardStatement,
  type CreditCardStatementDetail,
  type CreditCardStatementStatus,
  useCreditCardStatementDetail,
} from "@/lib/api/account/useCreditCardStatements";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

function formatStatementDate(value: string, locale: string): string {
  // The API sends a calendar day; noon UTC keeps it on the same day in every timezone.
  const date = new Date(`${value}T12:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

const STATUS_VARIANT: Record<
  CreditCardStatementStatus,
  "destructive" | "info" | "muted" | "success"
> = {
  closed: "info",
  open: "muted",
  overdue: "destructive",
  paid: "success",
};

/** Preserve a selected statement when present, otherwise land on current/latest. */
export function selectCreditCardStatement(
  statements: readonly CreditCardStatement[],
  selectedEnd: string | null,
): CreditCardStatement | null {
  const remembered = selectedEnd
    ? statements.find((statement) => statement.periodEnd === selectedEnd)
    : undefined;
  return (
    remembered ??
    statements.find((statement) => statement.isCurrent) ??
    statements.at(-1) ??
    null
  );
}

function StatementStatusBadge({
  status,
}: {
  status: CreditCardStatementStatus;
}) {
  const t = useTranslations();
  return (
    <Badge variant={STATUS_VARIANT[status]}>
      {t(`credit-card-statement-status-${status}`)}
    </Badge>
  );
}

/**
 * A card's statements, newest first, with the selected statement's transactions beneath. The
 * statement that contains today is selected first, so opening the tab lands on what is owed now.
 */
export default function CreditCardStatements({
  accountKey,
  currency,
}: {
  accountKey: number;
  currency: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const { data, isLoading } = useCreditCardStatements({ accountKey });

  const statements = useMemo(() => data?.statements ?? [], [data?.statements]);
  const [selectedEnd, setSelectedEnd] = useState<string | null>(null);
  const selected = useMemo(
    () => selectCreditCardStatement(statements, selectedEnd),
    [selectedEnd, statements],
  );

  const detail = useCreditCardStatementDetail({
    accountKey,
    statementDate: selected?.periodEnd ?? null,
  });

  return (
    <Section
      id="credit-card-statements-heading"
      title={t("credit-card-statements")}
    >
      {isLoading && statements.length === 0 ? (
        <div className="flex h-24 items-center justify-center">
          <Spinner />
        </div>
      ) : statements.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t("credit-card-no-statement")}
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="border-border divide-border divide-y rounded-lg border">
            {[...statements].reverse().map((statement) => {
              const active = statement.periodEnd === selected?.periodEnd;
              return (
                <button
                  key={statement.periodEnd}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelectedEnd(statement.periodEnd)}
                  className={`flex min-h-14 w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left transition-colors ${
                    active ? "bg-muted" : "hover:bg-muted/50"
                  }`}
                >
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="text-foreground font-mono text-sm tabular-nums">
                      {t("credit-card-statement-period", {
                        start: formatStatementDate(
                          statement.periodStart,
                          locale,
                        ),
                        end: formatStatementDate(statement.periodEnd, locale),
                      })}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {t("credit-card-due-date-of", {
                        date: formatStatementDate(statement.dueDate, locale),
                      })}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <Amount value={statement.balance} currency={currency} />
                    <StatementStatusBadge status={statement.status} />
                  </span>
                </button>
              );
            })}
          </div>

          {selected ? (
            <div className="flex flex-col gap-3">
              <h3 className="text-foreground text-sm font-semibold">
                {t("credit-card-statement-transactions")}
              </h3>
              {detail.isLoading ? (
                <div className="flex h-24 items-center justify-center">
                  <Spinner />
                </div>
              ) : detail.isError || !detail.data ? (
                <p className="text-muted-foreground text-sm">
                  {t("credit-card-statement-transactions-error")}
                </p>
              ) : detail.data.statement.transactions.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {t("credit-card-statement-transactions-empty")}
                </p>
              ) : (
                <StatementTransactions
                  currency={currency}
                  locale={locale}
                  statement={detail.data.statement}
                />
              )}
            </div>
          ) : null}
        </div>
      )}
    </Section>
  );
}

function StatementTransactions({
  currency,
  locale,
  statement,
}: {
  currency: string;
  locale: string;
  statement: CreditCardStatementDetail;
}) {
  const t = useTranslations();
  const formatCurrency = useFormatCurrency();

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-muted-foreground text-left text-xs">
          <th className="py-2 font-normal">{t("date")}</th>
          <th className="py-2 font-normal">{t("description")}</th>
          <th className="py-2 text-right font-normal">{t("amount")}</th>
        </tr>
      </thead>
      <tbody className="divide-border divide-y">
        {statement.transactions.map((row) => (
          <tr key={row.transactionKey}>
            <td className="text-muted-foreground py-2 font-mono text-xs tabular-nums">
              {row.transactionDate
                ? formatStatementDate(row.transactionDate, locale)
                : "—"}
            </td>
            <td className="text-foreground py-2">
              {row.merchantName ?? row.description ?? "—"}
            </td>
            <td className="text-foreground py-2 text-right font-mono tabular-nums">
              {row.amount === null ? "—" : formatCurrency(row.amount, currency)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
