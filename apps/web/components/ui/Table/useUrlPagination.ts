"use client";

import type {
  OnChangeFn,
  PaginationState,
  Updater,
} from "@tanstack/react-table";
import * as nextNavigation from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

const DEFAULT_PAGINATION: PaginationState = { pageIndex: 0, pageSize: 10 };

function parsePositiveInteger(value: string | null): number | undefined {
  if (value === null || !/^[1-9]\d*$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function readPagination(
  params: URLSearchParams,
  pageParamName: string,
  pageSizeParamName: string,
): PaginationState {
  const page = parsePositiveInteger(params.get(pageParamName));
  const pageSize = parsePositiveInteger(params.get(pageSizeParamName));
  return {
    pageIndex: page === undefined ? 0 : page - 1,
    pageSize: pageSize ?? DEFAULT_PAGINATION.pageSize,
  };
}

export function writePagination(
  pagination: PaginationState,
  pageParamName: string,
  pageSizeParamName: string,
  mode: "push" | "replace",
) {
  const url = new URL(window.location.href);
  const params = url.searchParams;
  params.set(pageParamName, String(pagination.pageIndex + 1));
  params.set(pageSizeParamName, String(pagination.pageSize));
  const href = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (href === current) return;

  if (mode === "push") window.history.pushState(null, "", href);
  else window.history.replaceState(null, "", href);
}

export function useUrlPagination(
  enabled: boolean,
  pageParamName: string,
  pageSizeParamName: string,
) {
  const searchParams = nextNavigation.useSearchParams?.();
  const pagination = enabled
    ? readPagination(
        new URLSearchParams(searchParams?.toString()),
        pageParamName,
        pageSizeParamName,
      )
    : DEFAULT_PAGINATION;

  const onPaginationChange: OnChangeFn<PaginationState> = useCallback(
    (updater: Updater<PaginationState>) => {
      if (!enabled) return;
      const url = new URL(window.location.href);
      const current = readPagination(
        url.searchParams,
        pageParamName,
        pageSizeParamName,
      );
      const next = typeof updater === "function" ? updater(current) : updater;
      if (
        !Number.isSafeInteger(next.pageIndex) ||
        next.pageIndex < 0 ||
        !Number.isSafeInteger(next.pageSize) ||
        next.pageSize < 1
      ) {
        return;
      }
      if (
        next.pageIndex === current.pageIndex &&
        next.pageSize === current.pageSize
      ) {
        return;
      }
      writePagination(next, pageParamName, pageSizeParamName, "push");
    },
    [enabled, pageParamName, pageSizeParamName],
  );

  return { pagination, onPaginationChange };
}

export function applyPaginationCorrection(
  params: URLSearchParams,
  pageParamName: string,
  pageSizeParamName: string,
  pageCount: number,
  boundsKnown: boolean,
): boolean {
  const rawPage = params.get(pageParamName);
  const rawSize = params.get(pageSizeParamName);
  const page = parsePositiveInteger(rawPage);
  const size = parsePositiveInteger(rawSize);
  let changed = false;

  if (rawPage !== null && page === undefined) {
    params.delete(pageParamName);
    changed = true;
  }
  if (rawSize !== null && size === undefined) {
    params.delete(pageSizeParamName);
    changed = true;
  }
  if (
    boundsKnown &&
    page !== undefined &&
    Number.isFinite(pageCount) &&
    page > Math.max(pageCount, 1)
  ) {
    params.set(pageParamName, "1");
    changed = true;
  }
  return changed;
}

interface PaginationResetOptions<TData> {
  enabled: boolean;
  data: TData[];
  sortKey: string;
  resetKey?: string | number;
  dataReady: boolean;
  boundsKnown: boolean;
  pageSize: number;
  pageCount: number;
  pageParamName: string;
  pageSizeParamName: string;
}

interface PaginationBaseline<TData> {
  sortKey: string;
  resetKey?: string | number;
  rows: TData[];
}

function sameRows<TData>(previous: TData[], current: TData[]) {
  return (
    previous.length === current.length &&
    previous.every((row, index) => Object.is(row, current[index]))
  );
}

function replaceSearchParams(params: URLSearchParams) {
  const url = new URL(window.location.href);
  url.search = params.toString();
  const href = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (href !== current) {
    window.history.replaceState(null, "", href);
  }
}

export function usePaginationReset<TData>({
  enabled,
  data,
  sortKey,
  resetKey,
  dataReady,
  boundsKnown,
  pageSize,
  pageCount,
  pageParamName,
  pageSizeParamName,
}: PaginationResetOptions<TData>) {
  const searchParams = nextNavigation.useSearchParams?.();
  const baseline = useRef<PaginationBaseline<TData> | null>(null);

  useEffect(() => {
    if (!enabled) {
      baseline.current = null;
      return;
    }

    if (!dataReady) {
      return;
    }

    const previous = baseline.current;
    if (!previous) {
      baseline.current = { sortKey, resetKey, rows: data };
      return;
    }

    const changed =
      previous.sortKey !== sortKey ||
      previous.resetKey !== resetKey ||
      !sameRows(previous.rows, data);

    // Commit before writing so Strict Mode effect replay cannot repeat a reset.
    baseline.current = { sortKey, resetKey, rows: data };
    const currentPagination = readPagination(
      new URLSearchParams(window.location.search),
      pageParamName,
      pageSizeParamName,
    );
    if (changed && currentPagination.pageIndex !== 0) {
      const params = new URLSearchParams(window.location.search);
      params.set(pageParamName, "1");
      replaceSearchParams(params);
    }
  }, [
    enabled,
    data,
    sortKey,
    resetKey,
    dataReady,
    pageParamName,
    pageSizeParamName,
  ]);

  useEffect(() => {
    if (!enabled || !dataReady) return;
    const params = new URLSearchParams(window.location.search);
    const currentPagination = readPagination(
      params,
      pageParamName,
      pageSizeParamName,
    );
    if (currentPagination.pageSize !== pageSize) return;
    if (
      applyPaginationCorrection(
        params,
        pageParamName,
        pageSizeParamName,
        pageCount,
        boundsKnown,
      )
    ) {
      replaceSearchParams(params);
    }
  }, [
    enabled,
    dataReady,
    searchParams,
    pageParamName,
    pageSizeParamName,
    pageSize,
    pageCount,
    boundsKnown,
  ]);
}

export { parsePositiveInteger };
