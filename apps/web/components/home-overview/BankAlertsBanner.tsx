"use client";

import { Landmark, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/Alert";
import { Link } from "@/i18n/navigation";
import useBankingAlerts, {
  type BankingAlert,
} from "@/lib/api/banking/useBankingAlerts";
import { formatShortDateForLocale } from "@/lib/utils/formatDate";
import { useLocalStorageItem } from "@/lib/utils/useLocalStorageItem";

import {
  BANK_ALERTS_DISMISSED_KEY,
  nextDismissedBankAlertIds,
  parseDismissedBankAlertIds,
  pickVisibleBankAlerts,
} from "./bank-alerts";

function useAlertMessage() {
  const t = useTranslations("homeOverview.bank-alerts");
  const locale = useLocale();

  return (alert: BankingAlert) => {
    const bank = alert.institutionName?.trim() || t("unknown-bank");
    switch (alert.kind) {
      case "consent_expiring":
        return t("consent-expiring", {
          bank,
          days: Math.max(0, alert.daysUntilExpiry ?? 0),
        });
      case "consent_revoked":
        return t("consent-revoked", { bank });
      case "sync_failing":
      default:
        return alert.failingSince
          ? t("sync-failing", {
              bank,
              date: formatShortDateForLocale(alert.failingSince, locale),
            })
          : t("sync-failing-no-date", { bank });
    }
  };
}

/**
 * One calm banner for the bank connections that need attention: the most
 * urgent alert in words, a count of the rest, a way to reconnect and a way to
 * dismiss. Dismissing hides every alert it covers, by id, so the next stage of
 * the same connection (a new id) shows again. Renders nothing while loading,
 * on error, or with nothing to say.
 */
export function BankAlertsBanner() {
  const t = useTranslations("homeOverview.bank-alerts");
  const message = useAlertMessage();
  const { data } = useBankingAlerts();
  const storedRaw = useLocalStorageItem(BANK_ALERTS_DISMISSED_KEY);
  // Same-tab writes fire no `storage` event, and blocked storage keeps
  // nothing: this keeps a dismissal in effect for the rest of the visit.
  const [dismissedThisVisit, setDismissedThisVisit] = useState<string[]>([]);

  const storedIds = useMemo(
    () => parseDismissedBankAlertIds(storedRaw),
    [storedRaw],
  );
  const alerts = data?.alerts;
  const visible = useMemo(
    () =>
      pickVisibleBankAlerts(
        alerts ?? [],
        new Set([...storedIds, ...dismissedThisVisit]),
      ),
    [alerts, storedIds, dismissedThisVisit],
  );

  const [first, ...rest] = visible;
  if (!first) return null;

  const dismiss = () => {
    const ids = visible.map((alert) => alert.id);
    setDismissedThisVisit((previous) => [...previous, ...ids]);
    try {
      window.localStorage.setItem(
        BANK_ALERTS_DISMISSED_KEY,
        JSON.stringify(
          nextDismissedBankAlertIds(
            storedIds,
            ids,
            (alerts ?? []).map((alert) => alert.id),
          ),
        ),
      );
    } catch {
      // Blocked storage: the dismissal still holds for this visit.
    }
  };

  return (
    <Alert
      role="status"
      aria-label={t("label")}
      className="pr-14"
    >
      <Landmark className="size-4" aria-hidden="true" />
      <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>
          {message(first)}
          {rest.length > 0 ? (
            <span className="text-muted-foreground">
              {" "}
              {t("more", { count: rest.length })}
            </span>
          ) : null}
        </span>
        <Link
          href="/settings?tab=connections"
          className="text-primary font-medium underline-offset-4 hover:underline focus-visible:underline"
        >
          {t("reconnect")}
        </Link>
      </AlertDescription>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("dismiss")}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute top-1 right-1 inline-flex size-11 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </Alert>
  );
}
