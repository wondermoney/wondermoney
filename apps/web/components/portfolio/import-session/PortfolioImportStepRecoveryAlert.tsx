"use client";

import { useTranslations } from "next-intl";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/Alert";
import { Button } from "@/components/ui/button";

interface PortfolioImportStepRecoveryAlertProps {
  descriptionKey: string;
  onDiscard?: () => void;
  onRetry: () => void;
  primaryActionKey: string;
  secondaryActionKey?: string;
  titleKey: string;
  variant?: "default" | "warning" | "destructive";
}

export function PortfolioImportStepRecoveryAlert({
  descriptionKey,
  onDiscard,
  onRetry,
  primaryActionKey,
  secondaryActionKey,
  titleKey,
  variant = "destructive",
}: PortfolioImportStepRecoveryAlertProps) {
  const t = useTranslations();

  return (
    <Alert variant={variant === "warning" ? "warning" : variant === "destructive" ? "destructive" : undefined}>
      <AlertTitle>{t(titleKey)}</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <span>{t(descriptionKey)}</span>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button type="button" onClick={onRetry}>
            {t(primaryActionKey)}
          </Button>
          {onDiscard && secondaryActionKey ? (
            <Button type="button" variant="secondary" onClick={onDiscard}>
              {t(secondaryActionKey)}
            </Button>
          ) : null}
        </div>
      </AlertDescription>
    </Alert>
  );
}
