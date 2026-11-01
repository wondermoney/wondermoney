"use client";

import { formatDistanceToNow } from "date-fns";
import { AlertCircle, RefreshCw } from "lucide-react";
import { useLocale } from "next-intl";

import { clampSyncedAt } from "@/components/account/sync-time";
import { cn } from "@/lib/utils";
import { getDateFnsLocale } from "@/lib/utils/dateFnsLocale";

/**
 * When this data is from, and what it covers.
 *
 * DESIGN.md § 9 rule 6. The reference labels every figure it shows — "Updated
 * 3:28 PM", "All time data", "4 of 24 results", "Up to date" — and no surface
 * in this app did. On a balance summed from bank connections that is a trust
 * question, not a polish one: a number with no "as of" invites the reader to
 * assume it is live, and a stale sync looks exactly like a fresh one.
 *
 * Renders nothing when there is nothing honest to say.
 */
export interface DataProvenanceProps {
  /** When the underlying data was last refreshed at source. */
  updatedAt?: Date | string | null;
  /** Overrides the default "Updated {time}" phrasing. Takes `{time}`. */
  label?: (relativeTime: string) => string;
  /** Marks the timestamp as stale — amber rather than muted. */
  isStale?: boolean;
  /** Marks a broken connection — destructive, with its own message. */
  errorLabel?: string;
  /** e.g. "4 of 24 results". Rendered after a separator. */
  scope?: string;
  className?: string;
}

export function DataProvenance({
  updatedAt,
  label,
  isStale = false,
  errorLabel,
  scope,
  className,
}: DataProvenanceProps) {
  const locale = useLocale();

  if (errorLabel) {
    return (
      <p
        className={cn(
          "text-destructive-text inline-flex items-center gap-1.5 text-xs font-medium",
          className,
        )}
      >
        <AlertCircle className="size-3 shrink-0" aria-hidden="true" />
        {errorLabel}
      </p>
    );
  }

  // A refresh time is always in the past; a future one (clock skew, a seeded
  // timestamp) would read "in almost 20 years", so it is clamped to now.
  const syncedAt = clampSyncedAt(updatedAt);
  const date =
    syncedAt instanceof Date
      ? syncedAt
      : syncedAt
        ? new Date(syncedAt)
        : null;
  const hasValidDate = date !== null && !Number.isNaN(date.getTime());

  if (!hasValidDate && !scope) return null;

  const relative = hasValidDate
    ? formatDistanceToNow(date, {
        addSuffix: true,
        locale: getDateFnsLocale(locale),
      })
    : null;

  return (
    <p
      className={cn(
        "inline-flex items-center gap-1.5 text-xs",
        isStale ? "text-warning-text font-medium" : "text-muted-foreground",
        className,
      )}
    >
      {relative ? (
        <>
          <RefreshCw className="size-3 shrink-0" aria-hidden="true" />
          <span>{label ? label(relative) : relative}</span>
        </>
      ) : null}
      {relative && scope ? <span aria-hidden="true">·</span> : null}
      {scope ? <span>{scope}</span> : null}
    </p>
  );
}

export default DataProvenance;
