import { CardGridSkeleton, PageHeaderSkeleton, StatCardsSkeleton } from "@/components/ui/PageSkeleton";

/** § 9 — three summary cards over a grid of goal cards. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeaderSkeleton />
      <StatCardsSkeleton count={3} />
      <CardGridSkeleton count={6} />
    </div>
  );
}
