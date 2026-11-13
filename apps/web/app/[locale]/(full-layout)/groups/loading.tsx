import {
  PageHeaderSkeleton,
  TableSkeleton,
} from "@/components/ui/PageSkeleton";

/** The groups list: a header over one list of groups. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeaderSkeleton />
      <TableSkeleton rows={4} columns={2} />
    </div>
  );
}
