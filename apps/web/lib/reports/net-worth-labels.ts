/**
 * Axis labels for the net-worth report. The API labels its points as
 * floating calendar dates (midnight UTC), so they are read in UTC.
 *
 * Points arrive more often than once a month, and every one used to be
 * labelled with its month alone, so the axis read "Aug 26, Aug 26, Aug 26".
 * When any two points share a month, every point is labelled by its day.
 */
export function netWorthAxisLabels(
  isoDates: string[],
  locale: string,
): string[] {
  const month = new Intl.DateTimeFormat(locale, {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
  const byMonth = isoDates.map((iso) => month.format(new Date(iso)));
  if (new Set(byMonth).size === byMonth.length) return byMonth;

  const day = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  return isoDates.map((iso) => day.format(new Date(iso)));
}

/**
 * One point per calendar month, the month's last. The report endpoint returns
 * every snapshot in a month stamped with the month's first day, so the
 * "month by month" chart drew a staircase of identical labels, and the trend
 * compared two snapshots of the same month.
 */
export function monthlyNetWorthPoints<T extends { date: string }>(
  points: T[],
): T[] {
  const byMonth = new Map<string, T>();
  for (const point of points) byMonth.set(point.date.slice(0, 7), point);
  return [...byMonth.values()];
}
