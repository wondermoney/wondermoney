"use client";

import { useLocale } from "next-intl";

import { transactionDisplayDate } from "@/lib/utils/transaction-date";
/**
 * The ledger's date cell: the day large in the figure face, the weekday
 * under it, and the month named on the first row of each month so the list
 * reads in monthly blocks without breaking the table into groups. Only the
 * first row of a day carries the date; the rest of that day's rows leave it
 * blank, so a day reads as one group. A date-only bank booking shows on its
 * own date.
 */
export function LedgerDateCell({
  date,
  isMonthStart,
  isDayStart,
}: {
  date: string;
  isMonthStart: boolean;
  isDayStart: boolean;
}) {
  const locale = useLocale();
  const value = transactionDisplayDate(date);
  if (Number.isNaN(value.getTime())) {
    return <span className="text-muted-foreground">—</span>;
  }
  const isCurrentYear = value.getFullYear() === new Date().getFullYear();
  const month = new Intl.DateTimeFormat(locale, {
    month: "short",
    ...(isCurrentYear ? {} : { year: "numeric" }),
  }).format(value);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short" }).format(
    value,
  );

  if (!isDayStart && !isMonthStart) {
    return <span className="block w-12" />;
  }

  return (
    <span className="flex w-12 flex-col leading-tight">
      {isMonthStart ? (
        <span className="text-foreground mb-1 text-xs font-semibold whitespace-nowrap">
          {month}
        </span>
      ) : null}
      <span className="text-foreground font-mono text-base">
        {value.getDate()}
      </span>
      <span className="text-muted-foreground text-xs">{weekday}</span>
    </span>
  );
}

/** The month and year a run of rows belongs to, for the phone list's breaks. */
export function LedgerMonthLabel({ date }: { date: string }) {
  const locale = useLocale();
  const value = transactionDisplayDate(date);
  if (Number.isNaN(value.getTime())) return null;
  return (
    <>
      {new Intl.DateTimeFormat(locale, {
        month: "long",
        year: "numeric",
      }).format(value)}
    </>
  );
}
