import { Badge } from "@/components/ui/badge";
import type { GoalStatus, GoalSummaryStatus } from "@/lib/api/goals/types";

type Status = GoalStatus | GoalSummaryStatus;

export default function GoalStatusBadge({ label, status }: { label: string; status: Status }) {
  const variant = status === "behind" ? "destructive" : status === "funded" || status === "completed" || status === "on_track" ? "success" : status === "paused" || status === "archived" ? "muted" : "outline";

  return <Badge variant={variant}>{label}</Badge>;
}
