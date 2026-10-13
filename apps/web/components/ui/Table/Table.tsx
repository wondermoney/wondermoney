"use client";

import {
  type ColumnDef,
  type ExpandedState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type Row,
  type RowData,
  type RowSelectionState,
  type SortingState,
  type Table as TableType,
  type TableMeta,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { Button } from "../button";
import { Checkbox } from "../checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../dropdown-menu";
import {
  Pagination,
  SimpleTable,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from ".";
import TableEmptyState from "./EmptyState";

declare module "@tanstack/react-table" {
  interface TableMeta<TData extends RowData> {
    updateData?: (row: Row<TData>, columnId: string, value: string) => void;
    getRowStyles?: (row: Row<TData>) => React.CSSProperties;
    getRowClasses?: (row: Row<TData>) => Record<string, boolean>;
    getBodyClasses?: () => string;
  }
}

function useSkipper() {
  const shouldSkipRef = useRef(true);
  const shouldSkip = shouldSkipRef.current;

  const skip = useCallback(() => {
    shouldSkipRef.current = false;
  }, []);

  useEffect(() => {
    shouldSkipRef.current = true;
  });

  return [shouldSkip, skip] as const;
}

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  withSorting?: boolean;
  withExpandableRows?: boolean;
  withPagination?: boolean;
  withColumnVisibility?: boolean;
  withSelectRow?: boolean;
  withMultiSelectRow?: boolean;
  withScrollAffordance?: boolean;
  scrollAffordanceLabel?: string;
  defaultExpanded?: boolean;
  debugTable?: boolean;
  onRowClick?: (row: Row<TData>) => void;
  onRowSelectionChange?: (rows: Row<TData>[]) => void;
  meta?: TableMeta<TData>;
  sticky?: boolean;
  footerActions?: React.ReactNode;
  tableRef?: React.RefObject<TableType<TData> | null>;
  /** RAD-576 — rows the server matched before its own `limit`. See `Pagination`. */
  serverTotal?: number;
}

export function Table<TData, TValue>({
  columns,
  data,
  withSorting = false,
  withExpandableRows = false,
  withPagination = false,
  withColumnVisibility = false,
  withSelectRow = false,
  withMultiSelectRow = false,
  withScrollAffordance = false,
  scrollAffordanceLabel,
  debugTable = false,
  defaultExpanded = false,
  onRowClick,
  onRowSelectionChange,
  meta,
  sticky = false,
  footerActions,
  tableRef,
  serverTotal,
}: DataTableProps<TData, TValue>) {
  const t = useTranslations();
  const affordanceLabel =
    scrollAffordanceLabel ?? t("scroll-horizontally-hint");

  const [sorting, setSorting] = useState<SortingState>([]);
  const [expanded, setExpanded] = useState<ExpandedState>(
    defaultExpanded === true ? true : {},
  );
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [autoResetPageIndex, skipAutoResetPageIndex] = useSkipper();
  const table = useReactTable({
    data,
    columns,
    state: {
      sorting: withSorting ? sorting : [],
      expanded: withExpandableRows ? expanded : {},
      columnVisibility: withColumnVisibility ? columnVisibility : {},
      rowSelection: withSelectRow || withMultiSelectRow ? rowSelection : {},
    },
    getCoreRowModel: getCoreRowModel(),
    onExpandedChange: withExpandableRows ? setExpanded : undefined,
    onSortingChange: withSorting ? setSorting : undefined,
    onColumnVisibilityChange: setColumnVisibility,
    enableRowSelection: withSelectRow,
    enableMultiRowSelection: withMultiSelectRow,
    onRowSelectionChange: setRowSelection,
    // @ts-ignore
    getSubRows: (row) => row.subRows,
    getSortedRowModel: withSorting ? getSortedRowModel() : undefined,
    getPaginationRowModel: withPagination ? getPaginationRowModel() : undefined,
    getExpandedRowModel: withExpandableRows ? getExpandedRowModel() : undefined,
    debugTable,
    autoResetPageIndex,
    meta,
  });

  if (tableRef) {
    tableRef.current = table;
  }

  const hasFooter =
    table
      .getFooterGroups()
      .map((group) =>
        group.headers.map((header) => header.column.columnDef.footer),
      )
      .flat()
      .filter(Boolean).length > 0;

  useEffect(() => {
    if ((withSelectRow || withMultiSelectRow) && onRowSelectionChange) {
      const selectedRows = Object.keys(rowSelection)
        .filter((key) => rowSelection[key])
        .map((key) => table.getRow(key));
      onRowSelectionChange(selectedRows);
    }
  }, [
    rowSelection,
    onRowSelectionChange,
    withSelectRow,
    table,
    withMultiSelectRow,
  ]);

  return (
    <>
      {withColumnVisibility && (
        <div className="flex items-center py-4">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="ml-auto">
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {table
                .getAllColumns()
                .filter((column) => column.getCanHide())
                .map((column) => {
                  return (
                    <Checkbox
                      key={column.id}
                      className="capitalize"
                      checked={column.getIsVisible()}
                      onCheckedChange={(value) =>
                        column.toggleVisibility(!!value)
                      }
                    >
                      {column.id}
                    </Checkbox>
                  );
                })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {withScrollAffordance && (
        <p className="text-muted-foreground mb-2 block text-xs md:hidden">
          {affordanceLabel}
        </p>
      )}
      <div className="relative max-w-full">
        <div className="block overflow-x-auto overflow-y-hidden">
          <SimpleTable>
            <TableHeader className={cn({ "sticky z-10": sticky })}>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    return (
                      <TableHead key={header.id}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody className={cn(meta?.getBodyClasses?.() ?? "")}>
              {table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && "selected"}
                    onClick={(event) => {
                      if (!onRowClick) return;
                      // A row click must never fire from a control inside the
                      // row. Without this, adding row-click-to-inspect broke
                      // the inline category editor: clicking "Edit category"
                      // opened the row's drawer instead of the category
                      // popover, because the button's click bubbled to the
                      // <tr>. Checkboxes, action menus and links are the same
                      // shape.
                      const target = event.target as HTMLElement;
                      if (
                        target.closest(
                          'button, a, input, select, textarea, label, [role="checkbox"], [role="combobox"], [role="menuitem"]',
                        )
                      ) {
                        return;
                      }
                      onRowClick(row);
                    }}
                    className={cn({
                      "cursor-pointer": !!onRowClick,
                      ...(meta?.getRowClasses?.(row) ?? {}),
                    })}
                    style={meta?.getRowStyles?.(row)}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const w = cell.column.getSize();
                      return (
                        <TableCell
                          key={cell.id}
                          style={{
                            // we need this to unset the default width of 150px
                            width: w !== 150 ? w : "auto",
                          }}
                        >
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={columns.length} className="p-0!">
                    <TableEmptyState />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
            {hasFooter && (
              <TableFooter>
                {table.getFooterGroups().map((footerGroup) => (
                  <TableRow key={footerGroup.id}>
                    {footerGroup.headers.map((footer) => {
                      return (
                        <TableCell key={footer.id}>
                          {footer.isPlaceholder
                            ? null
                            : flexRender(
                                footer.column.columnDef.footer,
                                footer.getContext(),
                              )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableFooter>
            )}
          </SimpleTable>
        </div>
        {withScrollAffordance && (
          <div
            aria-hidden="true"
            className="from-background pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-linear-to-l to-transparent md:hidden"
          />
        )}
        {(footerActions || withPagination) && (
          <div className="bg-muted/50 flex items-center justify-between p-2">
            {footerActions && <>{footerActions}</>}
            {withPagination && (
              <Pagination
                table={table}
                rowSelection={withSelectRow || withMultiSelectRow}
                serverTotal={serverTotal}
              />
            )}
          </div>
        )}
      </div>
    </>
  );
}
