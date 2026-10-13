"use client";

import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

type Props = {
  value: number;
  label: string;
  className?: string;
};

export default function LoanProgressIndicator({
  value,
  label,
  className,
}: Props) {
  const capped = Math.max(0, Math.min(100, value));

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Progress value={capped} className="h-2 flex-1 rounded" />
      <span className="text-muted-foreground min-w-16 text-right text-xs">
        {label}
      </span>
    </div>
  );
}
