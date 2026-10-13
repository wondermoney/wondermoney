import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import type { RecurringStatus } from "@/lib/api/recurring/useRecurringItems";
import { cn } from "@/lib/utils";

export interface RecurringStatusBadgeLabels {
  confirmed: ReactNode;
  detected: ReactNode;
  needsReview: ReactNode;
  paused: ReactNode;
  ended: ReactNode;
  dismissed: ReactNode;
}

export interface RecurringStatusBadgeProps {
  status: RecurringStatus;
  confidenceScore?: number | null;
  labels: RecurringStatusBadgeLabels;
  className?: string;
}

const statusStyles: Record<
  "confirmed" | "detected" | "needsReview" | "paused" | "ended" | "dismissed",
  string
> = {
  /*
   * § 9 observation 1 — the accent footprint. The reference spends its accent on
   * seven interactive things: active nav item, primary button, active tab
   * underline, focused segmented control, drawer's primary action, inline links,
   * leading chart series. A status badge is none of them, and the restraint is
   * most of what reads as "Stripe" — more than the hue is.
   *
   * These two were the only statuses in this map wearing it; the other four
   * already used neutral or semantic tokens. `confirmed` keeps foreground ink so
   * it still outranks the muted states; `detected` is provisional and sits with
   * them. Deliberately not `success-text`: § 2 keeps green and red for strict
   * financial meaning, and a confirmed subscription is not a gain.
   */
  confirmed: "border-border bg-muted text-foreground dark:border-border/70",
  detected:
    "border-border bg-muted text-muted-foreground dark:border-border/70 dark:bg-muted/80",
  needsReview: "border-warning-text/30 text-warning-text",
  paused:
    "border-border bg-muted text-muted-foreground dark:border-border/70 dark:bg-muted/80",
  ended:
    "border-border bg-muted text-muted-foreground dark:border-border/70 dark:bg-muted/80",
  dismissed:
    "border-border bg-muted text-muted-foreground dark:border-border/70 dark:bg-muted/80",
};

export function RecurringStatusBadge({
  status,
  confidenceScore,
  labels,
  className,
}: RecurringStatusBadgeProps) {
  const tone:
    | "confirmed"
    | "detected"
    | "needsReview"
    | "paused"
    | "ended"
    | "dismissed" =
    status === "confirmed"
      ? "confirmed"
      : status === "candidate"
        ? (confidenceScore ?? 0) >= 90
          ? "detected"
          : "needsReview"
        : status;

  const label =
    tone === "confirmed"
      ? labels.confirmed
      : tone === "detected"
        ? labels.detected
        : tone === "needsReview"
          ? labels.needsReview
          : tone === "paused"
            ? labels.paused
            : tone === "ended"
              ? labels.ended
              : labels.dismissed;

  return (
    <Badge
      variant="outline"
      className={cn(
        "border text-xs font-medium",
        statusStyles[tone],
        className,
      )}
    >
      {label}
    </Badge>
  );
}
