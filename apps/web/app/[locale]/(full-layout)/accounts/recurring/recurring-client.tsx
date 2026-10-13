"use client";

import { RefreshCw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import AccountAddModal from "@/components/account/AccountCreateModal";
import AccountAddOfflineModal from "@/components/account/AccountCreateOfflineModal";
import AccountAddSyncModal from "@/components/account/AccountCreateSyncModal";
import { RecurringCategoryImpact } from "@/components/recurring/RecurringCategoryImpact";
import { RecurringDetectionEmptyState } from "@/components/recurring/RecurringDetectionEmptyState";
import { RecurringItemsTable } from "@/components/recurring/RecurringItemsTable";
import { RecurringNoAccountsEmptyState } from "@/components/recurring/RecurringNoAccountsEmptyState";
import { RecurringReviewQueue } from "@/components/recurring/RecurringReviewQueue";
import type { RecurringStatusBadgeLabels } from "@/components/recurring/RecurringStatusBadge";
import { RecurringSummaryCards } from "@/components/recurring/RecurringSummaryCards";
import { RecurringUpcomingTimeline } from "@/components/recurring/RecurringUpcomingTimeline";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Heading, Text } from "@/components/ui/Typography";
import type { GetAccountsResponse } from "@/lib/api/account/useAccounts";
import useAccounts from "@/lib/api/account/useAccounts";
import type { GetRecurringItemsResponse } from "@/lib/api/recurring/useRecurringItems";
import useRecurringItems from "@/lib/api/recurring/useRecurringItems";
import {
  useConfirmRecurring,
  useDetectRecurring,
  useDismissRecurring,
  useUpdateRecurring,
} from "@/lib/api/recurring/useRecurringMutations";
import type { GetRecurringSummaryResponse } from "@/lib/api/recurring/useRecurringSummary";
import useRecurringSummary from "@/lib/api/recurring/useRecurringSummary";
import { getCategoryTranslationKey } from "@/lib/utils/categories";
import {
  formatCurrencyForLocale,
  formatCurrencyForScreenReader,
  normalizeFinancialLocale,
} from "@/lib/utils/formatCurrency";

const isCurrencyCode = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Z]{3}$/.test(value);

type RecurringAction = "confirm" | "dismiss" | "restore";

const formatRelativeDate = (
  value: string,
  formatter: Intl.RelativeTimeFormat,
  now: number,
) => {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;

  const differenceInSeconds = Math.min(0, Math.round((timestamp - now) / 1000));
  if (Math.abs(differenceInSeconds) < 60) {
    return formatter.format(differenceInSeconds, "second");
  }

  const differenceInMinutes = Math.round(differenceInSeconds / 60);
  if (Math.abs(differenceInMinutes) < 60) {
    return formatter.format(differenceInMinutes, "minute");
  }

  const differenceInHours = Math.round(differenceInMinutes / 60);
  if (Math.abs(differenceInHours) < 24) {
    return formatter.format(differenceInHours, "hour");
  }

  return formatter.format(Math.round(differenceInHours / 24), "day");
};

interface RecurringClientProps {
  initialAccountsData: GetAccountsResponse;
  initialRecurringItemsData: GetRecurringItemsResponse;
  initialRecurringSummaryData: GetRecurringSummaryResponse;
  referenceTime: number;
}

const emptyStateCard = (message: string) => (
  <Card className="border-dashed shadow-none">
    <CardContent className="text-muted-foreground p-6 text-sm">
      {message}
    </CardContent>
  </Card>
);

