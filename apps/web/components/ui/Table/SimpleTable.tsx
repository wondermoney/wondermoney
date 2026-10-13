"use client";

import React from "react";

import { cn } from "@/lib/utils";

const SimpleTable = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <div className="relative w-full">
    <table
      ref={ref}
      className={cn("w-full caption-bottom text-sm", className)}
      {...props}
    />
  </div>
));
SimpleTable.displayName = "SimpleTable";

export { SimpleTable };
