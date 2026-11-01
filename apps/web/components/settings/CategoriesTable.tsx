"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Pencil,
  Trash,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback } from "react";

import CategoryIcon, { categoryIconStyle } from "@/components/ui/CategoryIcon";
import { Table } from "@/components/ui/Table";
import TableCellDefault from "@/components/ui/Table/Cell/TableCellDefault";
import {
  type ColumnDef,
  createColumnHelper,
} from "@/components/ui/Table/features";
import useDeleteCategory from "@/lib/api/category/useDeleteCategory";
import { cn } from "@/lib/utils";
import { getCategoryTranslationKey } from "@/lib/utils/categories";
import { invalidateCategories } from "@/lib/utils/queryInvalidation";

import { Button } from "../ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { Text } from "../ui/Typography";
import { CategoryWithUI } from "./types";

interface CategoriesTableProps {
  categories: CategoryWithUI[];
  onEditCategory: (category: CategoryWithUI) => void;
}

const CategoriesTable: React.FC<CategoriesTableProps> = ({
  categories,
  onEditCategory,
}) => {
  const queryClient = useQueryClient();
  const t = useTranslations();
  const useDeleteCategoryMutation = useDeleteCategory();

  const onDeleteCategory = useCallback(
    (categoryKey: CategoryWithUI["categoryKey"]) => {
      useDeleteCategoryMutation.mutate(
        { categoryKey },
        {
          onSuccess: async () => {
            await invalidateCategories(queryClient);
          },
        },
      );
    },
    [queryClient, useDeleteCategoryMutation],
  );

  const columnHelper = createColumnHelper<CategoryWithUI>();
  const columns: ColumnDef<CategoryWithUI, any>[] = [
    columnHelper.display({
      id: "expander",
      header: (info) => (
        <Button
          variant="ghost"
          onClick={() => info.table.getToggleAllRowsExpandedHandler()}
        >
          {info.table.getIsAllRowsExpanded() ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </Button>
      ),
      cell: (info) =>
        info.row.getCanExpand() ? (
          <div className={`pl-[${info.row.depth * 2}rem]`}>
            {info.row.getIsExpanded() ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronUp className="size-4" />
            )}
          </div>
        ) : null,
    }),
    columnHelper.accessor("name", {
      header: t("name"),
      cell: (info) => (
        <TableCellDefault
          value={
            info.row.original.isSystemCategory
              ? t(getCategoryTranslationKey(info.getValue()))
              : info.getValue()
          }
          className={cn(info.row.depth === 0 && "font-bold")}
        />
      ),
    }),
    columnHelper.accessor("bgColor", {
      header: t("color"),
      cell: (info) => (
        <div
          className="size-6 rounded-full"
          style={{ backgroundColor: info.getValue() }}
          title={info.getValue()}
        />
      ),
    }),
    columnHelper.accessor("icon", {
      header: t("icon"),
      cell: (info) => (
        <CategoryIcon
          icon={info.getValue() as any}
          // The pastel colour darkened with `brightness(0.8)` stayed low
          // contrast; the shared helper mixes it toward the foreground ink.
          style={categoryIconStyle(info.row.original.bgColor)}
        />
      ),
    }),
    columnHelper.display({
      header: t("actions"),
      id: "actions",
      cell: (info) => {
        return (
          <div className="flex items-center gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Pencil
                    className={cn(
                      "hover:text-info-text size-4 cursor-pointer",
                      info.row.original.isSystemCategory &&
                        "cursor-not-allowed opacity-20",
                    )}
                    onClick={() => {
                      if (!info.row.original.isSystemCategory) {
                        onEditCategory(info.row.original);
                      }
                    }}
                  />
                </TooltipTrigger>
                <TooltipContent>
                  <Text>
                    {info.row.original.isSystemCategory
                      ? t("edit-category-system")
                      : t("edit-category")}
                  </Text>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Trash
                    className={cn(
                      "hover:text-destructive-text size-4 cursor-pointer",
                      info.row.original.isSystemCategory &&
                        "cursor-not-allowed opacity-20",
                    )}
                    onClick={() => {
                      if (!info.row.original.isSystemCategory) {
                        onDeleteCategory(info.row.original.categoryKey);
                      }
                    }}
                  />
                </TooltipTrigger>
                <TooltipContent>
                  <Text>
                    {info.row.original.isSystemCategory
                      ? t("delete-category-system")
                      : t("delete-category")}
                  </Text>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        );
      },
    }),
  ];

  return (
    <Table
      columns={columns}
      data={categories}
      withExpandableRows
      defaultExpanded
    />
  );
};

export default CategoriesTable;
