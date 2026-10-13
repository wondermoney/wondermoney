"use client";

import { formatDistanceToNow } from "date-fns";
import { AlertCircle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import type { Account } from "@/lib/api/account/useAccounts";
import { cn } from "@/lib/utils";
import { getDateFnsLocale } from "@/lib/utils/dateFnsLocale";

/**
 * How fresh is everything on this screen? — DESIGN.md § 9 rule 6.
 *
 * `AccountSyncBadge` answers that for one account. A transactions list is fed by
 * *several*, and the honest answer for the set is the **weakest link**: if one
 * account last synced three days ago, the list is missing three days of its
 * spending, and reporting the freshest account's time would actively mislead.
 *
 * So this reports the oldest sync among the accounts that actually sync, and
 * lets an error outrank a timestamp — "some connections need attention" is more
 * useful than "updated 4 hours ago" when the reason it is 4 hours is that it
 * broke.
 *
 * Reuses the existing `provenance-*` keys, which already say exactly this in all
 * three locales, rather than adding a fourth phrasing of the same sentence.
 *
 * Manual accounts are excluded rather than counted as infinitely stale: they
 * have no `refreshedAt` because nothing syncs them, and a manual-only user
 * should see nothing here rather than a permanent staleness warning.
 */
export default function AccountsFreshness({
  accounts,
  className,
}: {
  accounts: Account[] | undefined;
  className?: string;
}) {
  const t = useTranslations();
  const locale = useLocale();

  const synced = (accounts ?? []).filter(
    (account) => account.syncStatus !== null || account.refreshedAt !== null,
  );
  if (synced.length === 0) return null;

  const hasError = synced.some(
    (account) => account.syncStatus?.staleness === "error",
  );
  if (hasError) {
    return (
      <span
        className={cn(
          "text-destructive-text inline-flex items-center gap-1.5 text-xs font-medium",
          className,
        )}
      >
        <AlertCircle className="size-3" aria-hidden />
        {t("provenance-balances-stale")}
      </span>
    );
  }

  const timestamps = synced
    .map((account) => account.syncStatus?.lastSyncedAt ?? account.refreshedAt)
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));

  if (timestamps.length === 0) return null;

  const oldest = new Date(Math.min(...timestamps));

  return (
    <span className={cn("text-muted-foreground text-xs", className)}>
      {t("provenance-balances-updated", {
        time: formatDistanceToNow(oldest, {
          addSuffix: true,
          locale: getDateFnsLocale(locale),
        }),
      })}
    </span>
  );
}
