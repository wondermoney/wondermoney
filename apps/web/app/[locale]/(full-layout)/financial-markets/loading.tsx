import { CardGridSkeleton, PageHeaderSkeleton } from "@/components/ui/PageSkeleton";

/** § 9 — the watchlist renders as a card grid. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeaderSkeleton />
      <CardGridSkeleton count={4} />
    </div>
  );
}
