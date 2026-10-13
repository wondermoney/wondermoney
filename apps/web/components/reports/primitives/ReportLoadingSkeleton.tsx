import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface ReportLoadingSkeletonProps {
  kind?: "bar" | "line" | "area-line" | "table" | "stat" | "sankey";
  className?: string;
}

export function ReportLoadingSkeleton({
  kind = "bar",
  className,
}: ReportLoadingSkeletonProps) {
  if (kind === "stat") {
    return (
      <div className={cn("space-y-4 p-6", className)}>
        <div className="flex items-end justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-8 w-48" />
          </div>
          <Skeleton className="h-8 w-24" />
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      </div>
    );
  }

  if (kind === "line" || kind === "area-line") {
    return (
      <div className={cn("space-y-4 p-6", className)}>
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className={cn("w-full", kind === "area-line" ? "h-80" : "h-64")} />
      </div>
    );
  }

  if (kind === "table") {
    return (
      <div className={cn("space-y-3 p-6", className)}>
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-8 w-24" />
        </div>
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  if (kind === "sankey") {
    return (
      <div className={cn("space-y-4 p-6", className)}>
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="flex h-80 items-center justify-between gap-4">
          {/* Income column */}
          <div className="flex h-full flex-col justify-around gap-4">
            <Skeleton className="h-16 w-28 rounded-lg" />
            <Skeleton className="h-12 w-28 rounded-lg" />
            <Skeleton className="h-14 w-28 rounded-lg" />
          </div>
          {/* Link stubs */}
          <div className="flex h-full flex-1 flex-col justify-center gap-3">
            <Skeleton className="h-2 w-full" />
            <Skeleton className="h-2 w-5/6" />
            <Skeleton className="h-2 w-4/5" />
            <Skeleton className="h-2 w-3/4" />
            <Skeleton className="h-2 w-5/6" />
          </div>
          {/* Category column */}
          <div className="flex h-full flex-col justify-around gap-4">
            <Skeleton className="h-12 w-28 rounded-lg" />
            <Skeleton className="h-16 w-28 rounded-lg" />
            <Skeleton className="h-10 w-28 rounded-lg" />
            <Skeleton className="h-14 w-28 rounded-lg" />
          </div>
          {/* Link stubs */}
          <div className="flex h-full flex-1 flex-col justify-center gap-3">
            <Skeleton className="h-2 w-full" />
            <Skeleton className="h-2 w-4/5" />
            <Skeleton className="h-2 w-5/6" />
            <Skeleton className="h-2 w-3/4" />
          </div>
          {/* Account column */}
          <div className="flex h-full flex-col justify-around gap-4">
            <Skeleton className="h-14 w-28 rounded-lg" />
            <Skeleton className="h-12 w-28 rounded-lg" />
            <Skeleton className="h-16 w-28 rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-4 p-6", className)}>
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-24" />
      </div>
      <Skeleton className="h-48 w-full" />
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    </div>
  );
}
