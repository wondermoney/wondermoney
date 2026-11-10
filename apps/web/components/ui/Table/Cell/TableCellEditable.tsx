"use client";

import type { RowData } from "@tanstack/react-table";
import { useLocale } from "next-intl";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { AMOUNT_MASK } from "@/lib/privacy/mask";
import { usePrivacyMode } from "@/lib/privacy/usePrivacyMode";
import { cn } from "@/lib/utils";
import { formatLocaleNumberInput } from "@/lib/utils/number";

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
  // A number is shown with the reader's decimal separator, so leaving the cell
  // untouched (or editing it) reads back as the same figure, and updateData
  // always receives the text in the field.
  const locale = useLocale();
  const shown =
    typeof initialValue === "number"
      ? formatLocaleNumberInput(initialValue, locale)
      : initialValue;
  // We need to keep and update the state of the cell normally
  const [value, setValue] = useState(shown);
  // The cell is a figure on screen until someone edits it: privacy mode masks
  // it at rest and shows the real value only while it has focus.
  const { hidden } = usePrivacyMode();
  const [focused, setFocused] = useState(false);
  const masked = hidden && !focused;
  // If the initialValue is changed externally, sync it up with our state
  // (adjusted during render rather than in an effect).
  const [prevInitialValue, setPrevInitialValue] = useState(initialValue);
  if (initialValue !== prevInitialValue) {
    setPrevInitialValue(initialValue);
    setValue(shown);
  }

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value);
  };

  // We'll only update the external data when the input is blurred
  const onBlur = () => {
    setFocused(false);
    const didCommit = updateData(row, column.id, value);

    if (didCommit === false) {
      setValue(shown);
    }
  };

  return (
    <Input
      wrapperClassName={cn(className)}
      className="pr-2 text-right font-mono"
      type="tel"
      value={masked ? AMOUNT_MASK : value}
      onChange={onChange}
      onFocus={() => setFocused(true)}
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
