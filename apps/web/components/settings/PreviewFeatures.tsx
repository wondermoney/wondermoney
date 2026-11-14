"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/Label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Heading, Text } from "@/components/ui/Typography";
import useUpdateUserPreferences from "@/lib/api/user-preferences/useUpdateUserPreferences";
import useUserPreferences from "@/lib/api/user-preferences/useUserPreferences";
import { cn } from "@/lib/utils";

/**
 * Settings › Appearance › Preview features: the per-user switch that makes
 * preview features available across web and mobile.
 *
 * The switch is the only control. It sits in a separate section from the
 * device-local theme and language because it is stored on the account, not on
 * this device — the same setting follows the person to their phone.
 */
export default function PreviewFeatures() {
  const t = useTranslations("previewFeatures");
  const preferences = useUserPreferences();
  const update = useUpdateUserPreferences();
  const enabled = preferences.data?.previewFeatures ?? false;
  const switchId = "preview-features";
  const descriptionId = `${switchId}-description`;
  const feedbackId = `${switchId}-feedback`;

  return (
    <div className="grid max-w-7xl grid-cols-1 gap-x-8 gap-y-10 py-10 md:grid-cols-3">
      <div>
        <Heading variant="h2">{t("title")}</Heading>
        <Text variant="lead" className="mt-1 text-sm">
          {t("description")}
        </Text>
      </div>

      <div className="bg-card rounded p-4 md:col-span-2">
        {preferences.isPending ? (
          <div
            className="flex items-center justify-between gap-5"
            aria-busy="true"
          >
            <div className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-64" />
            </div>
            <Skeleton className="h-6 w-11 rounded-full" />
          </div>
        ) : preferences.isError ? (
          <div className="flex flex-wrap items-center gap-3" role="alert">
            <Text className="text-destructive-text text-sm">
              {t("loadError")}
            </Text>
            <Button
              className="min-h-11 px-2"
              variant="link"
              onClick={() => preferences.refetch()}
            >
              {t("retry")}
            </Button>
          </div>
        ) : (
          <section aria-labelledby={`${switchId}-title`}>
            <div className="flex items-start justify-between gap-5">
              <div className="min-w-0 space-y-2">
                <h3
                  id={`${switchId}-title`}
                  className="text-foreground text-sm font-semibold"
                >
                  {t("toggleLabel")}
                </h3>
                <Text
                  id={descriptionId}
                  className="text-muted-foreground block text-sm"
                >
                  {t("warning")}
                </Text>
              </div>

              <Label
                htmlFor={switchId}
                className={cn(
                  "flex min-h-11 min-w-11 shrink-0 items-center justify-end",
                  update.isPending ? "cursor-not-allowed" : "cursor-pointer",
                )}
              >
                <Switch
                  id={switchId}
                  checked={enabled}
                  disabled={update.isPending}
                  aria-label={t(
                    enabled ? "toggleOffLabel" : "toggleOnLabel",
                  )}
                  aria-describedby={`${descriptionId} ${feedbackId}`}
                  onCheckedChange={(next) =>
                    update.mutate({ previewFeatures: next })
                  }
                />
              </Label>
            </div>

            <div id={feedbackId} className="mt-3" aria-live="polite">
              {update.isPending ? (
                <Text className="text-muted-foreground text-xs">
                  {t("saving")}
                </Text>
              ) : null}
              {update.isSuccess ? (
                <Text className="text-muted-foreground text-xs">
                  {t("saved")}
                </Text>
              ) : null}
              {update.isError ? (
                <div className="flex flex-wrap items-center gap-3" role="alert">
                  <Text className="text-destructive-text text-xs">
                    {t("saveError")}
                  </Text>
                  <Button
                    className="min-h-11 px-2"
                    variant="link"
                    onClick={() =>
                      update.variables && update.mutate(update.variables)
                    }
                  >
                    {t("retry")}
                  </Button>
                </div>
              ) : null}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
