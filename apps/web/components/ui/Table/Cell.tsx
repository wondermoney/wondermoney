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
    VariantProps<typeof cellVariants> {}

const TableCell = React.forwardRef<HTMLTableCellElement, TableCellProps>(
  ({ variant, className, ...props }, ref) => (
    <td
      ref={ref}
      className={cn(cellVariants({ variant }), className)}
      {...props}
    />
  ),
);
TableCell.displayName = "TableCell";

export { TableCell };
