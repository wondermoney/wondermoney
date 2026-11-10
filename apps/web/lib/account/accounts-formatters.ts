import { format, isToday, isYesterday } from "date-fns";

import { transactionDisplayDate } from "@/lib/utils/transaction-date";

/** A transaction date for the accounts list; a date-only bank booking shows on its own date. */
export function formatTxDate(dateStr: string): string {
  const date = transactionDisplayDate(dateStr);
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "d MMM");
}
