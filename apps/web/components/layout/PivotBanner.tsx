"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Alert, AlertDescription } from "@/components/ui/Alert";
import { Link } from "@/components/ui/Link";
import { instanceConfig } from "@/lib/instance";
import { useDismissibleActivation } from "@/lib/utils/useDismissibleActivation";

/**
 * Announces the BYOK pivot on every route, logged in or out. Dismissal is
 * sticky for the same window `useDismissibleActivation` already gives
 * SetupChecklistCard — see that hook for the storage/expiry mechanics.
 *
 * The news is the hosted service's, so it shows only where the deploy turns it
 * on (`NEXT_PUBLIC_SHOW_PIVOT_BANNER`); a self-hosted instance never sees it.
 */
export default function PivotBanner({
  enabled = instanceConfig.showPivotBanner,
}: {
  enabled?: boolean;
}) {
  const t = useTranslations("pivotBanner");
  const { isDismissed, dismiss } = useDismissibleActivation(
    "pivot-announcement",
  );

  if (!enabled || isDismissed) return null;

  return (
    <Alert
      variant="info"
      className="relative flex items-center gap-3 rounded-none border-x-0 border-t-0 pr-12"
    >
      <AlertDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>{t("message")}</span>
        <Link href="/faq" className="font-medium underline underline-offset-4">
          {t("cta")}
        </Link>
      </AlertDescription>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("dismiss")}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute top-1/2 right-2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </Alert>
  );
}
