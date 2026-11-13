"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/Label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { Text } from "@/components/ui/Typography";
import { getApiErrorMessage, isDemoReadOnlyError } from "@/lib/api/errors";
import {
  type RulePresetInstallResult,
  type RulePresetSummary,
  useInstallRulePreset,
  useRulePresetPreview,
} from "@/lib/api/rule/useRulePresets";
import { invalidateRules } from "@/lib/api/rule/useRules";
import { presetRuleParts } from "@/lib/rules/preset-rule";
import { getCategoryDisplayName } from "@/lib/utils/categories";

/** The preset's name in the reader's language (the country it covers). */
export function usePresetName() {
  const t = useTranslations("rulePresets");
  return (code: string) => (t.has(`names.${code}`) ? t(`names.${code}`) : code);
}

/**
 * Everything a locale rule preset would add, rule by rule, and the one button
 * that adds it. Rules the household already has (by name) are shown as such
 * and skipped. Nothing is written until the person confirms.
 */
export function RulePresetDialog({
  open,
  onOpenChange,
  code: initialCode,
  presets,
  onInstalled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  code: string;
  /** Every preset, so the person can look at another country's. */
  presets: RulePresetSummary[];
  onInstalled?: (result: RulePresetInstallResult) => void;
}) {
  const t = useTranslations("rulePresets");
  const tRoot = useTranslations();
  const presetName = usePresetName();
  const queryClient = useQueryClient();
  const [code, setCode] = useState(initialCode);
  const preview = useRulePresetPreview(open ? code : null);
  const install = useInstallRulePreset();

  const rules = preview.data?.rules ?? [];
  const toAdd = rules.filter((rule) => rule.status === "new").length;

  const onConfirm = async () => {
    try {
      const result = await install.mutateAsync(code);
      await invalidateRules(queryClient);
      toast.success(t("installed", { count: result.created.length }));
      onOpenChange(false);
      onInstalled?.(result);
    } catch (error) {
      if (isDemoReadOnlyError(error)) {
        toast.error(tRoot("demo-read-only-title"), {
          description: tRoot("demo-read-only-description"),
        });
        return;
      }
      toast.error(getApiErrorMessage(error) ?? t("install-error"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {t("dialog.title", { name: presetName(code) })}
          </DialogTitle>
          <DialogDescription>{t("dialog.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {presets.length > 1 ? (
            <div className="space-y-2">
              <Label htmlFor="rule-preset-choice">{t("dialog.choose")}</Label>
              <Select value={code} onValueChange={setCode}>
                <SelectTrigger id="rule-preset-choice" className="sm:w-72">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {presets.map((preset) => (
                    <SelectItem key={preset.code} value={preset.code}>
                      {presetName(preset.code)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {preview.isLoading ? (
            <p className="flex items-center gap-2 text-sm">
              <Spinner />
              {t("dialog.loading")}
            </p>
          ) : preview.isError ? (
            <Text role="alert" className="text-destructive-text text-sm">
              {t("dialog.error")}
            </Text>
          ) : (
            <ul
              aria-label={t("dialog.list-label", { name: presetName(code) })}
              className="divide-border border-border divide-y rounded-md border"
            >
              {rules.map((rule) => {
                const parts = presetRuleParts(rule);
                return (
                  <li
                    key={rule.name}
                    className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                  >
                    <div className="min-w-0">
                      <p
                        className={
                          rule.status === "new"
                            ? "text-sm font-medium"
                            : "text-muted-foreground text-sm font-medium"
                        }
                      >
                        {rule.name}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {[
                          t("dialog.matches", {
                            values: parts.matches.join(", "),
                          }),
                          ...parts.excludes.map((value) =>
                            t("dialog.excludes", { value }),
                          ),
                        ].join(" ")}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
                      {parts.category ? (
                        <span>
                          {getCategoryDisplayName(tRoot, parts.category)}
                        </span>
                      ) : null}
                      {parts.merchant ? (
                        <span className="text-muted-foreground">
                          {t("dialog.merchant", { name: parts.merchant })}
                        </span>
                      ) : null}
                      {rule.status !== "new" ? (
                        <Badge variant="muted">
                          {t(`status.${rule.status}`)}
                        </Badge>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {preview.data && toAdd === 0 ? (
            <Text variant="mutedText">{t("dialog.nothing")}</Text>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
          >
            {tRoot("cancel")}
          </Button>
          <Button
            type="button"
            loading={install.isPending}
            disabled={!preview.data || toAdd === 0 || install.isPending}
            onClick={() => void onConfirm()}
          >
            {t("dialog.install", { count: toAdd })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
