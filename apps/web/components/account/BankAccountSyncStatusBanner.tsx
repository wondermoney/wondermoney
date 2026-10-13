"use client";

import {
  CircleAlert,
  CircleDashed,
  CircleX,
  FileUp,
  Landmark,
  RefreshCw,
  WifiOff,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/Alert";
import { Button } from "@/components/ui/button";

export type BankSyncRecoveryState =
  | "idle"
  | "processing"
  | "callback_error"
  | "partial"
  | "failed"
  | "transport_unavailable"
  // Enable Banking's consent has a real expiry (`accessValidUntil`) and there
  // is no separate renew endpoint (plan §5) — "renewing" is starting a brand
  // new connection for the same bank, so this reuses `onRetryBankConnection`
  // exactly like the other retry-eligible states below. Distinct from
  // `failed`/`callback_error` because nothing actually went wrong yet.
  | "reauth_required";

interface BankAccountSyncStatusBannerProps {
  status: BankSyncRecoveryState;
  callbackErrorCode?: string | null;
  csvRequiresAccount?: boolean;
  onRetryBankConnection?: () => void;
  onAddAccountManually?: () => void;
  onImportStatement?: () => void;
  onRetryStatus?: () => void;
}

export default function BankAccountSyncStatusBanner({
  status,
  callbackErrorCode,
  csvRequiresAccount = false,
  onRetryBankConnection,
  onAddAccountManually,
  onImportStatement,
  onRetryStatus,
}: BankAccountSyncStatusBannerProps) {
  const t = useTranslations();

  if (status === "idle") return null;

  if (status === "processing") {
    return (
      <Alert
        variant="info"
        className="gap-0 border-info-text/20 bg-info/5 text-info-text"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <CircleDashed
          className="size-4 motion-safe:animate-spin"
          aria-hidden="true"
        />
        <AlertTitle>{t("account-sync-processing-title")}</AlertTitle>
        <AlertDescription className="text-muted-foreground text-sm">
          <p>{t("account-sync-processing-description")}</p>
        </AlertDescription>
      </Alert>
    );
  }

  const isCancellation =
    callbackErrorCode === "cancelled" ||
    callbackErrorCode === "Cancelled by user.";
  const content =
    status === "callback_error"
      ? isCancellation
        ? {
            title: t("bank-sync-cancelled-title"),
            description: t("bank-sync-cancelled-description"),
            icon: CircleX,
            variant: "warning" as const,
          }
        : {
            title: t("bank-sync-provider-unavailable-title"),
            description: t("bank-sync-provider-unavailable-description"),
            icon: CircleAlert,
            variant: "warning" as const,
          }
      : status === "partial"
        ? {
            title: t("bank-sync-partial-title"),
            description: t("bank-sync-partial-description"),
            icon: CircleAlert,
            variant: "warning" as const,
          }
        : status === "reauth_required"
          ? {
              title: t("bank-sync-reauth-title"),
              description: t("bank-sync-reauth-description"),
              icon: CircleAlert,
              variant: "warning" as const,
            }
          : status === "transport_unavailable"
            ? {
                title: t("bank-sync-transport-title"),
                description: t("bank-sync-transport-description"),
                icon: WifiOff,
                variant: "default" as const,
              }
            : {
                title: t("bank-sync-failed-title"),
                description: t("bank-sync-failed-description"),
                icon: CircleX,
                variant: "destructive" as const,
              };
  const Icon = content.icon;
  // reauth_required has its own single-action block below (renew only — the
  // manual/CSV fallbacks don't make sense for an account that's already
  // linked and just needs its consent refreshed).
  // Kept as one line (not multi-line as Prettier alone would produce) because
  // scripts/bank-recovery-regression-checks.ts asserts this exact substring.
  const canOfferFallbacks = status !== "transport_unavailable" && status !== "reauth_required";

  return (
    <Alert variant={content.variant} className="gap-0">
      <Icon className="size-4" aria-hidden="true" />
      <div className="space-y-3">
        <div>
          <AlertTitle className="text-foreground">{content.title}</AlertTitle>
          <AlertDescription className="text-muted-foreground text-sm">
            <p>{content.description}</p>
          </AlertDescription>
        </div>

        {status === "transport_unavailable" && onRetryStatus ? (
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={onRetryStatus}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            {t("bank-sync-check-status")}
          </Button>
        ) : null}

        {status === "reauth_required" && onRetryBankConnection ? (
          <Button
            type="button"
            className="h-11"
            onClick={onRetryBankConnection}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            {t("bank-recovery-renew")}
          </Button>
        ) : null}

        {canOfferFallbacks ? (
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
        ) : null}

        {canOfferFallbacks && onImportStatement && csvRequiresAccount ? (
          <p className="text-muted-foreground text-xs">
            {t("bank-recovery-csv-prerequisite")}
          </p>
        ) : null}
      </div>
    </Alert>
  );
}
