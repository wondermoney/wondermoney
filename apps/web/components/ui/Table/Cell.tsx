"use client";

import { cva, VariantProps } from "class-variance-authority";
import React from "react";

import { cn } from "@/lib/utils";

const cellVariants = cva(
  // § 9 observation 2: dense vertically, airy horizontally — "the eye scans down
  // a tight column and across a loose one". The vertical padding stays at 2
  // (rows land near 36px, tighter than the reference's ~52px, which is the
  // direction we want); the horizontal gutter widens so columns stop crowding.
  "px-3 py-2 align-middle lg:px-6 [&:has([role=checkbox])]:pr-0 [&:has(button:not([data-state]))]:p-0",
  {
    variants: {
      variant: {
        default: "",
        numeric: "font-mono",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

interface TableCellProps
  extends
    React.TdHTMLAttributes<HTMLTableCellElement>,
    VariantProps<typeof cellVariants> {
  mobileLabel?: React.ReactNode;
  mobilePriority?: boolean;
}

const TableCell = React.forwardRef<HTMLTableCellElement, TableCellProps>(
  (
    { variant, className, mobileLabel, mobilePriority, children, ...props },
    ref,
  ) => (
    <td
      ref={ref}
      className={cn(
        cellVariants({ variant }),
        mobilePriority && "max-sm:order-first max-sm:col-span-2",
        className,
      )}
      {...props}
    >
      {mobileLabel ? (
        <span
          aria-hidden="true"
          className="text-muted-foreground mb-1 block font-sans text-xs font-normal sm:hidden"
        >
          {mobileLabel}
        </span>
      ) : null}
      {children}
    </td>
  ),
);
TableCell.displayName = "TableCell";

export { TableCell };
