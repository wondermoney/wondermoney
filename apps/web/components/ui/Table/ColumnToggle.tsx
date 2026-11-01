"use client";

import type { RowData } from "@tanstack/react-table";
import { SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "../button";
import { Checkbox } from "../checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from "../dropdown-menu";
import type { Table } from "./features";

interface DataTableViewOptionsProps<TData extends RowData> {
  table: Table<TData>;
}

export function ColumnToggle<TData extends RowData>({
  table,
}: DataTableViewOptionsProps<TData>) {
  const t = useTranslations();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto hidden h-8 lg:flex"
        >
          <SlidersHorizontal className="mr-2 size-4" />
          {t("view-by")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[150px]">
        <DropdownMenuGroup title={t("toggle-columns")}>
          {table
            .getAllColumns()
            .filter(
              (column) =>
                typeof column.accessorFn !== "undefined" && column.getCanHide(),
            )
            .map((column) => {
              return (
                <Checkbox
                  key={column.id}
                  className="capitalize"
                  checked={column.getIsVisible()}
                  onCheckedChange={(value) => column.toggleVisibility(!!value)}
                >
                  {column.id}
                </Checkbox>
              );
            })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
