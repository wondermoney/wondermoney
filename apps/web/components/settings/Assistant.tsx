"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";

import useAssistantAuditLog from "@/lib/api/assistant/useAssistantAuditLog";
import useAssistantConsent from "@/lib/api/assistant/useAssistantConsent";
import useUpdateAssistantConsent from "@/lib/api/assistant/useUpdateAssistantConsent";

import { Label } from "../ui/Label";
import { Switch } from "../ui/switch";
import { Heading, Text } from "../ui/Typography";

const SAFE_METADATA_KEYS = new Set([
  "dataCategory",
  "dateRange",
  "denialReason",
  "granularity",
  "period",
  "recordCount",
  "status",
]);

function sanitizeMetadata(metadata?: Record<string, unknown>) {
  if (!metadata) {
    return null;
  }

  const sanitized = Object.fromEntries(
    Object.entries(metadata).filter(([key]) => SAFE_METADATA_KEYS.has(key)),
  );

  if (
    sanitized &&
    typeof sanitized === "object" &&
    !Array.isArray(sanitized) &&
    Object.keys(sanitized as Record<string, unknown>).length === 0
  ) {
    return null;
  }

  return sanitized;
}

export default function Assistant() {
  const t = useTranslations();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const {
    data: consent,
    isError: consentIsError,
    isLoading: consentIsLoading,
  } = useAssistantConsent();
  const updateConsent = useUpdateAssistantConsent();
  const {
    data: auditLog,
    isError: auditLogIsError,
    isLoading: auditLogIsLoading,
  } = useAssistantAuditLog(Boolean(consent?.assistantEnabled));

  const assistantEnabled = consent?.assistantEnabled ?? false;
  const launcherHidden = consent?.launcherHidden ?? false;

  const auditEvents = useMemo(() => {
    return (auditLog?.events ?? []).map((event) => ({
      ...event,
      metadata: sanitizeMetadata(event.metadata),
    }));
  }, [auditLog?.events]);
  const shouldShowAuditEvents = assistantEnabled && auditEvents.length > 0;

  const formatDateTime = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));

  const handleAssistantEnabledChange = async (nextEnabled: boolean) => {
    if (!consent) {
      return;
    }

    const previousConsent = consent;
    queryClient.setQueryData(["assistant", "consent"], {
      ...consent,
      assistantEnabled: nextEnabled,
    });

    try {
      await updateConsent.mutateAsync({
        assistantEnabled: nextEnabled,
        launcherHidden: consent.launcherHidden,
      });
    } catch {
      queryClient.setQueryData(["assistant", "consent"], previousConsent);
    }
  };

  const handleLauncherHiddenChange = async (nextHidden: boolean) => {
    if (!consent) {
      return;
    }

    const previousConsent = consent;
    queryClient.setQueryData(["assistant", "consent"], {
      ...consent,
      launcherHidden: nextHidden,
    });

    try {
      await updateConsent.mutateAsync({
        assistantEnabled: consent.assistantEnabled,
        launcherHidden: nextHidden,
      });
    } catch {
      queryClient.setQueryData(["assistant", "consent"], previousConsent);
    }
  };

  return (
    <div className="divide-border divide-y">
      <div className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-10 px-4 py-16 sm:px-6 md:grid-cols-3 lg:px-8">
        <div>
          <Heading variant="h2">{t("assistant.settings.title")}</Heading>
          <Text variant="lead" className="mt-1 text-sm">
            {t("assistant.settings.description")}
          </Text>
        </div>

        <div className="bg-card space-y-8 rounded p-4 md:col-span-2">
          {consentIsError ? (
            <Text className="text-destructive-text text-sm">
              {t("assistant.settings.error")}
            </Text>
          ) : null}

          <div className="space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="assistant-enabled">
                  {t("assistant.settings.enabled")}
                </Label>
                <Text className="text-muted-foreground text-sm">
                  {t("assistant.settings.enabledDescription")}
                </Text>
              </div>

              <div className="flex flex-col items-end gap-2">
                <Switch
                  id="assistant-enabled"
                  checked={assistantEnabled}
                  disabled={
                    consentIsLoading ||
                    consentIsError ||
                    updateConsent.isPending
                  }
                  onCheckedChange={handleAssistantEnabledChange}
                />
                <Text className="text-muted-foreground text-xs">
                  {consentIsLoading
                    ? t("assistant.settings.loading")
                    : t(assistantEnabled ? "enabled" : "disabled")}
                </Text>
              </div>
            </div>

            <div className="border-border/70 bg-muted/30 text-muted-foreground rounded-lg border p-4 text-sm">
              <p>{t("assistant.consent.readOnlyDetail")}</p>
              <p className="mt-2">{t("assistant.consent.azureDetail")}</p>
              <p className="mt-2">{t("assistant.consent.temporaryDetail")}</p>
              <p className="mt-2">{t("assistant.consent.toolsDetail")}</p>
            </div>

            <div className="border-border/60 flex items-start justify-between gap-4 border-t pt-6">
              <div className="space-y-1">
                <Label htmlFor="assistant-launcher-hidden">
                  {t("assistant.settings.hideLauncher")}
                </Label>
                <Text className="text-muted-foreground text-sm">
                  {t("assistant.settings.hideLauncherDescription")}
                </Text>
              </div>

              <Switch
                id="assistant-launcher-hidden"
                checked={launcherHidden}
                disabled={
                  consentIsLoading || consentIsError || updateConsent.isPending
                }
                onCheckedChange={handleLauncherHiddenChange}
              />
            </div>
          </div>

          <div className="border-border/70 bg-muted/30 rounded-lg border p-4">
            <p className="text-foreground text-sm font-medium">
              {t("assistant.settings.temporaryChats")}
            </p>
            <Text className="text-muted-foreground mt-1 text-sm">
              {t("assistant.settings.temporaryChatsDescription")}
            </Text>
          </div>

          <div className="border-border/60 space-y-4 border-t pt-6">
            <div className="space-y-1">
              <Heading variant="h4">{t("assistant.settings.auditLog")}</Heading>
              <Text className="text-muted-foreground text-sm">
                {t("assistant.settings.auditLogDescription")}
              </Text>
            </div>

            {consentIsLoading || auditLogIsLoading ? (
              <Text className="text-muted-foreground text-sm">
                {t("assistant.settings.auditLogLoading")}
              </Text>
            ) : auditLogIsError ? (
              <Text className="text-destructive-text text-sm">
                {t("assistant.settings.auditLogError")}
              </Text>
            ) : !shouldShowAuditEvents ? (
              <Text className="text-muted-foreground text-sm">
                {assistantEnabled
                  ? t("assistant.settings.auditLogEmpty")
                  : t("assistant.settings.auditLogDisabled")}
              </Text>
            ) : (
              <div className="space-y-3">
                {auditEvents.map((event) => (
                  <div
                    key={`${event.conversationId}-${event.createdAt}-${event.eventType}`}
                    className="border-border/70 bg-background rounded-lg border p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-foreground text-sm font-medium">
                          {event.eventType}
                        </p>
                        <p className="text-muted-foreground text-xs">
                          {formatDateTime(event.createdAt)}
                        </p>
                      </div>

                      {event.toolName ? (
                        <p className="text-muted-foreground text-xs font-medium">
                          {event.toolName}
                        </p>
                      ) : null}
                    </div>

                    <dl className="mt-4 grid gap-3 text-sm">
                      <div className="space-y-1">
                        <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                          {t("assistant.settings.auditLogConversationId")}
                        </dt>
                        <dd className="text-foreground font-mono text-xs">
                          {event.conversationId}
                        </dd>
                      </div>

                      <div className="space-y-1">
                        <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                          {t("assistant.settings.auditLogMetadata")}
                        </dt>
                        <dd className="bg-muted/50 text-foreground rounded-md p-3 font-mono text-xs whitespace-pre-wrap">
                          {event.metadata
                            ? JSON.stringify(event.metadata, null, 2)
                            : t("assistant.settings.auditLogNoMetadata")}
                        </dd>
                      </div>
                    </dl>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
