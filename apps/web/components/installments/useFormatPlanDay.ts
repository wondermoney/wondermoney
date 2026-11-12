"use client";

import { useCallback } from "react";

import { transactionDisplayDate } from "@/lib/utils/transaction-date";
import { useFormatShortDate } from "@/lib/utils/useFormatShortDate";

/**
 * A plan's `YYYY-MM-DD` calendar day as a short local date ("Mar 6"), on that same day for every
 * viewer: the API's days are UTC calendar days, read like a date-only bank booking.
 */
export function useFormatPlanDay() {
  const formatShortDate = useFormatShortDate();
  return useCallback(
    (day: string | null | undefined, options?: { alwaysShowYear?: boolean }) =>
      day
        ? formatShortDate(
            transactionDisplayDate(`${day}T00:00:00.000Z`),
            options,
          )
        : "—",
    [formatShortDate],
  );
}
