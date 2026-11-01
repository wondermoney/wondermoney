import {
  type Column as CoreColumn,
  type ColumnDef as CoreColumnDef,
  columnSizingFeature,
  columnVisibilityFeature,
  createColumnHelper as createCoreColumnHelper,
  createExpandedRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  type Row as CoreRow,
  type RowData,
  rowExpandingFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  sortFns,
  type Table as CoreTable,
  tableFeatures,
} from "@tanstack/react-table";

/**
 * The TanStack Table v9 features every app table runs with.
 *
 * v8 bundled every feature into every table; v9 only exposes the APIs of the
 * features registered here. This is the set the shared `<Table>` and its
 * column definitions use: sorting, row expansion (budget category groups),
 * pagination, column visibility, row selection and column sizes. All built-in
 * sort functions stay registered so `sortFn: "auto"` resolves as it did in v8.
 *
 * Defined once, at module level, because v9 wants a stable `features` object.
 */
export const dataTableFeatures = tableFeatures({
  columnSizingFeature,
  columnVisibilityFeature,
  rowExpandingFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  expandedRowModel: createExpandedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
  sortFns,
});

export type DataTableFeatures = typeof dataTableFeatures;

// v9 adds the feature set as the first generic of every core type. These keep
// the v8 spelling (`ColumnDef<TData, TValue>`, `Row<TData>`) for app code.
export type ColumnDef<TData extends RowData, TValue = any> = CoreColumnDef<
  DataTableFeatures,
  TData,
  TValue
>;
export type Column<TData extends RowData, TValue = unknown> = CoreColumn<
  DataTableFeatures,
  TData,
  TValue
>;
export type Row<TData extends RowData> = CoreRow<DataTableFeatures, TData>;
export type Table<TData extends RowData> = CoreTable<DataTableFeatures, TData>;

export function createColumnHelper<TData extends RowData>() {
  return createCoreColumnHelper<DataTableFeatures, TData>();
}
