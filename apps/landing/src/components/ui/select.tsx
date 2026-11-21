import * as React from "react";

import { cn } from "@/lib/utils";
import { fieldControlClass } from "./fieldControl";

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  /** Classes for the positioning wrapper around the control and its chevron. */
  wrapperClassName?: string;
};

/**
 * The site's one dropdown: a native select with the browser's arrow removed and its own
 * chevron drawn 12px from the right edge, the same inset as the text on the left. The
 * native arrow sits flush with the border, so no `<select>` is drawn anywhere else
 * (`selectUsage.test.ts` fails on one). The box is the text field's (`fieldControlClass`),
 * error border on `aria-invalid` included.
 *
 * The props are the native select's: `id`, `value`, `onChange`, `aria-*` and `disabled`
 * reach the `<select>` itself, so a `<label htmlFor>` and `getByLabelText` find it.
 * The control is set in the body face whatever `className` asks for: Geist Mono is for
 * figures, not for a choice (`DESIGN.md`).
 */
const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, wrapperClassName, children, ...props }, ref) => (
    <div className={cn("relative", wrapperClassName)}>
      <select
        ref={ref}
        className={cn(
          fieldControlClass,
          "peer cursor-pointer appearance-none pl-3 pr-9",
          className,
          "font-sans",
        )}
        {...props}
      >
        {children}
      </select>
      <svg
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground peer-disabled:opacity-50"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  ),
);
Select.displayName = "Select";

export { Select };
