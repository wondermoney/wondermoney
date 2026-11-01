"use client";

import { Lock, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

import AssistantDataUsedDisclosure from "./AssistantDataUsedDisclosure";

type Props = {
  onEnable: () => void;
  onDismiss: () => void;
  isPending?: boolean;
};

export default function AssistantConsentScreen({
  onEnable,
  onDismiss,
  isPending,
}: Props) {
  const t = useTranslations("assistant");

  return (
    <div
      className="flex h-full flex-col justify-between gap-6 p-6 md:p-7"
      data-testid="assistant-consent-screen"
    >
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="bg-primary/10 text-primary flex size-11 items-center justify-center rounded-lg border border-primary/15">
            <ShieldCheck className="size-5" />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl leading-tight font-semibold tracking-tight md:text-2xl">
              {t("consent.title")}
            </h2>
          </div>
        </div>

        <p className="text-muted-foreground max-w-xl text-sm leading-6 md:text-base">
          {t("consent.description")}
        </p>

        <div className="grid gap-3 text-sm md:grid-cols-2">
          <div className="rounded-lg border border-border bg-background p-4">
            <div className="mb-2 flex items-center gap-2 font-medium">
              <Lock className="text-muted-foreground size-4" />
              <span>{t("consent.readOnly")}</span>
            </div>
            <p className="text-muted-foreground leading-6">
              {t("consent.readOnlyDetail")}
            </p>
          </div>

          <div className="rounded-lg border border-border bg-background p-4">
            <div className="mb-2 flex items-center gap-2 font-medium">
              <ShieldCheck className="text-muted-foreground size-4" />
              <span>{t("consent.azure")}</span>
            </div>
            <p className="text-muted-foreground leading-6">
              {t("consent.azureDetail")}
            </p>
          </div>

          <div className="rounded-lg border border-border bg-background p-4">
            <div className="mb-2 flex items-center gap-2 font-medium">
              <Lock className="text-muted-foreground size-4" />
              <span>{t("consent.temporary")}</span>
            </div>
            <p className="text-muted-foreground leading-6">
              {t("consent.temporaryDetail")}
            </p>
          </div>

          <div className="rounded-lg border border-border bg-background p-4">
            <div className="mb-2 flex items-center gap-2 font-medium">
              <Lock className="text-muted-foreground size-4" />
              <span>{t("consent.tools")}</span>
            </div>
            <p className="text-muted-foreground leading-6">
              {t("consent.toolsDetail")}
            </p>
          </div>
        </div>

        <AssistantDataUsedDisclosure className="bg-background" />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="secondary"
          onClick={onDismiss}
          disabled={isPending}
          data-testid="assistant-dismiss"
        >
          {t("consent.notNow")}
        </Button>
        <Button
          type="button"
          onClick={onEnable}
          loading={isPending}
          disabled={isPending}
          data-testid="assistant-enable"
        >
          {t("consent.enable")}
        </Button>
      </div>
    </div>
  );
}
