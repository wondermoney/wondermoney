import type { JSX } from "react";
import * as React from "react";

import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  startAdornment?: JSX.Element;
  endAdornment?: JSX.Element;
  wrapperClassName?: string;
  startAdornmentClassName?: string;
  endAdornmentClassName?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      wrapperClassName,
      type,
      startAdornment,
      startAdornmentClassName,
      endAdornment,
      endAdornmentClassName,
      ...props
    },
    ref,
  ) => {
    const hasAdornment = Boolean(startAdornment) || Boolean(endAdornment);
    const normalizedProps = Object.prototype.hasOwnProperty.call(props, "value")
      ? props.value === undefined
        ? { ...props, value: "" }
        : props
      : props;
    return (
      <>
        {hasAdornment ? (
          <div
            // The ring lives on the wrapper because the inner input has no
            // border of its own — so `has-[:focus-visible]:` is the mechanism
            // here, not a deviation. What was inconsistent is now fixed: the
            // ring *colour* is scoped to the focused state like every other
            // primitive, instead of `ring-ring` sitting unconditionally on the
            // element. `w-full` matches the plain branch, which had it.
            className={cn(
              "border-input ring-offset-background has-[:focus-visible]:ring-ring has-[[aria-invalid=true]]:border-destructive-text has-[[aria-invalid=true]]:has-[:focus-visible]:ring-destructive-text flex h-10 w-full items-center justify-center rounded-md border bg-transparent transition-[border-color] duration-[var(--duration-micro)] ease-out has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-offset-2 data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50",
              wrapperClassName,
            )}
            data-disabled={props.disabled}
          >
            {startAdornment && (
              <div
                className={cn(
                  "text-muted-foreground pl-4 font-normal",
                  startAdornmentClassName,
                )}
              >
                {startAdornment}
              </div>
            )}
            <input
              type={type}
              className={cn(
                "placeholder:text-muted-foreground flex size-full rounded-md border-none bg-transparent py-2 text-sm shadow-none outline-hidden file:bg-transparent file:text-sm file:font-medium focus:ring-0 focus:ring-offset-0 focus-visible:border-none focus-visible:shadow-none focus-visible:outline-hidden",
                className,
              )}
              ref={ref}
              {...normalizedProps}
            />
            {endAdornment && (
              <div
                className={cn("text-muted-foreground", endAdornmentClassName)}
              >
                {endAdornment}
              </div>
            )}
          </div>
        ) : (
          <input
            type={type}
            className={cn(
              // `aria-invalid` is set by FormControl on every field it wraps.
              // Until now nothing styled it, so an invalid input looked
              // identical to a valid one and the only error signal was the
              // message below the field. The border and the focus ring now
              // carry it too — colour is never the sole cue, the message is
              // still there and still announced.
              "border-input placeholder:text-muted-foreground ring-offset-background focus-visible:ring-ring hover:border-ring/40 aria-[invalid=true]:border-destructive-text aria-[invalid=true]:focus-visible:ring-destructive-text disabled:hover:border-input flex h-10 w-full rounded-md border bg-transparent px-4 py-2 text-sm transition-[border-color] duration-[var(--duration-micro)] ease-out file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
              className,
            )}
            ref={ref}
            {...normalizedProps}
          />
        )}
      </>
    );
  },
);
Input.displayName = "Input";

export { Input };
