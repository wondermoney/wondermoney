/**
 * Convert a `yyyy-mm-dd` string (the format the goals API expects for
 * targetDate) into a local Date, avoiding the UTC-midnight parsing of
 * `new Date("yyyy-mm-dd")` that can shift the day in negative-offset zones.
 */
export function parseGoalDateInput(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return undefined;
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

/** Format a Date back into the `yyyy-mm-dd` string the goals API expects. */
export function formatGoalDateInput(date: Date | null | undefined): string {
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** 3-level goal priority scale: 0 = low (default), 1 = medium, 2 = high. */
export type GoalPriority = 0 | 1 | 2;

export const GOAL_PRIORITY_OPTIONS: ReadonlyArray<{
  labelKey: string;
  value: GoalPriority;
}> = [
  { labelKey: "goals.priority-low", value: 0 },
  { labelKey: "goals.priority-medium", value: 1 },
  { labelKey: "goals.priority-high", value: 2 },
];

export function parseGoalMoney(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return Number.NaN;

  const normalized = trimmed.replace(/\s+/g, "");
  const hasDot = normalized.includes(".");
  const hasComma = normalized.includes(",");

  if (hasDot && hasComma) {
    const decimalSeparator =
      normalized.lastIndexOf(",") > normalized.lastIndexOf(".") ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    return Number(
      normalized
        .replaceAll(thousandsSeparator, "")
        .replace(decimalSeparator, "."),
    );
  }

  const separator = hasComma ? "," : hasDot ? "." : null;
  if (!separator) return Number(normalized);

  const parts = normalized.split(separator);
  if (parts.length !== 2) return Number.NaN;

  const fraction = parts[1];
  if (fraction === undefined) return Number.NaN;
  if (fraction.length === 3)
    return Number(normalized.replaceAll(separator, ""));
  if (fraction.length < 1 || fraction.length > 2) return Number.NaN;

  return Number(`${parts[0]?.replaceAll(/[.,]/g, "")}.${fraction}`);
}
