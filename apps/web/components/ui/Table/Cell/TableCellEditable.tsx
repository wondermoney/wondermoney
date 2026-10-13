"use client";

import type { Row } from "@tanstack/react-table";
import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { Spinner } from "../../Spinner";

interface EditableCellProps {
  value: any;
  row: Row<any>;
  column: { id: string };
  updateData: (
    row: Row<any>,
    columnId: string,
    value: string,
  ) => boolean | void;
  inputPrefix?: string;
  isLoading?: boolean;
  className?: string;
  min?: number;
}

// Create an editable cell renderer
const TableCellEditable: React.FC<EditableCellProps> = ({
  value: initialValue,
  row,
  column,
  updateData, // This is a custom function that we supplied to our table instance
  inputPrefix,
  isLoading,
  className,
  min,
}) => {
  // We need to keep and update the state of the cell normally
  const [value, setValue] = useState(initialValue);

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

  // If the initialValue is changed external, sync it up with our state
  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

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
};

export default TableCellEditable;
