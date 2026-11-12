"use client";

import { ListPlus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  type RulePresetInstallResult,
  useRulePresets,
} from "@/lib/api/rule/useRulePresets";
import { browserLanguages, presetLocale } from "@/lib/rules/preset-locale";
import { cn } from "@/lib/utils";

import { RulePresetDialog, usePresetName } from "./RulePresetDialog";

const DISMISSED_KEY = "wondermoney:rule-preset-offer:dismissed";

function readDismissed(): string[] {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((code) => typeof code === "string")
      : [];
  } catch {
    return [];
  }
}

function writeDismissed(codes: string[]) {
  try {
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(codes));
  } catch {
    // A blocked storage only means the offer shows again next time.
  }
}

/** The presets, and the one matching the person's language and country. */
export function useSuggestedRulePreset() {
  const appLocale = useLocale();
  const locale = useMemo(
    () => presetLocale(appLocale, browserLanguages()),
    [appLocale],
  );
  const query = useRulePresets(locale);
  const presets = query.data?.presets ?? [];
  const suggested =
    presets.find((preset) => preset.code === query.data?.suggested) ?? null;
  return { presets, suggested };
}

/**
 * Offers the rule preset that matches the person's language and country, once:
 * a short note with a preview. It never installs on its own: only the dialog's
 * confirm button adds rules. Hidden once any of the preset is in the
 * household's rules, or after "Not now" (remembered in this browser).
 */
export function RulePresetOffer({
  className,
  onInstalled,
}: {
  className?: string;
  onInstalled?: (result: RulePresetInstallResult) => void;
}) {
  const t = useTranslations("rulePresets");
  const presetName = usePresetName();
  const { presets, suggested } = useSuggestedRulePreset();
  const [dismissed, setDismissed] = useState(readDismissed);
  const [previewing, setPreviewing] = useState(false);

  if (
    !suggested ||
    suggested.installedCount > 0 ||
    dismissed.includes(suggested.code)
  )
    return null;

  const dismiss = () => {
    const next = [...dismissed, suggested.code];
    setDismissed(next);
    writeDismissed(next);
  };

  return (
    <section
      aria-label={t("offer.title", { name: presetName(suggested.code) })}
      className={cn(
        "border-border flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium">
          {t("offer.title", { name: presetName(suggested.code) })}
        </p>
        <p className="text-muted-foreground text-sm">
          {t("offer.description", { count: suggested.ruleCount })}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button variant="ghost" className="min-h-11" onClick={dismiss}>
          {t("offer.dismiss")}
        </Button>
        <Button
          variant="secondary"
          className="min-h-11"
          onClick={() => setPreviewing(true)}
        >
          {t("offer.preview")}
        </Button>
      </div>
      {previewing ? (
        <RulePresetDialog
          open
          onOpenChange={setPreviewing}
          code={suggested.code}
          presets={presets}
          onInstalled={onInstalled}
        />
      ) : null}
    </section>
  );
}

/** Settings → Rules: browse every preset, starting with the matching one. */
export function RulePresetsButton({
  onInstalled,
}: {
  onInstalled?: (result: RulePresetInstallResult) => void;
}) {
  const t = useTranslations("rulePresets");
  const { presets, suggested } = useSuggestedRulePreset();
  const [open, setOpen] = useState(false);
  const first = suggested ?? presets[0];
  if (!first) return null;
  return (
    <>
      <Button
        variant="ghost"
        title={t("browse-hint")}
        onClick={() => setOpen(true)}
      >
        <ListPlus className="size-4" />
        {t("browse")}
      </Button>
      {open ? (
        <RulePresetDialog
          open
          onOpenChange={setOpen}
          code={first.code}
          presets={presets}
          onInstalled={onInstalled}
        />
      ) : null}
    </>
  );
}
