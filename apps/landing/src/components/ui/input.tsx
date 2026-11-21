import * as React from "react";

import { cn } from "@/lib/utils";
import { fieldControlClass } from "./fieldControl";

export type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "prefix"> & {
  /** Drawn inside the field before the text, 12px from the left edge: a currency sign or an icon. */
  prefix?: React.ReactNode;
  /** Drawn inside the field after the text, 12px from the right edge: a percent sign or a unit. */
  suffix?: React.ReactNode;
  /** Classes for the positioning wrapper, which is there only when the field has an adornment. */
  wrapperClassName?: string;
};

const adornmentClass =
  "pointer-events-none absolute inset-y-0 flex items-center text-sm text-muted-foreground peer-disabled:opacity-50";

/**
 * The site's one text field, for text, numbers (through `NumericInput`), dates and search.
 * It draws the same box as `Select` (`fieldControlClass`): 40px, 6px radius, Input Stroke
 * border, the instant focus ring, and the error border while `aria-invalid` is true. No other
 * text, number or date `<input>` is drawn anywhere (`inputUsage.test.ts` fails on one).
 *
 * The props are the native input's and reach the `<input>` itself, so a `<label htmlFor>`,
 * `getByLabelText` and `getByRole` find it. With a `prefix` or `suffix` the input sits in a
 * relative wrapper that holds the adornment and the text clears it; without one there is no
 * wrapper, so `className` can size the input inside a flex row.
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, wrapperClassName, prefix, suffix, ...props }, ref) => {
    const input = (
      <input
        ref={ref}
        className={cn(
          fieldControlClass,
          "peer px-3 py-2 placeholder:text-muted-foreground",
          prefix != null && "pl-8",
          suffix != null && "pr-12",
          className,
        )}
        {...props}
      />
    );
    if (prefix == null && suffix == null) return input;

    return (
      <div className={cn("relative", wrapperClassName)}>
        {input}
        {prefix != null && <span className={cn(adornmentClass, "left-0 pl-3")}>{prefix}</span>}
        {suffix != null && <span className={cn(adornmentClass, "right-0 pr-3")}>{suffix}</span>}
      </div>
    );
  },
);
Input.displayName = "Input";

export { Input };
