"use client";

import React from "react";

import { cn } from "@/lib/utils";

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "text-muted-foreground h-12 px-3 text-left align-middle font-medium lg:px-6 [&:has([role=checkbox])]:pr-0 [&:has(button)]:p-0",
      className,
    )}
    {...props}
  />
));
TableHead.displayName = "TableHead";

export { TableHead };
