"use client";

import { useLocale } from "next-intl";
import * as React from "react";

import { Input, type InputProps } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { cn } from "@/lib/utils";
import { useAmountPlaceholder } from "@/lib/utils/currency-field";
import { formatLocaleNumberInput } from "@/lib/utils/number";

interface CurrencyPicker {
  value?: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  /** Names the picker for assistive tech; the field label names the amount. */
  label: string;
}

export interface MoneyInputProps extends Omit<InputProps, "startAdornment"> {
  /** The currency code shown inside the field when it is fixed. */
  currency?: string;
  /** A currency picker inside the field, for the one amount that sets it. */
  currencyPicker?: CurrencyPicker;
  /**
   * A caller's own picker in the currency's place, such as the searchable
   * currency combobox the transaction forms bind to their form state.
   */
  currencySlot?: React.ReactElement;
}

/**
 * An amount and its currency in one control: the code (or a picker) sits
 * inside the field on the left, the figure right-aligned in Geist Mono. The
 * placeholder is a zero in the reader's number format unless the caller
 * passes a more useful one.
 *
 * A stored number (a form's default value) is shown with the reader's decimal
 * separator, so a pt reader sees 1.234 as "1,234" and editing it cannot turn it
 * into 1234. Parse what comes back with `zLocaleNumber` / `parseLocaleNumber`.
 *
 * The picker is a plain Select rather than a form-bound combobox, so the
 * field's label and `FormControl` id stay on the amount input.
 */
const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(
  (
    {
      currency,
      currencyPicker,
      currencySlot,
      className,
      placeholder,
      value,
      ...props
    },
    ref,
  ) => {
    const amountPlaceholder = useAmountPlaceholder();
    const locale = useLocale();

    const adornment = currencySlot ? (
      currencySlot
    ) : currencyPicker ? (
      <Select
        value={currencyPicker.value}
        onValueChange={currencyPicker.onChange}
      >
        <SelectTrigger
          aria-label={currencyPicker.label}
          className="hover:bg-accent h-8 w-auto gap-1 border-none bg-transparent px-2 font-mono"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {currencyPicker.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : currency ? (
      <span className="font-mono">{currency}</span>
    ) : undefined;

    return (
      <Input
        ref={ref}
        inputMode="decimal"
        placeholder={placeholder ?? amountPlaceholder}
        className={cn("text-right font-mono", className)}
        startAdornment={adornment}
        startAdornmentClassName={
          currencyPicker || currencySlot ? "pl-2" : undefined
        }
        {...props}
        value={
          typeof value === "number"
            ? formatLocaleNumberInput(value, locale)
            : value
        }
      />
    );
  },
);
MoneyInput.displayName = "MoneyInput";

export { MoneyInput };
