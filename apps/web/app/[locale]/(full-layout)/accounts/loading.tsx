import {
  PageHeaderSkeleton,
  StatCardsSkeleton,
  TableSkeleton,
} from "@/components/ui/PageSkeleton";

/**
 * DESIGN.md § 9 — a skeleton shaped like the page, not a spinner.
 *
 * This was a centred `<Spinner />`, which says only that something is
 * happening and then reflows the whole page when it stops. The metrics cards
 * and the accounts list have known proportions; reserving them means nothing
 * moves when the data lands.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeaderSkeleton />
      <StatCardsSkeleton count={4} />
      <TableSkeleton rows={5} columns={3} />
    </div>
  );
}
