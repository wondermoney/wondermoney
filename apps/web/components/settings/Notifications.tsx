"use client";

import { BellOff, Circle, CircleCheck, CirclePause } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/Label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Heading, Text } from "@/components/ui/Typography";
import type { UpdateEmailNotificationPreferencesInput } from "@/lib/api/email-notification-preferences/types";
import useEmailNotificationPreferences from "@/lib/api/email-notification-preferences/useEmailNotificationPreferences";
import useUpdateEmailNotificationPreferences from "@/lib/api/email-notification-preferences/useUpdateEmailNotificationPreferences";
import { cn } from "@/lib/utils";

import {
  buildNotificationPreferencePatch,
  getNotificationPreferenceViewState,
  type NotificationPreference,
  type NotificationPreferencePauseReason,
  type NotificationStream,
} from "./notification-preference-state";

const streamConfig = {
  budgetAlerts: {
    titleKey: "budgetAlerts.title",
    descriptionKey: "budgetAlerts.description",
    detailKey: "budgetAlerts.detail",
  },
  weeklyInsights: {
    titleKey: "weeklyInsights.title",
    descriptionKey: "weeklyInsights.description",
    detailKey: "weeklyInsights.detail",
  },
  accountRecovery: {
    titleKey: "accountRecovery.title",
    descriptionKey: "accountRecovery.description",
    detailKey: "accountRecovery.detail",
  },
} as const;

const NOTIFICATION_STREAMS = [
  "budgetAlerts",
  "weeklyInsights",
  "accountRecovery",
] as const satisfies readonly NotificationStream[];

type MutationTarget = NotificationStream | "marketingOptOut" | null;

function getMutationTarget(
  input?: UpdateEmailNotificationPreferencesInput,
): MutationTarget {
  if (!input) return null;
  if (input.budgetAlertsEnabled !== undefined) return "budgetAlerts";
  if (input.weeklyInsightsEnabled !== undefined) return "weeklyInsights";
  if (input.accountRecoveryEnabled !== undefined) return "accountRecovery";
  if (input.marketingOptOut !== undefined) return "marketingOptOut";
  return null;
}

