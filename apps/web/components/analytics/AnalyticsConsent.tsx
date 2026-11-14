"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Heading, Text } from "@/components/ui/Typography";
import {
  setAnalyticsConsent,
  useAnalyticsConsent,
} from "@/lib/analytics/consent";
import {
  isAnalyticsEnabled,
  isGtmEnabled,
} from "@/lib/utils/analytics-enabled";

export function AnalyticsConsent({ settings = false }: { settings?: boolean }) {
  const t = useTranslations("analytics-opt-in");
  const consent = useAnalyticsConsent();
  if (!isAnalyticsEnabled() && !isGtmEnabled()) return null;
  if (!settings && consent !== null) return null;

  const choose = (value: "granted" | "denied") => {
    setAnalyticsConsent(value);
    // Reload after withdrawing to unload GTM tags and their in-memory queues.
    if (value === "denied" && consent === "granted" && isGtmEnabled()) {
      window.location.reload();
    }
  };

  return (
    <section
      aria-label={t("title")}
      className={
        settings
          ? "flex flex-col gap-4 py-8"
          : "border-border bg-background fixed inset-x-4 bottom-24 z-50 mx-auto flex max-w-xl flex-col gap-4 rounded-lg border p-6 shadow-lg"
      }
    >
      <Heading variant="h2">{t("title")}</Heading>
      <Text className="text-muted-foreground text-sm">{t("description")}</Text>
      <Text variant="smallText">{t("change-later")}</Text>
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="secondary"
          className="min-h-11"
          onClick={() => choose("denied")}
        >
          {t("decline")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="min-h-11"
          onClick={() => choose("granted")}
        >
          {t("allow")}
        </Button>
      </div>
      {settings ? (
        <Text variant="smallText">
          {t(consent === "granted" ? "enabled" : "disabled")}
        </Text>
      ) : null}
    </section>
  );
}
