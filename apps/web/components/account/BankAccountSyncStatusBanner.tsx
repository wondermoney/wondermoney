"use client";

import { CircleX, FileUp, Landmark, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/Alert";
import { Button } from "@/components/ui/button";

interface BankAccountSyncStatusBannerProps {
  csvRequiresAccount?: boolean;
  onRetryBankConnection?: () => void;
  onAddAccountManually?: () => void;
  onImportStatement?: () => void;
}

/**
 * Shown on the page a bank connection started from when it came back
 * without one (`?bankConnection=error`), with the other ways to add the
 * account.
 */
export default function BankAccountSyncStatusBanner({
  csvRequiresAccount = false,
  onRetryBankConnection,
  onAddAccountManually,
  onImportStatement,
}: BankAccountSyncStatusBannerProps) {
  const t = useTranslations();

  return (
    <Alert variant="destructive" className="gap-0">
      <CircleX className="size-4" aria-hidden="true" />
      <div className="space-y-3">
        <div>
          <AlertTitle className="text-foreground">
            {t("bank-sync-failed-title")}
          </AlertTitle>
          <AlertDescription className="text-muted-foreground text-sm">
            <p>{t("bank-sync-cancelled-description")}</p>
          </AlertDescription>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {onRetryBankConnection ? (
            <Button
              type="button"
              className="h-11"
              onClick={onRetryBankConnection}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              {t("bank-recovery-retry")}
            </Button>
          ) : null}
          {onAddAccountManually ? (
            <Button
              type="button"
              variant="secondary"
              className="h-11"
              onClick={onAddAccountManually}
            >
              <Landmark className="size-4" aria-hidden="true" />
              {t("bank-recovery-add-manually")}
            </Button>
          ) : null}
          {onImportStatement ? (
            <Button
              type="button"
              variant="ghost"
              className="h-11"
              onClick={onImportStatement}
            >
              <FileUp className="size-4" aria-hidden="true" />
              {t("bank-recovery-import-statement")}
            </Button>
          ) : null}
        </div>

        {onImportStatement && csvRequiresAccount ? (
          <p className="text-muted-foreground text-xs">
            {t("bank-recovery-csv-prerequisite")}
          </p>
        ) : null}
      </div>
    </Alert>
  );
}
