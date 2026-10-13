import { CardGridSkeleton, PageHeaderSkeleton } from "@/components/ui/PageSkeleton";

/** § 9 — the filters bar sits above a stack of report cards. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeaderSkeleton />
      <CardGridSkeleton count={4} />
    </div>
  );
}
