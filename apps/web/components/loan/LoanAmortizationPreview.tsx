"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";

import { Amount } from "@/components/ui/Amount";
import type { ChartConfig } from "@/components/ui/chart";
import { BarChartBase, useChartFormatters } from "@/components/ui/charts";
import { Section } from "@/components/ui/RuledSection";
import {
  SimpleTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import { API_ERROR_CODE, getApiErrorCode } from "@/lib/api/errors";
import type { LoanDetail, LoanScheduleRow } from "@/lib/api/loan/types";
import useLoanSchedule from "@/lib/api/loan/useLoanSchedule";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";
import { useFormatShortDate } from "@/lib/utils/useFormatShortDate";

/** A payment date is a calendar day; read it as one, not as UTC midnight. */
const calendarDay = (iso: string) => {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day);
};

export default function LoanAmortizationPreview({ loan }: { loan: LoanDetail }) {
  const t = useTranslations("loans");
  const locale = useLocale();
  const formatCurrency = useFormatCurrency();
  const formatShortDate = useFormatShortDate();
  const { formatCompactCurrency } = useChartFormatters();
  const { data, error, isError, isLoading } = useLoanSchedule(loan.loanKey);
  const schedule = data?.schedule;

  // The schedule spans years, so the axis names the year as well as the month.
  // `calendarDay` keeps the date from shifting in negative-offset time zones.
  const chartDateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, { month: "short", year: "numeric" }),
    [locale],
  );

  const chartConfig: ChartConfig = {
    interest: {
      color: "var(--chart-2)",
      label: t("detail.amortization.interest"),
    },
    principal: {
      color: "var(--chart-1)",
      label: t("detail.amortization.principal"),
    },
  };

  const chartData =
    schedule?.rows.map((row) => ({
      date: row.date,
      interest: row.interest,
      principal: row.principal,
    })) ?? [];

  const money = (value: number) => (
    <Amount value={value} currency={loan.currency.code} className="font-mono" />
  );

  const status = (row: LoanScheduleRow) =>
    row.paid ? (
      <span className="text-success-text font-medium">
        {t("detail.amortization.paid")}
      </span>
    ) : (
      <span className="text-muted-foreground">
        {t("detail.amortization.scheduled")}
      </span>
    );

  return (
    <Section
      id="loan-amortization-heading"
      title={t("detail.amortization.title")}
      busy={isLoading}
    >
      {isLoading ? (
        <p className="text-muted-foreground text-sm">
          {t("detail.loading")}
        </p>
      ) : isError ? (
        <p className="text-muted-foreground text-sm">
          {getApiErrorCode(error) === API_ERROR_CODE.LOAN_SCHEDULE_UNAVAILABLE
            ? t("detail.amortization.missingInputs")
            : t("detail.amortization.unavailable")}
        </p>
      ) : !schedule || schedule.rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {t("detail.amortization.empty")}
        </p>
      ) : (
        <>
          <p className="text-muted-foreground mb-6 max-w-prose text-sm">
            {t("detail.amortization.subtitle")}
          </p>

          <dl className="mb-8 flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <div className="flex items-baseline gap-2">
              <dt className="text-muted-foreground">
                {t("detail.amortization.totalInterest")}
              </dt>
              <dd>{money(schedule.totalInterest)}</dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="text-muted-foreground">
                {t("detail.amortization.totalPaid")}
              </dt>
              <dd>{money(schedule.totalPaid)}</dd>
            </div>
          </dl>

          <BarChartBase
            data={chartData}
            xKey="date"
            keys={["principal", "interest"]}
            config={chartConfig}
            stacked
            barSize={Math.max(2, Math.min(12, Math.floor(720 / chartData.length)))}
            radius={0}
            className="mb-8 h-[240px]"
            xFormatter={(value) =>
              chartDateFormatter.format(calendarDay(String(value)))
            }
            yFormatter={(value) =>
              formatCompactCurrency(value, loan.currency.code)
            }
            tooltipValueFormatter={(value) =>
              formatCurrency(Number(value), loan.currency.code)
            }
          />

          {/* Phone: each row restacks; the figures never scroll off-screen. */}
          <ul className="md:hidden">
            {schedule.rows.map((row) => (
              <li
                key={row.number}
                className="border-border flex items-start justify-between gap-3 border-b py-3"
              >
                <div className="min-w-0">
                  <p className="text-foreground text-sm font-medium">
                    {formatShortDate(calendarDay(row.date))}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {t("detail.amortization.rowLabel", { number: row.number })}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {t.rich("detail.amortization.split", {
                      interest: () => money(row.interest),
                      principal: () => money(row.principal),
                    })}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-sm">{money(row.payment)}</span>
                  <span className="text-muted-foreground text-xs">
                    {t("detail.amortization.balance")} {money(row.endingBalance)}
                  </span>
                  <span className="text-xs">{status(row)}</span>
                </div>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto md:block">
            <SimpleTable>
              <TableHeader className="bg-background [&_tr]:border-foreground [&_th]:text-xs">
                <TableRow>
                  <TableHead className="pl-0 lg:pl-0">
                    {t("detail.amortization.columns.number")}
                  </TableHead>
                  <TableHead>
                    {t("detail.amortization.columns.date")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("detail.amortization.columns.payment")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("detail.amortization.columns.principal")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("detail.amortization.columns.interest")}
                  </TableHead>
                  <TableHead className="text-right">
                    {t("detail.amortization.columns.balance")}
                  </TableHead>
                  <TableHead>
                    {t("detail.amortization.columns.status")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedule.rows.map((row) => (
                  <TableRow key={row.number}>
                    <TableCell className="text-muted-foreground pl-0 font-mono lg:pl-0">
                      {row.number}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatShortDate(calendarDay(row.date))}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {money(row.payment)}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {money(row.principal)}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {money(row.interest)}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {money(row.endingBalance)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {status(row)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </SimpleTable>
          </div>
        </>
      )}
    </Section>
  );
}
