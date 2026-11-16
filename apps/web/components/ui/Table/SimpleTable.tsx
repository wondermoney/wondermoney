"use client";

import React from "react";

import { cn } from "@/lib/utils";

const SimpleTable = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement> & { mobileCards?: boolean }
>(({ className, mobileCards = false, ...props }, ref) => (
  <div className="relative w-full">
    <table
      ref={ref}
      role={mobileCards ? "table" : undefined}
      className={cn(
        "w-full caption-bottom text-sm",
        mobileCards &&
          "max-sm:block max-sm:[&_tbody]:block max-sm:[&_tbody_tr]:grid max-sm:[&_tbody_tr]:grid-cols-2 max-sm:[&_tbody_tr]:gap-3 max-sm:[&_tbody_tr]:py-4 max-sm:[&_td]:block max-sm:[&_td]:min-w-0 max-sm:[&_td]:p-0 max-sm:[&_td]:text-left max-sm:[&_td]:whitespace-normal max-sm:[&_td:first-child]:order-first max-sm:[&_td:first-child]:col-span-2 max-sm:[&_thead]:sr-only",
        className,
      )}
      {...props}
    />
  </div>
));
SimpleTable.displayName = "SimpleTable";

export { SimpleTable };
