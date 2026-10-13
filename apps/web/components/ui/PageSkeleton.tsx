import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Loading states shaped like the thing they replace.
 *
 * DESIGN.md § 9. The reference ships a skeleton carrying the *real*
 * proportions of the page behind it — column widths, row count, even the
 * banner — so nothing moves when the data lands. This app mostly showed a
 * centred `<Spinner />` in a `min-h-64` box, which tells you only that
 * something is happening and then reflows the entire page underneath you when
 * it stops.
 *
 * A skeleton that does not match its content is a layout shift with extra
 * steps, so these take the same shape arguments the real component does.
 */

/**
 * A page header: title block, and the action buttons that sit opposite it.
 *
 * Every skeleton needs this — a page whose title appears only once the data
 * lands still shifts everything below it, which is the reflow these exist to
 * prevent. Deliberately not a `description` line: § 9 observation 3 removed
 * those, so reserving space for one would be reserving space for nothing.
 */
export function PageHeaderSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("flex items-start justify-between gap-4", className)}
      aria-hidden="true"
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-3 w-32" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-9 w-32 rounded-md" />
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>
    </div>
  );
}

/** A data table: header row, then rows of the right height and column count. */
export function TableSkeleton({
  rows = 8,
  columns = 5,
  className,
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  // Deterministic widths per column index rather than random, so the skeleton
  // does not shimmer into a different shape on every render.
  const widths = ["w-24", "w-32", "w-28", "w-20", "w-16", "w-24", "w-20"];

  return (
    <div
      className={cn("border-border bg-card rounded-lg border", className)}
      aria-hidden="true"
    >
      <div className="border-border flex items-center gap-4 border-b px-4 py-3">
        {Array.from({ length: columns }).map((_, column) => (
          <Skeleton
            key={column}
            className={cn("h-3.5", widths[column % widths.length])}
          />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, row) => (
        <div
          key={row}
          className={cn(
            "flex items-center gap-4 px-4",
            // 53px, the measured height of a real transactions row, so the
            // page does not jump when the data arrives.
            "h-[53px]",
            row < rows - 1 && "border-border border-b",
          )}
        >
          {Array.from({ length: columns }).map((_, column) => (
            <Skeleton
              key={column}
              className={cn("h-4", widths[column % widths.length])}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** A row of stat cards — same grid and card height as `StatCardGrid`. */
export function StatCardsSkeleton({
  count = 3,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // Must track StatCardGrid exactly, or the loading state and the loaded
        // state have different geometry and the page jumps when data lands.
        "border-border divide-border grid grid-cols-1 divide-y overflow-hidden rounded-lg border",
        "sm:grid-cols-3 sm:divide-x sm:divide-y-0",
        className,
      )}
      aria-hidden="true"
    >
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="bg-card space-y-2 p-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-7 w-32" />
        </div>
      ))}
    </div>
  );
}

/** A list of cards — goals, portfolios, accounts. */
export function CardGridSkeleton({
  count = 6,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("grid gap-4 md:grid-cols-2 xl:grid-cols-3", className)}
      aria-hidden="true"
    >
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="border-border bg-card space-y-4 rounded-lg border p-5"
        >
          <div className="flex items-start justify-between gap-4">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-6 w-20" />
          </div>
          <Skeleton className="h-2 w-full rounded-full" />
          <div className="flex items-center justify-between">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-10" />
          </div>
        </div>
      ))}
    </div>
  );
}
