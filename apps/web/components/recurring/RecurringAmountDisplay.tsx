import type { ReactNode } from "react";

import type {
  RecurringAmountType,
  RecurringItem,
} from "@/lib/api/recurring/useRecurringItems";
import { cn } from "@/lib/utils";
import { formatCurrencyForScreenReader } from "@/lib/utils/formatCurrency";

type RecurringAmountSource = Pick<
  RecurringItem,
  | "amountType"
  | "expectedAmount"
  | "expectedAmountMin"
  | "expectedAmountMax"
  | "averageAmount"
  | "lastAmount"
>;

export interface RecurringAmountDisplayProps {
  item?: Partial<RecurringAmountSource>;
  amountType?: RecurringAmountType;
  expectedAmount?: number | null;
  expectedAmountMin?: number | null;
  expectedAmountMax?: number | null;
  averageAmount?: number | null;
  lastAmount?: number | null;
  currencyCode?: string;
  locale?: string;
  fallback?: ReactNode;
  className?: string;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isCurrencyCode = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Z]{3}$/.test(value);

const formatMoney = (value: number, currencyCode?: string, locale?: string) => {
  if (!isCurrencyCode(currencyCode)) {
    return new Intl.NumberFormat(locale, {
      notation: "standard",
      maximumFractionDigits: 2,
    }).format(value);
  }

  return new Intl.NumberFormat(locale, {
    style: "currency",
    notation: "standard",
    maximumFractionDigits: 2,
    currency: currencyCode,
  }).format(value);
};

function getSourceValue(
  source: Partial<RecurringAmountSource> | undefined,
  key: keyof RecurringAmountSource,
) {
  const value = source?.[key];
  return isFiniteNumber(value) ? value : null;
}

function getDisplayNode(
  source: Partial<RecurringAmountSource>,
  currencyCode?: string,
  locale?: string,
): ReactNode | null {
  const exact = getSourceValue(source, "expectedAmount");
  const min = getSourceValue(source, "expectedAmountMin");
  const max = getSourceValue(source, "expectedAmountMax");
  const average = getSourceValue(source, "averageAmount");
  const last = getSourceValue(source, "lastAmount");
  const amountType =
    source.amountType ??
    (min !== null || max !== null
      ? "variable"
      : exact !== null
        ? "fixed"
        : null);

  if (amountType === "fixed") {
    const value = exact ?? average ?? last;
    return value === null ? null : formatMoney(value, currencyCode, locale);
  }

  const rangeValues = [min, max].filter(isFiniteNumber);
  if (rangeValues.length === 2) {
    const low = Math.min(rangeValues[0], rangeValues[1]);
    const high = Math.max(rangeValues[0], rangeValues[1]);
    if (low === high) return formatMoney(low, currencyCode, locale);

    return (
      <span className="inline-flex items-center gap-1">
        <span>{formatMoney(low, currencyCode, locale)}</span>
        <span className="text-muted-foreground">–</span>
        <span>{formatMoney(high, currencyCode, locale)}</span>
      </span>
    );
  }

  const fallbackValue = average ?? last;
  return fallbackValue === null
    ? null
    : formatMoney(fallbackValue, currencyCode, locale);
}

function getAccessibleLabel(
  source: Partial<RecurringAmountSource>,
  currencyCode?: string,
  locale?: string,
) {
  const exact = getSourceValue(source, "expectedAmount");
  const min = getSourceValue(source, "expectedAmountMin");
  const max = getSourceValue(source, "expectedAmountMax");
  const average = getSourceValue(source, "averageAmount");
  const last = getSourceValue(source, "lastAmount");
  const amountType =
    source.amountType ??
    (min !== null || max !== null
      ? "variable"
      : exact !== null
        ? "fixed"
        : null);
  const accessibleMoney = (value: number) =>
    formatCurrencyForScreenReader(
      value,
      isCurrencyCode(currencyCode) ? currencyCode : "EUR",
      locale ?? "en",
    );

  if (amountType === "fixed") {
    const value = exact ?? average ?? last;
    return value === null ? null : accessibleMoney(value);
  }

  const rangeValues = [min, max].filter(isFiniteNumber);
  if (rangeValues.length === 2) {
    const low = Math.min(rangeValues[0], rangeValues[1]);
    const high = Math.max(rangeValues[0], rangeValues[1]);
    return low === high
      ? accessibleMoney(low)
      : `${accessibleMoney(low)} – ${accessibleMoney(high)}`;
  }

  const fallbackValue = average ?? last;
  return fallbackValue === null ? null : accessibleMoney(fallbackValue);
}

export function RecurringAmountDisplay({
  item,
  amountType,
  expectedAmount,
  expectedAmountMin,
  expectedAmountMax,
  averageAmount,
  lastAmount,
  currencyCode,
  locale,
  fallback,
  className,
}: RecurringAmountDisplayProps) {
  const source = {
      amountType: item?.amountType ?? amountType,
      expectedAmount: item?.expectedAmount ?? expectedAmount,
      expectedAmountMin: item?.expectedAmountMin ?? expectedAmountMin,
      expectedAmountMax: item?.expectedAmountMax ?? expectedAmountMax,
      averageAmount: item?.averageAmount ?? averageAmount,
      lastAmount: item?.lastAmount ?? lastAmount,
    };
  const displayNode = getDisplayNode(source, currencyCode, locale);
  const accessibleLabel = getAccessibleLabel(source, currencyCode, locale);

  if (displayNode === null) {
    return (
      <span className={cn("text-muted-foreground", className)}>
        {fallback ?? "—"}
      </span>
    );
  }

  return (
    <span className={cn("font-mono tabular-nums", className)}>
      {accessibleLabel ? (
        <span className="sr-only">{accessibleLabel}</span>
      ) : null}
      <span aria-hidden="true">{displayNode}</span>
    </span>
  );
}
