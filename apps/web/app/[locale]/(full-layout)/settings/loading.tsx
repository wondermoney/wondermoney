import { CardGridSkeleton, PageHeaderSkeleton } from "@/components/ui/PageSkeleton";

/** § 9 — a tab strip over one settings panel. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeaderSkeleton />
      <CardGridSkeleton count={1} />
    </div>
  );
}
