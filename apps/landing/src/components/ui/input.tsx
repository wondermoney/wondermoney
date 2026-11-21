import * as React from "react";

import { cn } from "@/lib/utils";
import { fieldControlClass, fieldGroupClass } from "./fieldControl";

export type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "prefix"> & {
  /** Drawn inside the field before the text, 12px from the left edge: a currency sign or an icon. */
  prefix?: React.ReactNode;
  /** Drawn inside the field after the text, 12px from the right edge: a percent sign or a unit. */
  suffix?: React.ReactNode;
  /** Classes for the box that holds the adornments, which is there only when the field has one. */
  wrapperClassName?: string;
};

const adornmentClass = "pointer-events-none flex shrink-0 items-center whitespace-nowrap text-sm text-muted-foreground";

/** A press on the box outside the text (its padding or an adornment) puts the caret in the field. */
function focusOwnInput(event: React.MouseEvent<HTMLDivElement>) {
  const input = event.currentTarget.querySelector("input");
  if (!input || event.target === input) return;
  event.preventDefault();
  input.focus();
}

/**
 * The site's one text field, for text, numbers (through `NumericInput`), dates and search.
 * It draws the same box as `Select` (`fieldControlClass`): 40px, 6px radius, Input Stroke
 * border, the instant focus ring, and the error border while `aria-invalid` is true. No other
 * text, number or date `<input>` is drawn anywhere (`inputUsage.test.ts` fails on one).
 *
 * The props are the native input's and reach the `<input>` itself, so a `<label htmlFor>`,
 * `getByLabelText` and `getByRole` find it. Without an adornment the input is the box, so
 * `className` can size it inside a flex row. With a `prefix` or `suffix` a wrapper draws the
 * box (`fieldGroupClass`, sized by `wrapperClassName`) and lays the adornments and the input
 * out in a row, 12px from the edges and 8px from the text: the text stops where the unit
 * starts, however long the unit is in the visitor's language ("L/100 km", "Jahre").
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, wrapperClassName, prefix, suffix, ...props }, ref) => {
    if (prefix == null && suffix == null) {
      return (
        <input
          ref={ref}
          className={cn(fieldControlClass, "px-3 py-2 placeholder:text-muted-foreground", className)}
          {...props}
        />
      );
    }

    return (
      <div className={cn(fieldGroupClass, "flex items-center gap-2 px-3", wrapperClassName)} onMouseDown={focusOwnInput}>
        {prefix != null && <span className={adornmentClass}>{prefix}</span>}
        <input
          ref={ref}
          className={cn(
            "h-full min-w-0 flex-1 border-0 bg-transparent py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed",
            className,
          )}
          {...props}
        />
        {suffix != null && <span className={adornmentClass}>{suffix}</span>}
      </div>
    );
  },
);
Input.displayName = "Input";

export { Input };
