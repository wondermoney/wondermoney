"use client";

import { useLocale } from "next-intl";

import { Text } from "@/components/ui/Typography";
import { cn } from "@/lib/utils";
import { useFormatShortDate } from "@/lib/utils/useFormatShortDate";

interface TableCellDefaultProps {
  value: Date | string | number;
  options?: Intl.DateTimeFormatOptions;
  className?: string;
  /** Force the year even for the current year. For archival or multi-year views. */
  alwaysShowYear?: boolean;
}

/**
 * A date in a column the eye is scanning.
 *
 * DESIGN.md § 9 rule 9: timestamps are short and human — `Mar 7`, not a
 * zero-padded numeric date. This rendered `02 Aug 2026` in three tokens, of
 * which two are noise on a table where every row is the same month and year.
 *
 * The year is dropped for dates in the current year and kept otherwise, so an
 * old row never becomes ambiguous. Day is `numeric`, not `2-digit`: leading
 * zeros buy nothing once the column is `tabular-nums`.
 *
 * Ordering is left to the locale — `2 ago` in pt, `Aug 2` in en-US, `2 Aug` in
 * en-GB — which is why this builds options rather than a template string.
 */
const TableCellDate: React.FC<TableCellDefaultProps> = ({
  value,
  options,
  className,
  alwaysShowYear = false,
}) => {
  // RAD-575: the locale comes from the URL segment, not the runtime. This
  // called `toLocaleDateString(undefined, …)`, which resolves to the browser's
  // locale on the client and the container's during SSR.
  const formatShortDate = useFormatShortDate();
  const locale = useLocale();
  const date = value instanceof Date ? value : new Date(value);
  const isMissing = Number.isNaN(date.getTime());

  // An explicit `options` override opts out of the short-date shape entirely —
  // some columns genuinely need a full date — but never out of the locale.
  const text = isMissing
    ? "—"
    : options
      ? new Intl.DateTimeFormat(locale, options).format(date)
      : formatShortDate(date, { alwaysShowYear });

  return (
    <Text
      variant="smallText"
      className={cn(
        "whitespace-nowrap",
        isMissing && "text-muted-foreground",
        className,
      )}
    >
      {text}
    </Text>
  );
};

export default TableCellDate;
