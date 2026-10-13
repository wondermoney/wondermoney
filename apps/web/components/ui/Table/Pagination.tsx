"use client";

import { Table } from "@tanstack/react-table";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { Button } from "../button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../Select";

interface DataTablePaginationProps<TData> {
  table: Table<TData>;
  rowSelection?: boolean;
  pageParamName?: string;
  pageSizeParamName?: string;
  /**
   * RAD-576 — rows the *server* matched, before its own `limit`.
   *
   * Pass this whenever the data source knows it (the transactions endpoint
   * returns `total`), so the footer says "8,623 results" rather than counting
   * the 500 rows it happens to be holding. Omit it and the footer falls back to
   * the loaded row model, which is right for any table that loads everything.
   *
   * Only pass it when `data` is the server's whole result set. A caller that
   * filters in the browser before handing rows over — `AccountTransactionsTable`
   * does — must withhold it while a filter is active, or the footer reads
   * "8,623 results" above eight rows.
   */
  serverTotal?: number;
}

export function Pagination<TData>({
  table,
  rowSelection = false,
  pageParamName = "page",
  pageSizeParamName = "size",
  serverTotal,
}: DataTablePaginationProps<TData>) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Set the initial page and page size from URL on component mount
  useEffect(() => {
    const pageParam = searchParams.get(pageParamName);
    const sizeParam = searchParams.get(pageSizeParamName);

    if (sizeParam) {
      const pageSize = parseInt(sizeParam, 10);
      if (!isNaN(pageSize) && pageSize > 0) {
        table.setPageSize(pageSize);
      }
    }

    if (pageParam) {
      const pageIndex = parseInt(pageParam, 10) - 1; // Convert to 0-indexed
      if (
        !isNaN(pageIndex) &&
        pageIndex >= 0 &&
        pageIndex < table.getPageCount()
      ) {
        table.setPageIndex(pageIndex);
      }
    }
  }, [searchParams, pageParamName, pageSizeParamName, table]);

  // Update URL when page changes
  const handlePageChange = (pageIndex: number) => {
    const newParams = new URLSearchParams(searchParams.toString());
    newParams.set(pageParamName, (pageIndex + 1).toString()); // Convert to 1-indexed
    router.push(`${pathname}?${newParams.toString()}`);
    table.setPageIndex(pageIndex);
  };

  // Update URL when page size changes
  const handlePageSizeChange = (size: number) => {
    const newParams = new URLSearchParams(searchParams.toString());
    newParams.set(pageSizeParamName, size.toString());

    // Reset to first page when changing page size
    newParams.set(pageParamName, "1");
    router.push(`${pathname}?${newParams.toString()}`);

    table.setPageSize(size);
    table.setPageIndex(0);
  };

  const filteredCount = table.getFilteredRowModel().rows.length;
  const loadedCount = table.getCoreRowModel().rows.length;
  const selectedCount = table.getFilteredSelectedRowModel().rows.length;

  // The server's count when the caller vouched for it, the loaded rows otherwise.
  const totalCount = serverTotal ?? loadedCount;

  return (
    <div className="flex w-full items-center justify-between gap-6 px-2">
      {/* The result count is unconditional, and leads. It used to appear only
          when row selection was enabled, and then said "0 of 22 row(s)
          selected" — leading with a selection count of zero rather than with
          how many rows you are actually looking at. § 9 rules 6 and 7: a data
          surface says what it is showing, and says so when filtered. */}
      <div className="text-muted-foreground flex-1 text-sm">
        {filteredCount === loadedCount
          ? t("results-count", { count: totalCount })
          : t("results-count-filtered", {
              filtered: filteredCount,
              total: totalCount,
            })}
        {rowSelection && selectedCount > 0 ? (
          <>
            {" · "}
            {t("selected-rows", {
              selected: selectedCount,
              total: filteredCount,
            })}
          </>
        ) : null}
      </div>
      <div className="hidden items-center md:flex md:gap-2">
        <p className="text-muted-foreground shrink-0 text-sm">
          {t("rows-per-page")}
        </p>
        <Select
          value={`${table.getState().pagination.pageSize}`}
          onValueChange={(value) => {
            handlePageSizeChange(Number(value));
          }}
        >
          <SelectTrigger className="h-8">
            <SelectValue>
              {table.getState().pagination.pageSize.toString()}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem key="10" value="10">
                10
              </SelectItem>
              <SelectItem key="20" value="20">
                20
              </SelectItem>
              <SelectItem key="50" value="50">
                50
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div className="text-muted-foreground flex w-[100px] items-center justify-center text-sm">
        {t("page-x-of-y", {
          current: table.getState().pagination.pageIndex + 1,
          total: table.getPageCount() || 1,
        })}
      </div>
      <div className="flex items-center space-x-2">
        <Button
          variant="secondary"
          className="hidden size-8 p-0 lg:flex"
          onClick={() => handlePageChange(0)}
          disabled={!table.getCanPreviousPage()}
        >
          <span className="sr-only">{t("go-to-first-page")}</span>
          <ChevronsLeft className="size-4" />
        </Button>
        <Button
          variant="secondary"
          className="size-8 p-0"
          onClick={() =>
            handlePageChange(table.getState().pagination.pageIndex - 1)
          }
          disabled={!table.getCanPreviousPage()}
        >
          <span className="sr-only">{t("go-to-previous-page")}</span>
          <ChevronLeftIcon className="size-4" />
        </Button>
        <Button
          variant="secondary"
          className="size-8 p-0"
          onClick={() =>
            handlePageChange(table.getState().pagination.pageIndex + 1)
          }
          disabled={!table.getCanNextPage()}
        >
          <span className="sr-only">{t("go-to-next-page")}</span>
          <ChevronRightIcon className="size-4" />
        </Button>
        <Button
          variant="secondary"
          className="hidden size-8 p-0 lg:flex"
          onClick={() => handlePageChange(table.getPageCount() - 1)}
          disabled={!table.getCanNextPage()}
        >
          <span className="sr-only">{t("go-to-last-page")}</span>
          <ChevronsRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
