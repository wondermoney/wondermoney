import { type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface ReportEmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  cta?: React.ReactNode;
  className?: string;
}

export function ReportEmptyState({
  icon: Icon,
  title,
  description,
  cta,
  className,
}: ReportEmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-10 text-center",
        className,
      )}
    >
      <Icon className="text-muted-foreground size-10" strokeWidth={1.5} />
      <div className="flex max-w-xs flex-col gap-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
      {cta ? <div className="mt-1">{cta}</div> : null}
    </div>
  );
}
