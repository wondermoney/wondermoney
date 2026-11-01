"use client";

import type { RowData } from "@tanstack/react-table";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { Spinner } from "../../Spinner";
import type { Row } from "../features";

interface EditableCellProps<TData extends RowData> {
  value: any;
  row: Row<TData>;
  column: { id: string };
  updateData: (
    row: Row<TData>,
    columnId: string,
    value: string,
  ) => boolean | void;
  inputPrefix?: string;
  isLoading?: boolean;
  className?: string;
  min?: number;
}

// Create an editable cell renderer
function TableCellEditable<TData extends RowData>({
  value: initialValue,
  row,
  column,
  updateData, // This is a custom function that we supplied to our table instance
  inputPrefix,
  isLoading,
  className,
  min,
}: EditableCellProps<TData>) {
  // We need to keep and update the state of the cell normally
  const [value, setValue] = useState(initialValue);
  // If the initialValue is changed externally, sync it up with our state
  // (adjusted during render rather than in an effect).
  const [prevInitialValue, setPrevInitialValue] = useState(initialValue);
  if (initialValue !== prevInitialValue) {
    setPrevInitialValue(initialValue);
    setValue(initialValue);
  }

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value);
  };

  // We'll only update the external data when the input is blurred
  const onBlur = () => {
    const didCommit = updateData(row, column.id, value);

    if (didCommit === false) {
      setValue(initialValue);
    }
  };

  return (
    <Input
      wrapperClassName={cn(className)}
      className="pr-2 text-right font-mono"
      type="tel"
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      startAdornment={
        inputPrefix ? <span className="mx-4">{inputPrefix}</span> : undefined
      }
      startAdornmentClassName="p-0"
      disabled={isLoading}
      endAdornment={isLoading ? <Spinner /> : undefined}
      min={min}
    />
  );
}

export default TableCellEditable;
