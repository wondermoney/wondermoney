"use client";

import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import { RecurringPaymentsPreview } from "./RecurringNoAccountsEmptyState";

type Props = {
  currencyCode: string;
  hasScanned: boolean;
  isScanning: boolean;
  onScan: () => void;
  referenceTime: number;
};

export function RecurringDetectionEmptyState({
  currencyCode,
  hasScanned,
  isScanning,
  onScan,
  referenceTime,
}: Props) {
  const t = useTranslations("recurring");

  return (
    <div className="flex flex-col items-start gap-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold tracking-tight">
          {t("emptyTitle")}
        </h2>
        <p className="text-muted-foreground max-w-2xl text-sm leading-6">
          {hasScanned ? t("emptyScannedDescription") : t("emptyDescription")}
        </p>
      </div>

      {hasScanned ? (
        <Card className="border-dashed shadow-none">
          <CardContent className="text-muted-foreground p-6 text-sm">
            {t("upcomingEmpty")}
          </CardContent>
        </Card>
      ) : (
        <RecurringPaymentsPreview
          className="w-full"
          currencyCode={currencyCode}
          referenceTime={referenceTime}
        />
      )}

      <Button
        type="button"
        className="min-h-11 gap-2"
        onClick={onScan}
        disabled={isScanning}
      >
        <RefreshCw
          className={
            isScanning
              ? "size-4 animate-spin motion-reduce:animate-none"
              : "size-4"
          }
          aria-hidden="true"
        />
        {isScanning
          ? t("detecting")
          : hasScanned
            ? t("scanAgain")
            : t("detectRecurring")}
      </Button>
    </div>
  );
}