export default function RecurringClient({
  initialAccountsData,
  initialRecurringItemsData,
  initialRecurringSummaryData,
  referenceTime,
}: RecurringClientProps) {
  const locale = useLocale();
  const financialLocale = normalizeFinancialLocale(locale) ?? locale;
  const t = useTranslations("recurring");
  const tCommon = useTranslations();
  const posthog = usePostHog();
  const [accountAddModalIsOpen, setAccountAddModalIsOpen] = useState(false);
  const [accountAddSyncModalIsOpen, setAccountAddSyncModalIsOpen] =
    useState(false);
  const [accountAddOfflineModalIsOpen, setAccountAddOfflineModalIsOpen] =
    useState(false);
  const relativeTimeFormatter = useMemo(
    () => new Intl.RelativeTimeFormat(financialLocale, { numeric: "auto" }),
    [financialLocale],
  );
  const [currentTime, setCurrentTime] = useState(referenceTime);

  useEffect(() => {
    const updateCurrentTime = () => setCurrentTime(Date.now());
    const interval = window.setInterval(updateCurrentTime, 60_000);
    document.addEventListener("visibilitychange", updateCurrentTime);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", updateCurrentTime);
    };
  }, []);

  const { data: accountsData } = useAccounts({
    initialData: initialAccountsData,
  });

  const { data: recurringItemsData } = useRecurringItems({
    initialData: initialRecurringItemsData,
  });
  const { data: recurringSummaryData } = useRecurringSummary({
    initialData: initialRecurringSummaryData,
  });

  const confirmRecurringMutation = useConfirmRecurring();
  const detectRecurringMutation = useDetectRecurring();
  const dismissRecurringMutation = useDismissRecurring();
  const updateRecurringMutation = useUpdateRecurring();

  const accounts = accountsData?.accounts ?? [];
  const noAccounts = accounts.length === 0;
  const recurringItems = recurringItemsData?.items ?? [];
  const reviewItems = recurringItems.filter(
    (item) => item.status === "candidate" && item.confidenceScore < 90,
  );
  const includedItems = recurringItems.filter(
    (item) =>
      item.status === "confirmed" ||
      (item.status === "candidate" && item.confidenceScore >= 90),
  );
  const reviewItemKeys = new Set(
    reviewItems.map((item) => item.recurringSeriesKey),
  );
  const tableItems = recurringItems.filter(
    (item) => !reviewItemKeys.has(item.recurringSeriesKey),
  );
  const recurringSummary =
    recurringSummaryData?.summary ?? recurringSummaryData;
  const lastChecked = recurringSummary?.lastDetectedAt
    ? formatRelativeDate(
        recurringSummary.lastDetectedAt,
        relativeTimeFormatter,
        currentTime,
      )
    : null;
  const summaryCurrencyTotals = recurringSummary?.currencyTotals;
  const summaryCurrencyCodes = summaryCurrencyTotals
    ? Object.keys(summaryCurrencyTotals).filter(isCurrencyCode)
    : [];
  const itemCurrencyCodes = Array.from(
    recurringItems.reduce((codes, item) => {
      if (isCurrencyCode(item.currency?.code)) codes.add(item.currency.code);
      return codes;
    }, new Set<string>()),
  );
  const currencyCode =
    summaryCurrencyCodes.length === 1
      ? summaryCurrencyCodes[0]
      : itemCurrencyCodes.length === 1
        ? itemCurrencyCodes[0]
        : undefined;
  const getCurrencyCode = useCallback(
    (item: (typeof recurringItems)[number]) =>
      isCurrencyCode(item.currency?.code) ? item.currency?.code : currencyCode,
    [currencyCode],
  );
  const getCategoryLabel = useCallback(
    (item: (typeof recurringItems)[number]) => {
      const category = item.category;
      if (!category) return t("uncategorized");
      return category.isSystemCategory
        ? tCommon(getCategoryTranslationKey(category.name))
        : category.name;
    },
    [t, tCommon],
  );
  const [pendingActions, setPendingActions] = useState<Set<string>>(
    () => new Set(),
  );

  const openAccountAddModal = () => {
    setAccountAddModalIsOpen(true);
    posthog.capture("account_add_modal", { action: "open" });
  };
  const setAccountAddModalOpen = (open: boolean) => {
    setAccountAddModalIsOpen(open);
    posthog.capture("account_add_modal", { action: open ? "open" : "close" });
  };
  const onAddSyncAccountClick = () => {
    setAccountAddModalIsOpen(false);
    setAccountAddSyncModalIsOpen(true);
    posthog.capture("account_add_sync_modal", { action: "open" });
  };
  const closeAccountAddSyncModal = () => {
    setAccountAddSyncModalIsOpen(false);
    posthog.capture("account_add_sync_modal", { action: "close" });
  };
  const onAddOfflineAccountClick = () => {
    setAccountAddModalIsOpen(false);
    setAccountAddOfflineModalIsOpen(true);
    posthog.capture("account_add_offline_modal", { action: "open" });
  };
  const closeAccountAddOfflineModal = () => {
    setAccountAddOfflineModalIsOpen(false);
    posthog.capture("account_add_offline_modal", { action: "close" });
  };

  const statusLabels: RecurringStatusBadgeLabels = {
    confirmed: t("confirmed"),
    detected: t("detected"),
    needsReview: t("needsReview"),
    paused: t("paused"),
    ended: t("ended"),
    dismissed: t("dismissed"),
  };

  const typeLabels = {
    subscription: t("subscription"),
    bill: t("bill"),
  } as const;

  const cadenceLabels = {
    weekly: t("weekly"),
    biweekly: t("biweekly"),
    monthly: t("monthly"),
    quarterly: t("quarterly"),
    yearly: t("yearly"),
  } as const;

  const handleRecurringAction = useCallback(
    async (recurringSeriesKey: number, action: RecurringAction) => {
      const actionKey = `${recurringSeriesKey}:${action}`;
      setPendingActions((current) => new Set(current).add(actionKey));
      try {
        switch (action) {
          case "confirm":
            await confirmRecurringMutation.mutateAsync(recurringSeriesKey);
            toast.success(t("confirmSuccess"), { position: "bottom-center" });
            break;
          case "dismiss":
            await dismissRecurringMutation.mutateAsync(recurringSeriesKey);
            toast.success(t("dismissSuccess"), { position: "bottom-center" });
            break;
          case "restore":
            await updateRecurringMutation.mutateAsync({
              recurringSeriesKey,
              status: "candidate",
            });
            toast.success(t("restoreSuccess"), { position: "bottom-center" });
            break;
          default: {
            const exhaustiveAction: never = action;
            throw new TypeError(
              `Unsupported recurring action: ${exhaustiveAction}`,
            );
          }
        }
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        const errorMessages = {
          confirm: t("confirmError"),
          dismiss: t("dismissError"),
          restore: t("restoreError"),
        } satisfies Record<RecurringAction, string>;
        toast.error(errorMessages[action], { position: "bottom-center" });
      } finally {
        setPendingActions((current) => {
          const next = new Set(current);
          next.delete(actionKey);
          return next;
        });
      }
    },
    [
      confirmRecurringMutation,
      dismissRecurringMutation,
      t,
      updateRecurringMutation,
    ],
  );

  const handleScan = useCallback(async () => {
    try {
      await detectRecurringMutation.mutateAsync();
      toast.success(t("detectSuccess"), { position: "bottom-center" });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      toast.error(t("detectError"), { position: "bottom-center" });
    }
  }, [detectRecurringMutation, t]);

  const scrollToReview = useCallback(() => {
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches
      ? "auto"
      : "smooth";
    document
      .getElementById("recurring-review")
      ?.scrollIntoView({ behavior, block: "start" });
  }, []);

  const isItemPending = useCallback(
    (recurringSeriesKey: number) =>
      pendingActions.has(`${recurringSeriesKey}:confirm`) ||
      pendingActions.has(`${recurringSeriesKey}:dismiss`) ||
      pendingActions.has(`${recurringSeriesKey}:restore`),
    [pendingActions],
  );

  return (
    <div className="flex flex-col gap-8">
      <AccountAddModal
        isOpen={accountAddModalIsOpen}
        setOpen={setAccountAddModalOpen}
        onAddSyncAccountClick={onAddSyncAccountClick}
        onAddOfflineAccountClick={onAddOfflineAccountClick}
        trigger={false}
      />
      <AccountAddSyncModal
        isOpen={accountAddSyncModalIsOpen}
        setOpen={closeAccountAddSyncModal}
      />
      <AccountAddOfflineModal
        isOpen={accountAddOfflineModalIsOpen}
        closeModal={closeAccountAddOfflineModal}
      />

      <header className="flex flex-col gap-3">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div className="space-y-2">
            <Heading
              variant="h1"
              className="text-3xl font-semibold lg:text-3xl"
            >
              {t("title")}
            </Heading>
            <Text
              variant="smallText"
              className="text-muted-foreground max-w-3xl leading-5"
            >
              {t("subtitle")}
            </Text>
            {lastChecked ? (
              <p className="text-muted-foreground text-xs">
                {t("lastChecked", { time: lastChecked })}
              </p>
            ) : null}
          </div>
          {!noAccounts && recurringItems.length > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-11 shrink-0 gap-2"
              onClick={handleScan}
              disabled={detectRecurringMutation.isPending}
            >
              <RefreshCw
                className={
                  detectRecurringMutation.isPending
                    ? "size-4 animate-spin motion-reduce:animate-none"
                    : "size-4"
                }
                aria-hidden="true"
              />
              {detectRecurringMutation.isPending
                ? t("detecting")
                : t("scanAgain")}
            </Button>
          ) : null}
        </div>
      </header>

      {noAccounts ? (
        <RecurringNoAccountsEmptyState
          onAddAccount={openAccountAddModal}
          referenceTime={referenceTime}
        />
      ) : recurringItems.length === 0 ? (
        <RecurringDetectionEmptyState
          currencyCode={accounts[0]?.currencyKey.code ?? "EUR"}
          hasScanned={Boolean(recurringSummary?.lastDetectedAt)}
          isScanning={detectRecurringMutation.isPending}
          onScan={handleScan}
          referenceTime={currentTime}
        />
      ) : (
        <>
          <RecurringSummaryCards
            summary={recurringSummary}
            currencyCode={currencyCode}
            locale={financialLocale}
            onReviewClick={scrollToReview}
            labels={{
              monthlyEstimate: t("monthlyEstimate"),
              subscriptions: t("subscriptions"),
              bills: t("bills"),
              needsReview: t("needsReview"),
              estimateHint: t("estimateHint"),
              reviewActionLabel: t("reviewActionLabel"),
            }}
          />

          {summaryCurrencyCodes.length > 1 ? (
            <p className="text-muted-foreground text-sm">
              {t("mixedCurrencyNote")}
            </p>
          ) : null}

          {reviewItems.length > 0 ? (
            <section id="recurring-review" className="scroll-mt-6 space-y-3">
              <div className="space-y-1">
                <Heading variant="h2" className="text-xl">
                  {t("needsReview")}
                </Heading>
                <Text variant="mutedText" className="text-muted-foreground">
                  {t("reviewQueueDescription")}
                </Text>
              </div>
              <RecurringReviewQueue
                items={reviewItems}
                currencyCode={currencyCode}
                getCurrencyCode={getCurrencyCode}
                locale={financialLocale}
                onConfirm={(key) => handleRecurringAction(key, "confirm")}
                onDismiss={(key) => handleRecurringAction(key, "dismiss")}
                isItemPending={isItemPending}
                labels={{
                  confirmAction: t("confirm"),
                  dismissAction: t("notRecurring"),
                  confirmActionLabel: (merchant) =>
                    t("confirmMerchant", { merchant }),
                  dismissActionLabel: (merchant) =>
                    t("notRecurringMerchant", { merchant }),
                  emptyState: emptyStateCard(t("reviewQueueEmpty")),
                  statusLabels,
                  typeLabels,
                  cadenceLabels,
                  explainability: (item) => {
                    const fallbackAmount =
                      item.expectedAmount ??
                      item.averageAmount ??
                      item.lastAmount;

                    if (fallbackAmount == null)
                      return t("cadenceBasedEstimate");

                    const itemCurrencyCode =
                      item.currency?.code ?? currencyCode ?? "EUR";
                    return (
                      <>
                        <span className="sr-only">
                          {t("usuallyPerCharge", {
                            amount: formatCurrencyForScreenReader(
                              fallbackAmount,
                              itemCurrencyCode,
                              financialLocale,
                            ),
                          })}
                        </span>
                        <span aria-hidden="true">
                          {t("usuallyPerCharge", {
                            amount: formatCurrencyForLocale(
                              fallbackAmount,
                              itemCurrencyCode,
                              financialLocale,
                              { minimumFractionDigits: 2 },
                            ),
                          })}
                        </span>
                      </>
                    );
                  },
                  occurrenceCount: (count) => t("paymentsSeen", { count }),
                }}
              />
            </section>
          ) : null}

          <div className="grid gap-6 xl:grid-cols-2">
            <section className="space-y-3">
              <div className="space-y-1">
                <Heading variant="h2" className="text-xl">
                  {t("upcoming")}
                </Heading>
                <Text variant="mutedText" className="text-muted-foreground">
                  {t("timelineDescription")}
                </Text>
              </div>
              <RecurringUpcomingTimeline
                items={includedItems}
                currencyCode={currencyCode}
                getCurrencyCode={getCurrencyCode}
                locale={financialLocale}
                referenceTime={currentTime}
                labels={{
                  statusLabels,
                  expected: t("expected"),
                  expectedAround: t("expectedAround"),
                  emptyState: emptyStateCard(t("upcomingEmpty")),
                }}
              />
            </section>

            <section className="space-y-3">
              <div className="space-y-1">
                <Heading variant="h2" className="text-xl">
                  {t("categoryImpact")}
                </Heading>
                <Text variant="mutedText" className="text-muted-foreground">
                  {t("categoryImpactDescription")}
                </Text>
              </div>
              <RecurringCategoryImpact
                items={includedItems}
                currencyCode={currencyCode}
                getCurrencyCode={getCurrencyCode}
                locale={financialLocale}
                labels={{
                  title: undefined,
                  categoryLabel: getCategoryLabel,
                  emptyState: emptyStateCard(t("categoryImpactEmpty")),
                  paymentCount: (count) => t("paymentCount", { count }),
                  shareLabel: (percentage) => t("shareOfTotal", { percentage }),
                  uncategorizedLabel: t("uncategorized"),
                }}
              />
            </section>
          </div>

          {tableItems.length > 0 ? (
            <section className="space-y-3">
              <div className="space-y-1">
                <Heading variant="h2" className="text-xl">
                  {t("paymentHistory")}
                </Heading>
                <Text variant="mutedText" className="text-muted-foreground">
                  {t("tableDescription")}
                </Text>
              </div>
              <RecurringItemsTable
                items={tableItems}
                currencyCode={currencyCode}
                getCategoryLabel={getCategoryLabel}
                getCurrencyCode={getCurrencyCode}
                locale={financialLocale}
                onConfirm={(key) => handleRecurringAction(key, "confirm")}
                onDismiss={(key) => handleRecurringAction(key, "dismiss")}
                onRestore={(key) => handleRecurringAction(key, "restore")}
                isItemPending={isItemPending}
                labels={{
                  merchant: t("merchant"),
                  type: t("type"),
                  amount: t("amount"),
                  frequency: t("frequency"),
                  nextExpected: t("nextExpected"),
                  lastPaid: t("lastPaid"),
                  status: t("status"),
                  actions: t("actions"),
                  confirmAction: t("confirm"),
                  dismissAction: t("notRecurring"),
                  markNotRecurringAction: t("markNotRecurring"),
                  restoreAction: t("restore"),
                  confirmActionLabel: (merchant) =>
                    t("confirmMerchant", { merchant }),
                  dismissActionLabel: (merchant) =>
                    t("notRecurringMerchant", { merchant }),
                  markNotRecurringActionLabel: (merchant) =>
                    t("markNotRecurringMerchant", { merchant }),
                  restoreActionLabel: (merchant) =>
                    t("restoreMerchant", { merchant }),
                  emptyState: emptyStateCard(t("tableEmpty")),
                  typeLabels,
                  cadenceLabels,
                  statusLabels,
                  expectedAround: t("expectedAround"),
                }}
              />
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
