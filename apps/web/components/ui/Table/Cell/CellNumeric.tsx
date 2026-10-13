"use client";

import type { PropsWithChildren } from "react";

import { cn } from "@/lib/utils";

interface CellNumericProps {
  className?: string;
}

const CellNumeric = ({
  className,
  children,
}: PropsWithChildren<CellNumericProps>) => {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-2 whitespace-nowrap font-mono",
        className,
      )}
    >
      {children}
    </div>
  );
};

export default CellNumeric;
