import { PageHeaderSkeleton, StatCardsSkeleton, TableSkeleton } from "@/components/ui/PageSkeleton";

/** § 9 — five summary cards over the loans table. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeaderSkeleton />
      <StatCardsSkeleton count={5} />
      <TableSkeleton rows={6} columns={6} />
    </div>
  );
}
