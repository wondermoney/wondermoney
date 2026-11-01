"use client";

import { Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PreviewBadge } from "@/components/ui/PreviewBadge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  formatCurrencyForLocale,
  formatCurrencyForScreenReader,
  normalizeFinancialLocale,
} from "@/lib/utils/formatCurrency";

import { RecurringStatusBadge } from "./RecurringStatusBadge";

interface RecurringNoAccountsEmptyStateProps {
  onAddAccount: () => void;
  referenceTime: number;
}

interface RecurringPaymentsPreviewProps {
  className?: string;
  currencyCode?: string;
  referenceTime: number;
}

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

const sampleRecurringItemDefinitions = [
  {
    amount: 15.99,
    confidenceScore: 96,
    dueAfterDays: 7,
    merchantKey: "netflix",
    status: "candidate" as const,
    type: "subscription" as const,
  },
  {
    amount: 29.99,
    confidenceScore: 100,
    dueAfterDays: 14,
    merchantKey: "adobe",
    status: "confirmed" as const,
    type: "subscription" as const,
  },
  {
    amount: 34,
    confidenceScore: 78,
    dueAfterDays: 21,
    merchantKey: "lisbonGym",
    status: "candidate" as const,
    type: "bill" as const,
  },
] as const;

function AccessiblePreviewAmount({
  amount,
  currencyCode,
  locale,
  className,
}: {
  amount: number;
  className?: string;
  currencyCode: string;
  locale: string;
}) {
  return (
    <span className={className}>
      <span className="sr-only">
        {formatCurrencyForScreenReader(amount, currencyCode, locale)}
      </span>
      <span aria-hidden="true">
        {formatCurrencyForLocale(amount, currencyCode, locale)}
      </span>
    </span>
  );
}

export function RecurringPaymentsPreview({
  className,
  currencyCode = "EUR",
  referenceTime,
}: RecurringPaymentsPreviewProps) {
  const routeLocale = useLocale();
  const locale = normalizeFinancialLocale(routeLocale) ?? routeLocale;
  const t = useTranslations("recurring");
  const tCommon = useTranslations();
  const typeLabels = {
    bill: t("bill"),
    subscription: t("subscription"),
  } as const;
  const statusLabels = {
    confirmed: t("confirmed"),
    detected: t("detected"),
    dismissed: t("dismissed"),
    ended: t("ended"),
    needsReview: t("needsReview"),
    paused: t("paused"),
  } as const;
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const sampleRecurringItems = sampleRecurringItemDefinitions.map((item) => ({
    ...item,
    due: new Date(referenceTime + item.dueAfterDays * DAY_IN_MILLISECONDS),
  }));
  const monthlyImpact = sampleRecurringItems.reduce(
    (total, item) => total + item.amount,
    0,
  );

  return (
    <Card
      className={cn(
        "border-border bg-card overflow-hidden opacity-90 shadow-none",
        className,
      )}
    >
      <CardContent className="p-0">
        <div className="border-border bg-muted/30 flex items-center justify-between border-b px-4 py-3">
          <span className="text-foreground text-sm font-medium">
            {t("title")}
          </span>
          <PreviewBadge />
        </div>

        <div className="space-y-4 p-4 md:p-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="bg-muted rounded-lg p-4">
              <div className="text-muted-foreground text-xs tracking-wide">
                {t("noAccountsPreviewMonthlyImpact")}
              </div>
              <AccessiblePreviewAmount
                amount={monthlyImpact}
                currencyCode={currencyCode}
                locale={locale}
                className="text-foreground mt-2 block font-mono text-2xl font-semibold tracking-tight tabular-nums"
              />
            </div>

            <div className="bg-muted rounded-lg p-4">
              <div className="text-muted-foreground text-xs tracking-wide">
                {t("noAccountsPreviewNeedsReview")}
              </div>
              <div className="mt-2 flex items-end justify-between gap-3">
                <div className="text-foreground font-mono text-2xl font-semibold tracking-tight tabular-nums">
                  1
                </div>
                <Badge
                  variant="outline"
                  className="border-warning-text/30 text-warning-text"
                >
                  {t("needsReview")}
                </Badge>
              </div>
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="text-muted-foreground text-xs font-medium tracking-wide">
              {t("noAccountsPreviewUpcoming")}
            </div>

            <ul className="space-y-2">
              {sampleRecurringItems.map((item) => {
                const merchant = t(`sampleMerchants.${item.merchantKey}`);

                return (
                  <li key={item.merchantKey}>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="bg-muted/60 hover:bg-muted focus-visible:ring-ring flex min-h-11 w-full items-center justify-between gap-4 rounded-lg px-3 py-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
                          aria-label={t("previewItemAriaLabel", { merchant })}
                        >
                          <div className="min-w-0 space-y-1">
                            <div className="text-foreground truncate font-medium">
                              {merchant}
                            </div>
                            <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                              <span>{typeLabels[item.type]}</span>
                              <span
                                aria-hidden="true"
                                className="bg-border h-3 w-px shrink-0"
                              />
                              <span>{dateFormatter.format(item.due)}</span>
                            </div>
                          </div>

                          <div className="flex flex-col items-end gap-1">
                            <RecurringStatusBadge
                              status={item.status}
                              confidenceScore={item.confidenceScore}
                              labels={statusLabels}
                            />
                            <AccessiblePreviewAmount
                              amount={item.amount}
                              currencyCode={currencyCode}
                              locale={locale}
                              className="text-foreground font-mono text-sm font-semibold tracking-tight tabular-nums"
                            />
                          </div>
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="text-sm">
                        <p className="font-medium">{tCommon("preview")}</p>
                        <p className="text-muted-foreground mt-1">
                          {t("previewItemDescription")}
                        </p>
                      </PopoverContent>
                    </Popover>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function RecurringNoAccountsEmptyState({
  onAddAccount,
  referenceTime,
}: RecurringNoAccountsEmptyStateProps) {
  const t = useTranslations("recurring");

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-2">
        <h2 className="text-foreground text-xl font-semibold tracking-tight">
          {t("noAccountsTitle")}
        </h2>
        <p className="text-muted-foreground max-w-2xl text-sm leading-6">
          {t("noAccountsDescription")}
        </p>
      </div>

      <RecurringPaymentsPreview
        currencyCode="EUR"
        referenceTime={referenceTime}
      />

      <div>
        <Button size="lg" className="gap-2" onClick={onAddAccount}>
          <Plus className="size-4" />
          {t("noAccountsAddAccount")}
        </Button>
      </div>
    </div>
  );
}
