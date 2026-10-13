import { PageHeaderSkeleton, TableSkeleton } from "@/components/ui/PageSkeleton";

/** § 9 — a skeleton shaped like the budgets table, not a centred spinner. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeaderSkeleton />
      <TableSkeleton rows={8} columns={5} />
    </div>
  );
}