export default function Notifications() {
  const t = useTranslations("notificationPreferences");
  const preferencesQuery = useEmailNotificationPreferences();
  const updatePreferences = useUpdateEmailNotificationPreferences();
  const mutationTarget = getMutationTarget(updatePreferences.variables);

  const handleStreamChange = (
    stream: NotificationStream,
    preference: NotificationPreference,
    isMarketingOptedOut: boolean,
    nextEnabled: boolean,
  ) => {
    const viewState = getNotificationPreferenceViewState(
      preference,
      isMarketingOptedOut,
    );
    if (nextEnabled && !viewState.canEnable) return;

    updatePreferences.reset();
    updatePreferences.mutate(
      buildNotificationPreferencePatch(stream, nextEnabled),
    );
  };

  const handleMarketingOptOutChange = (nextOptedOut: boolean) => {
    updatePreferences.reset();
    updatePreferences.mutate({ marketingOptOut: nextOptedOut });
  };

  const retryUpdate = () => {
    if (updatePreferences.variables) {
      updatePreferences.mutate(updatePreferences.variables);
    }
  };

  return (
    <div className="divide-y divide-border">
      <div className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-10 px-4 py-16 sm:px-6 md:grid-cols-3 lg:px-8">
        <div>
          <Heading variant="h2">{t("title")}</Heading>
          <Text variant="lead" className="mt-1 text-sm">
            {t("description")}
          </Text>
        </div>

        <div className="md:col-span-2">
          {!preferencesQuery.data ? (
            preferencesQuery.isPending ? (
              <NotificationPreferencesSkeleton loadingLabel={t("loading")} />
            ) : (
              <NotificationPreferencesLoadError
                isRetrying={preferencesQuery.isFetching}
                onRetry={() => preferencesQuery.refetch()}
              />
            )
          ) : (
            <div className="space-y-4">
              {preferencesQuery.isError ? (
                <NotificationPreferencesRefreshWarning
                  isRetrying={preferencesQuery.isFetching}
                  onRetry={() => preferencesQuery.refetch()}
                />
              ) : null}

              <MarketingOptOutControl
                marketingOptOut={preferencesQuery.data.marketingOptOut}
                isMutationPending={
                  updatePreferences.isPending &&
                  mutationTarget === "marketingOptOut"
                }
                isMutationError={
                  updatePreferences.isError &&
                  mutationTarget === "marketingOptOut"
                }
                isMutationSuccess={
                  updatePreferences.isSuccess &&
                  mutationTarget === "marketingOptOut"
                }
                onChange={handleMarketingOptOutChange}
                onRetry={retryUpdate}
              />

              <div className="rounded-lg border border-border bg-card px-5">
                {NOTIFICATION_STREAMS.map((stream, index) => (
                  <NotificationPreferenceControl
                    key={stream}
                    stream={stream}
                    preference={preferencesQuery.data[stream]}
                    isMarketingOptedOut={preferencesQuery.data.marketingOptOut}
                    isFirst={index === 0}
                    mutationStream={mutationTarget}
                    isMutationPending={updatePreferences.isPending}
                    isMutationError={
                      updatePreferences.isError && mutationTarget === stream
                    }
                    isMutationSuccess={
                      updatePreferences.isSuccess && mutationTarget === stream
                    }
                    onChange={(nextEnabled) =>
                      handleStreamChange(
                        stream,
                        preferencesQuery.data[stream],
                        preferencesQuery.data.marketingOptOut,
                        nextEnabled,
                      )
                    }
                    onRetry={retryUpdate}
                  />
                ))}
              </div>

              <Text className="px-1 text-sm text-muted-foreground">
                {t("dataContext")}
              </Text>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface NotificationPreferenceControlProps {
  stream: NotificationStream;
  preference: NotificationPreference;
  isMarketingOptedOut: boolean;
  isFirst: boolean;
  mutationStream: MutationTarget;
  isMutationPending: boolean;
  isMutationError: boolean;
  isMutationSuccess: boolean;
  onChange: (nextEnabled: boolean) => void;
  onRetry: () => void;
}

function NotificationPreferenceControl({
  stream,
  preference,
  isMarketingOptedOut,
  isFirst,
  mutationStream,
  isMutationPending,
  isMutationError,
  isMutationSuccess,
  onChange,
  onRetry,
}: NotificationPreferenceControlProps) {
  const t = useTranslations("notificationPreferences");
  const config = streamConfig[stream];
  const viewState = getNotificationPreferenceViewState(
    preference,
    isMarketingOptedOut,
  );
  const switchId = `notification-${stream}`;
  const descriptionId = `${switchId}-description`;
  const feedbackId = `${switchId}-feedback`;
  const isThisStreamPending = isMutationPending && mutationStream === stream;
  const switchDisabled = isMutationPending || !viewState.canChange;

  return (
    <section
      className={cn("py-5", !isFirst && "border-t border-border")}
      aria-labelledby={`${switchId}-title`}
    >
      <div className="flex items-start justify-between gap-5">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              id={`${switchId}-title`}
              className="text-sm font-semibold text-foreground"
            >
              {t(config.titleKey)}
            </h3>
            <span
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-foreground"
            >
              <StatusIcon status={viewState.status} />
              {t(`status.${viewState.status}`)}
            </span>
          </div>

          <Text id={descriptionId} className="text-sm text-muted-foreground">
            {t(config.descriptionKey)}
          </Text>
          <Text className="text-xs text-muted-foreground">
            {t(config.detailKey)}
          </Text>
        </div>

        <Label
          htmlFor={switchId}
          className={cn(
            "flex min-h-11 min-w-11 shrink-0 items-center justify-end",
            switchDisabled ? "cursor-not-allowed" : "cursor-pointer",
          )}
        >
          <Switch
            id={switchId}
            checked={preference.storedEnabled}
            disabled={switchDisabled}
            aria-label={t(
              preference.storedEnabled ? "toggleOffLabel" : "toggleOnLabel",
              { name: t(config.titleKey) },
            )}
            aria-describedby={`${descriptionId} ${feedbackId}`}
            onCheckedChange={onChange}
          />
        </Label>
      </div>

      <div id={feedbackId} className="mt-3" aria-live="polite">
        {viewState.pauseReason ? (
          <Text className="text-xs text-muted-foreground">
            {t(getPauseReasonKey(viewState.pauseReason))}
          </Text>
        ) : null}

        {isThisStreamPending ? (
          <Text className="text-xs text-muted-foreground">
            {t("saving")}
          </Text>
        ) : null}

        {isMutationSuccess ? (
          <Text className="text-xs text-muted-foreground">{t("saved")}</Text>
        ) : null}

        {isMutationError ? (
          <div className="flex flex-wrap items-center gap-3" role="alert">
            <Text className="text-xs text-destructive-text">
              {t("saveError")}
            </Text>
            <Button
              className="min-h-11 px-2"
              variant="link"
              onClick={onRetry}
            >
              {t("retry")}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

interface MarketingOptOutControlProps {
  marketingOptOut: boolean;
  isMutationPending: boolean;
  isMutationError: boolean;
  isMutationSuccess: boolean;
  onChange: (nextOptedOut: boolean) => void;
  onRetry: () => void;
}

function MarketingOptOutControl({
  marketingOptOut,
  isMutationPending,
  isMutationError,
  isMutationSuccess,
  onChange,
  onRetry,
}: MarketingOptOutControlProps) {
  const t = useTranslations("notificationPreferences");
  const switchId = "notification-marketing-opt-out";
  const descriptionId = `${switchId}-description`;
  const feedbackId = `${switchId}-feedback`;

  return (
    <section
      className="rounded-lg border border-border bg-muted/40 px-5 py-5"
      aria-labelledby={`${switchId}-title`}
    >
      <div className="flex items-start justify-between gap-5">
        <div className="flex min-w-0 items-start gap-3">
          <BellOff
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <div className="min-w-0 space-y-1">
            <h3
              id={`${switchId}-title`}
              className="text-sm font-semibold text-foreground"
            >
              {t("marketingOptOut.title")}
            </h3>
            <Text
              id={descriptionId}
              className="text-sm text-muted-foreground"
            >
              {t("marketingOptOut.description")}
            </Text>
          </div>
        </div>

        <Label
          htmlFor={switchId}
          className={cn(
            "flex min-h-11 min-w-11 shrink-0 items-center justify-end",
            isMutationPending ? "cursor-not-allowed" : "cursor-pointer",
          )}
        >
          <Switch
            id={switchId}
            checked={marketingOptOut}
            disabled={isMutationPending}
            aria-label={t(
              marketingOptOut
                ? "marketingOptOut.toggleOffLabel"
                : "marketingOptOut.toggleOnLabel",
            )}
            aria-describedby={`${descriptionId} ${feedbackId}`}
            onCheckedChange={onChange}
          />
        </Label>
      </div>

      <div id={feedbackId} className="mt-3" aria-live="polite">
        {isMutationPending ? (
          <Text className="text-xs text-muted-foreground">
            {t("saving")}
          </Text>
        ) : null}

        {isMutationSuccess ? (
          <Text className="text-xs text-muted-foreground">{t("saved")}</Text>
        ) : null}

        {isMutationError ? (
          <div className="flex flex-wrap items-center gap-3" role="alert">
            <Text className="text-xs text-destructive-text">
              {t("saveError")}
            </Text>
            <Button
              className="min-h-11 px-2"
              variant="link"
              onClick={onRetry}
            >
              {t("retry")}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function getPauseReasonKey(reason: NotificationPreferencePauseReason) {
  switch (reason) {
    case "delivery":
      return "pauseReason.delivery" as const;
    case "marketingOptOut":
      return "pauseReason.marketingOptOut" as const;
    case "generic":
      return "pauseReason.generic" as const;
    default:
      return "pauseReason.generic" as const;
  }
}

function StatusIcon({ status }: { status: "active" | "paused" | "off" }) {
  const className = "size-3.5 shrink-0";
  if (status === "active") {
    return <CircleCheck className={className} aria-hidden="true" />;
  }
  if (status === "paused") {
    return <CirclePause className={className} aria-hidden="true" />;
  }
  return <Circle className={className} aria-hidden="true" />;
}

function NotificationPreferencesLoadError({
  isRetrying,
  onRetry,
}: {
  isRetrying: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations("notificationPreferences");

  return (
    <div className="rounded-lg border border-border bg-card p-5" role="alert">
      <Heading variant="h4">{t("loadError.title")}</Heading>
      <Text className="mt-2 text-sm text-muted-foreground">
        {t("loadError.description")}
      </Text>
      <Button
        className="mt-4 min-h-11"
        variant="outline"
        onClick={onRetry}
        loading={isRetrying}
      >
        {t("retry")}
      </Button>
    </div>
  );
}

function NotificationPreferencesRefreshWarning({
  isRetrying,
  onRetry,
}: {
  isRetrying: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations("notificationPreferences");

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-border bg-muted p-4 sm:flex-row sm:items-center sm:justify-between"
      role="status"
      aria-live="polite"
    >
      <div>
        <Text className="text-sm font-medium text-foreground">
          {t("refreshWarning.title")}
        </Text>
        <Text className="mt-1 text-sm text-muted-foreground">
          {t("refreshWarning.description")}
        </Text>
      </div>
      <Button
        className="min-h-11 shrink-0 self-start sm:self-auto"
        variant="outline"
        onClick={onRetry}
        loading={isRetrying}
      >
        {t("retry")}
      </Button>
    </div>
  );
}

function NotificationPreferencesSkeleton({
  loadingLabel,
}: {
  loadingLabel: string;
}) {
  return (
    <div className="space-y-4" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{loadingLabel}</span>

      <div className="rounded-lg border border-border bg-muted/40 px-5 py-5">
        <div className="flex items-start justify-between gap-5">
          <div className="w-full max-w-lg space-y-3">
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-4 w-full" />
          </div>
          <Skeleton className="h-6 w-11 rounded-full" />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card px-5">
        {NOTIFICATION_STREAMS.map((stream, index) => (
          <div
            key={stream}
            className={cn("py-5", index > 0 && "border-t border-border")}
          >
            <div className="flex items-start justify-between gap-5">
              <div className="w-full max-w-lg space-y-3">
                <Skeleton className="h-5 w-36" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-3 w-3/4" />
              </div>
              <Skeleton className="h-6 w-11 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
