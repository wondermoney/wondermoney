"use client";

import type { ReactNode } from "react";

import type {
  RecurringAmountType,
  RecurringItem,
} from "@/lib/api/recurring/useRecurringItems";
import { cn } from "@/lib/utils";
import {
  useFormatCurrency,
  useFormatCurrencyForScreenReader,
} from "@/lib/utils/useFormatCurrency";

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
  /** Unused: the formatters read the route locale. Kept for callers. */
  locale?: string;
  fallback?: ReactNode;
  className?: string;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isCurrencyCode = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Z]{3}$/.test(value);

type FormatMoney = ReturnType<typeof useFormatCurrency>;
type FormatSpoken = ReturnType<typeof useFormatCurrencyForScreenReader>;

function getSourceValue(
  source: Partial<RecurringAmountSource> | undefined,
  key: keyof RecurringAmountSource,
) {
  const value = source?.[key];
  return isFiniteNumber(value) ? value : null;
}

function getDisplayNode(
  source: Partial<RecurringAmountSource>,
  format: FormatMoney,
  currencyCode?: string,
): ReactNode | null {
  // A non-ISO code formats as a plain number, as it always has here.
  const formatMoney = (value: number) => format(value, currencyCode ?? "");
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
    return value === null ? null : formatMoney(value);
  }

  const rangeValues = [min, max].filter(isFiniteNumber);
  if (rangeValues.length === 2) {
    const low = Math.min(rangeValues[0], rangeValues[1]);
    const high = Math.max(rangeValues[0], rangeValues[1]);
    if (low === high) return formatMoney(low);

    return (
      <span className="inline-flex items-center gap-1">
        <span>{formatMoney(low)}</span>
        <span className="text-muted-foreground">–</span>
        <span>{formatMoney(high)}</span>
      </span>
    );
  }

  const fallbackValue = average ?? last;
  return fallbackValue === null
    ? null
    : formatMoney(fallbackValue);
}

function getAccessibleLabel(
  source: Partial<RecurringAmountSource>,
  formatSpoken: FormatSpoken,
  currencyCode?: string,
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
    formatSpoken(value, isCurrencyCode(currencyCode) ? currencyCode : "EUR");

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
  fallback,
  className,
}: RecurringAmountDisplayProps) {
  // Both read the route locale and privacy mode themselves.
  const formatMoney = useFormatCurrency();
  const formatSpoken = useFormatCurrencyForScreenReader();
  const source = {
      amountType: item?.amountType ?? amountType,
      expectedAmount: item?.expectedAmount ?? expectedAmount,
      expectedAmountMin: item?.expectedAmountMin ?? expectedAmountMin,
      expectedAmountMax: item?.expectedAmountMax ?? expectedAmountMax,
      averageAmount: item?.averageAmount ?? averageAmount,
      lastAmount: item?.lastAmount ?? lastAmount,
    };
  const displayNode = getDisplayNode(source, formatMoney, currencyCode);
  const accessibleLabel = getAccessibleLabel(source, formatSpoken, currencyCode);

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
