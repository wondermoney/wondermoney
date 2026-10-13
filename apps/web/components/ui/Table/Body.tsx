"use client";

import React from "react";

import { cn } from "@/lib/utils";

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn(
      "[&_tr]:hover:bg-muted/50 [&_tr]:data-[state=selected]:bg-muted [&_tr]:transition-colors [&_tr:last-child]:border-0",
      className,
    )}
    {...props}
  />
));
TableBody.displayName = "TableBody";

export { TableBody };
