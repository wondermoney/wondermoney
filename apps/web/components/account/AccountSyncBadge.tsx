"use client";

import { formatDistanceToNow } from "date-fns";
import { AlertCircle, RefreshCw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import type { SyncStatus } from "@/lib/api/account/useAccounts";
import { cn } from "@/lib/utils";
import { getDateFnsLocale } from "@/lib/utils/dateFnsLocale";

import { clampSyncedAt } from "./sync-time";
/**
 * Sync freshness signal for an open-banking account. Surfaces staleness so a missing
 * charge does not "look exactly like a quiet spending day": fresh is quiet, stale/very_stale nudge
 * with a relative time, and an open incident shows a clear "Reconnect needed".
 */
export default function AccountSyncBadge({
  syncStatus,
  refreshedAt,
  className,
}: {
  syncStatus: SyncStatus | null;
  refreshedAt: string | null;
  className?: string;
}) {
  const t = useTranslations();
  const locale = useLocale();

  // Fall back to the legacy refreshedAt-only display when no structured status is present.
  const staleness = syncStatus?.staleness ?? "fresh";
  const lastSyncedAt = clampSyncedAt(
    syncStatus?.lastSyncedAt ?? refreshedAt,
  );

  if (staleness === "error") {
    return (
      <span
        className={cn(
          "text-destructive-text inline-flex items-center gap-1 text-xs font-medium",
          className,
        )}
      >
        <AlertCircle className="h-2.5 w-2.5" aria-hidden />
        {t("account-sync-reconnect")}
      </span>
    );
  }

  if (!lastSyncedAt) {
    if (staleness === "fresh") return null;
    return (
      <span
        className={cn(
          "text-muted-foreground inline-flex items-center gap-1 text-xs",
          className,
        )}
      >
        <RefreshCw className="h-2.5 w-2.5" aria-hidden />
        {t("account-sync-never")}
      </span>
    );
  }

  const isStale = staleness === "stale" || staleness === "very_stale";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs",
        isStale ? "text-warning-text font-medium" : "text-muted-foreground",
        className,
      )}
    >
      <RefreshCw className="h-2.5 w-2.5" aria-hidden />
      {formatDistanceToNow(new Date(lastSyncedAt), {
        addSuffix: true,
        locale: getDateFnsLocale(locale),
      })}
    </span>
  );
}
