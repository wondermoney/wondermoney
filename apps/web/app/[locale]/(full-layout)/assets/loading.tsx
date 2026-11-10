import {
  PageHeaderSkeleton,
  StatCardsSkeleton,
  TableSkeleton,
} from "@/components/ui/PageSkeleton";

/** § 9 — two summary cards over the assets table. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeaderSkeleton />
      <StatCardsSkeleton count={2} />
      <TableSkeleton rows={4} columns={3} />
    </div>
  );
}
