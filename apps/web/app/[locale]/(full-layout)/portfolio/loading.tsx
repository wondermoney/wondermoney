import {
  CardGridSkeleton,
  PageHeaderSkeleton,
  StatCardsSkeleton,
} from "@/components/ui/PageSkeleton";

/** § 9 — summary cards over the portfolio grid, not a centred spinner. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeaderSkeleton />
      <StatCardsSkeleton count={3} />
      <CardGridSkeleton count={4} />
    </div>
  );
}
