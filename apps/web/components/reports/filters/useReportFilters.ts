"use client";

import {
  endOfDay,
  endOfMonth,
  startOfDay,
  startOfMonth,
  subMonths,
} from "date-fns";
import { useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import { useRouter } from "@/i18n/navigation";
import { resolveViewerTimeZone } from "@/lib/reports/viewer-timezone";

/**
 * Filter envelope matching the `/v1/reports/*` API contract.
 *
 * State is persisted in URL search params so reports stay shareable,
 * deep-linkable, and survive reloads. This is the established pattern
 * in the product (accounts, portfolio, settings, financial markets).
 *
 * @see docs/UX_PLAYBOOK.md "Smart Defaults"
 * @see web/AGENTS.md "React Query owns server state, URL params own navigable filters"
 */
export interface ReportFilters {
  fromDate: string;
  toDate: string;
  accountKeys: string[];
  categoryKeys: string[];
  merchantKeys: string[];
  currencyKey?: string;
  includePending: boolean;
  includeTransfers: boolean;
  /**
   * The calendar the API groups report months in.
   *
   * Not a URL param: it describes the device reading the report, not the
   * report, so it must not travel in a shared link. Absent when the viewer's
   * zone is unknown (server render, or an `Intl` that cannot name one), in
   * which case the API applies its own default.
   */
  timezone?: string;
}

const PARAM_FROM = "from";
const PARAM_TO = "to";
const PARAM_ACCOUNTS = "accounts";
const PARAM_CATEGORIES = "categories";
const PARAM_MERCHANTS = "merchants";
const PARAM_CURRENCY = "currency";
const PARAM_PENDING = "pending";
const PARAM_TRANSFERS = "transfers";

function getDefaultDateRange(): { from: Date; to: Date } {
  return {
    from: startOfDay(subMonths(new Date(), 3)),
    to: endOfDay(new Date()),
  };
}

function parseDateParam(value: string | null): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function parseArrayParam(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseBoolParam(value: string | null): boolean {
  return value === "true";
}

function serializeArray(values: string[]): string | undefined {
  return values.length > 0 ? values.join(",") : undefined;
}

function serializeDate(date: Date): string {
  return date.toISOString();
}

/**
 * Assembles the request envelope from the navigable state plus the viewer's
 * calendar.
 *
 * Exported for tests: the timezone half is the part with a wrong answer
 * available (the server's zone, or a name the API would reject with a 400), so
 * it is worth being able to drive directly.
 *
 * @param searchParams - The URL state that owns the navigable filters
 * @param timezone - The viewer's IANA zone, or `undefined` when unknown
 */
export function buildReportFilters(
  searchParams: URLSearchParams,
  timezone: string | undefined,
): ReportFilters {
  const defaultRange = getDefaultDateRange();
  const from =
    parseDateParam(searchParams.get(PARAM_FROM)) ?? defaultRange.from;
  const to = parseDateParam(searchParams.get(PARAM_TO)) ?? defaultRange.to;

  return {
    fromDate: serializeDate(from),
    toDate: serializeDate(to),
    accountKeys: parseArrayParam(searchParams.get(PARAM_ACCOUNTS)),
    categoryKeys: parseArrayParam(searchParams.get(PARAM_CATEGORIES)),
    merchantKeys: parseArrayParam(searchParams.get(PARAM_MERCHANTS)),
    currencyKey: searchParams.get(PARAM_CURRENCY) ?? undefined,
    includePending: parseBoolParam(searchParams.get(PARAM_PENDING)),
    includeTransfers: parseBoolParam(searchParams.get(PARAM_TRANSFERS)),
    // Omit the key entirely rather than carrying `undefined`: the API rejects a
    // `timezone` it cannot resolve, so "no opinion" has to be indistinguishable
    // from "never asked" all the way to the wire.
    ...(timezone ? { timezone } : {}),
  };
}

export interface DateRangeValue {
  from: Date;
  to: Date;
}

export function useReportFilters() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Read once per mount. On the server this is `undefined` by construction, so
  // no render can send the container's zone; in the browser the very first
  // render already knows the viewer's, so the React Query key is right before
  // any request is made and there is no tz-less fetch to supersede.
  //
  // The value is deliberately never rendered — it exists only to key and
  // parameterise requests — so the server render and the hydration render
  // produce identical markup despite disagreeing about it.
  const timezone = useMemo(() => resolveViewerTimeZone(), []);

  const filters = useMemo(
    () => buildReportFilters(searchParams, timezone),
    [searchParams, timezone],
  );

  const dateRange = useMemo<DateRangeValue>(
    () => ({
      from: new Date(filters.fromDate),
      to: new Date(filters.toDate),
    }),
    [filters.fromDate, filters.toDate],
  );

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.accountKeys.length > 0) count += 1;
    if (filters.categoryKeys.length > 0) count += 1;
    if (filters.merchantKeys.length > 0) count += 1;
    if (filters.currencyKey) count += 1;
    if (filters.includePending) count += 1;
    if (filters.includeTransfers) count += 1;
    return count;
  }, [filters]);

  const updateParams = useCallback(
    (updater: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      updater(params);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const setDateRange = useCallback(
    (range: DateRangeValue | undefined) => {
      const nextRange = range ?? getDefaultDateRange();
      updateParams((params) => {
        params.set(PARAM_FROM, serializeDate(startOfDay(nextRange.from)));
        params.set(PARAM_TO, serializeDate(endOfDay(nextRange.to)));
      });
    },
    [updateParams],
  );

  const setAccountKeys = useCallback(
    (keys: string[]) => {
      updateParams((params) => {
        const serialized = serializeArray(keys);
        if (serialized) params.set(PARAM_ACCOUNTS, serialized);
        else params.delete(PARAM_ACCOUNTS);
      });
    },
    [updateParams],
  );

  const setCategoryKeys = useCallback(
    (keys: string[]) => {
      updateParams((params) => {
        const serialized = serializeArray(keys);
        if (serialized) params.set(PARAM_CATEGORIES, serialized);
        else params.delete(PARAM_CATEGORIES);
      });
    },
    [updateParams],
  );

  const setMerchantKeys = useCallback(
    (keys: string[]) => {
      updateParams((params) => {
        const serialized = serializeArray(keys);
        if (serialized) params.set(PARAM_MERCHANTS, serialized);
        else params.delete(PARAM_MERCHANTS);
      });
    },
    [updateParams],
  );

  const setCurrencyKey = useCallback(
    (key: string | undefined) => {
      updateParams((params) => {
        if (key) params.set(PARAM_CURRENCY, key);
        else params.delete(PARAM_CURRENCY);
      });
    },
    [updateParams],
  );

  const setIncludePending = useCallback(
    (value: boolean) => {
      updateParams((params) => {
        if (value) params.set(PARAM_PENDING, "true");
        else params.delete(PARAM_PENDING);
      });
    },
    [updateParams],
  );

  const setIncludeTransfers = useCallback(
    (value: boolean) => {
      updateParams((params) => {
        if (value) params.set(PARAM_TRANSFERS, "true");
        else params.delete(PARAM_TRANSFERS);
      });
    },
    [updateParams],
  );

  const resetFilters = useCallback(() => {
    updateParams((params) => {
      const defaultRange = getDefaultDateRange();
      params.set(PARAM_FROM, serializeDate(startOfDay(defaultRange.from)));
      params.set(PARAM_TO, serializeDate(endOfDay(defaultRange.to)));
      params.delete(PARAM_ACCOUNTS);
      params.delete(PARAM_CATEGORIES);
      params.delete(PARAM_MERCHANTS);
      params.delete(PARAM_CURRENCY);
      params.delete(PARAM_PENDING);
      params.delete(PARAM_TRANSFERS);
    });
  }, [updateParams]);

  return {
    filters,
    dateRange,
    activeFilterCount,
    setDateRange,
    setAccountKeys,
    setCategoryKeys,
    setMerchantKeys,
    setCurrencyKey,
    setIncludePending,
    setIncludeTransfers,
    resetFilters,
  };
}

/**
 * Preset date ranges exposed to the date picker.
 * Returns plain Date objects; callers should apply startOfDay/endOfDay
 * before persisting or sending to the API.
 */
export type DateRangePreset =
  | "thisMonth"
  | "lastMonth"
  | "last3Months"
  | "last6Months"
  | "last12Months"
  | "allTime";

export const ALL_TIME_START = new Date(2000, 0, 1);

export function getPresetDateRange(preset: DateRangePreset): DateRangeValue {
  const now = new Date();

  switch (preset) {
    case "thisMonth":
      return {
        from: startOfMonth(now),
        to: endOfMonth(now),
      };
    case "lastMonth":
      return {
        from: startOfMonth(subMonths(now, 1)),
        to: endOfMonth(subMonths(now, 1)),
      };
    case "last3Months":
      return {
        from: startOfDay(subMonths(now, 3)),
        to: endOfDay(now),
      };
    case "last6Months":
      return {
        from: startOfDay(subMonths(now, 6)),
        to: endOfDay(now),
      };
    case "last12Months":
      return {
        from: startOfDay(subMonths(now, 12)),
        to: endOfDay(now),
      };
    case "allTime":
      return {
        from: ALL_TIME_START,
        to: endOfDay(now),
      };
    default:
      return getDefaultDateRange();
  }
}

export function detectPresetForRange(
  range: DateRangeValue,
): DateRangePreset | "custom" {
  const now = new Date();

  const matchers: Array<{ preset: DateRangePreset; match: () => boolean }> = [
    {
      preset: "thisMonth",
      match: () =>
        range.from.getTime() === startOfMonth(now).getTime() &&
        range.to.getTime() === endOfMonth(now).getTime(),
    },
    {
      preset: "lastMonth",
      match: () =>
        range.from.getTime() === startOfMonth(subMonths(now, 1)).getTime() &&
        range.to.getTime() === endOfMonth(subMonths(now, 1)).getTime(),
    },
    {
      preset: "last3Months",
      match: () =>
        range.from.getTime() === startOfDay(subMonths(now, 3)).getTime() &&
        range.to.getTime() === endOfDay(now).getTime(),
    },
    {
      preset: "last6Months",
      match: () =>
        range.from.getTime() === startOfDay(subMonths(now, 6)).getTime() &&
        range.to.getTime() === endOfDay(now).getTime(),
    },
    {
      preset: "last12Months",
      match: () =>
        range.from.getTime() === startOfDay(subMonths(now, 12)).getTime() &&
        range.to.getTime() === endOfDay(now).getTime(),
    },
    {
      preset: "allTime",
      match: () =>
        range.from.getTime() === ALL_TIME_START.getTime() &&
        range.to.getTime() === endOfDay(now).getTime(),
    },
  ];

  return matchers.find((m) => m.match())?.preset ?? "custom";
}
