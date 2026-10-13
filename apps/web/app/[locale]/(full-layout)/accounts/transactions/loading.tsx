import { PageHeaderSkeleton, TableSkeleton } from "@/components/ui/PageSkeleton";

/**
 * DESIGN.md § 9 — a skeleton shaped like the page behind it.
 *
 * Seven columns, matching the transactions table after the § 9 rule 10
 * restructure, so nothing jumps sideways when the rows land.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeaderSkeleton />
      <TableSkeleton rows={10} columns={7} />
    </div>
  );
}
