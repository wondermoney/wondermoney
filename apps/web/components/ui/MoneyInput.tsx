"use client";

import { useLocale, useTranslations } from "next-intl";
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
import {
  amountExpressionResult,
  formatLocaleNumberInput,
} from "@/lib/utils/number";

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
  /**
   * Turns on arithmetic in the field: while the text is an expression the field
   * shows its result quietly below ("= 15,55"), and on blur or Enter the text is
   * replaced by that result. Called with the locale-formatted result so the form
   * can store it. Omit it for fields that are not money amounts (a quantity or a
   * unit price), where rounding to cents would lose precision.
   */
  onEvaluated?: (value: string) => void;
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
 * With `onEvaluated`, the field also accepts a small arithmetic expression
 * ("12.40+3.15"), the same parser mobile uses, and settles it on blur or Enter.
 * A plain number behaves exactly as before.
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
      onBlur,
      onKeyDown,
      onEvaluated,
      ...props
    },
    ref,
  ) => {
    const amountPlaceholder = useAmountPlaceholder();
    const locale = useLocale();

    // Only a string can be an expression; a stored number is already a figure.
    const result =
      onEvaluated && typeof value === "string"
        ? amountExpressionResult(value, locale)
        : null;

    const settle = React.useCallback(() => {
      if (!onEvaluated || result === null) return false;
      onEvaluated(formatLocaleNumberInput(result, locale));
      return true;
    }, [locale, onEvaluated, result]);

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

    const input = (
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
        onBlur={(event) => {
          onBlur?.(event);
          settle();
        }}
        onKeyDown={(event) => {
          // Enter settles the expression instead of submitting the form; a
          // second Enter (now a plain number) submits as usual.
          if (event.key === "Enter" && settle()) {
            event.preventDefault();
            return;
          }
          onKeyDown?.(event);
        }}
        value={
          typeof value === "number"
            ? formatLocaleNumberInput(value, locale)
            : value
        }
      />
    );

    // Without evaluation the field is exactly the bare input it always was, so
    // existing layouts (a narrow split line, a grid cell) do not move.
    if (!onEvaluated) return input;

    return (
      <div className="flex flex-col gap-1">
        {input}
        <AmountExpressionHint locale={locale} value={String(value ?? "")} />
      </div>
    );
  },
);
MoneyInput.displayName = "MoneyInput";

/**
 * The quiet "= 15,55" line under an amount field while the text is an
 * expression. Renders nothing for a plain number, a blank field or an
 * expression that cannot be read.
 */
function AmountExpressionHint({
  value,
  locale,
}: {
  value: string;
  locale: string;
}) {
  const t = useTranslations();
  const result = amountExpressionResult(value, locale);
  if (result === null) return null;
  const hint = formatLocaleNumberInput(result, locale);
  return (
    <p
      aria-label={t("amount-expression-result", { amount: hint })}
      aria-live="polite"
      className="text-muted-foreground text-right font-mono text-xs tabular-nums"
    >
      = {hint}
    </p>
  );
}

export { AmountExpressionHint, MoneyInput };
