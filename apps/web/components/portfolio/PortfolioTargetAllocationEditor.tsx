"use client";

import { useLocale, useTranslations } from "next-intl";
import React, { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DrawerDialog } from "@/components/ui/dialog-responsive";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/Typography";
import useUpdatePortfolio from "@/lib/api/portfolio/useUpdatePortfolio";
import { ALLOCATION_PRESETS } from "@/lib/portfolio/allocation-presets";
import { formatLocaleNumberInput, parseLocaleNumber } from "@/lib/utils/number";
import { useFormatPercentage } from "@/lib/utils/useFormatPercentage";

interface PortfolioTargetAllocationEditorProps {
  isOpen: boolean;
  closeModal: () => void;
  portfolioId: number;
  currentAssetClasses: string[];
  currentTargets: Record<string, number> | null | undefined;
}

function buildTargetInputs(
  assetClasses: string[],
  currentTargets: Record<string, number> | null | undefined,
  locale: string,
): Record<string, string> {
  const initial: Record<string, string> = {};
  for (const assetClass of assetClasses) {
    initial[assetClass] = formatLocaleNumberInput(
      currentTargets?.[assetClass] ?? 0,
      locale,
    );
  }
  return initial;
}

/**
 * A target percentage typed in the reader's locale ("12,5" for pt and es).
 * Blank is 0; anything unreadable or outside 0-100 is null, so the form refuses
 * to save it rather than storing another figure.
 */
function parseTarget(value: string, locale: string): number | null {
  if (!value.trim()) return 0;
  const parsed = parseLocaleNumber(value, locale);
  return parsed !== null && parsed >= 0 && parsed <= 100 ? parsed : null;
}

const PortfolioTargetAllocationEditor: React.FC<
  PortfolioTargetAllocationEditorProps
> = ({
  isOpen,
  closeModal,
  portfolioId,
  currentAssetClasses,
  currentTargets,
}) => {
  const t = useTranslations();
  const locale = useLocale();
  const formatPercentage = useFormatPercentage();
  const updatePortfolio = useUpdatePortfolio();
  const allAssetClasses = useMemo(
    () => [
      ...new Set([
        ...currentAssetClasses,
        ...Object.keys(currentTargets ?? {}),
      ]),
    ],
    [currentAssetClasses, currentTargets],
  );

  const [targets, setTargets] = useState<Record<string, string>>(() =>
    buildTargetInputs(allAssetClasses, currentTargets, locale),
  );
  // Re-seed the inputs when the saved targets or asset classes change,
  // adjusting during render rather than in an effect. Compared by content: the
  // parent builds `currentAssetClasses` fresh on every render.
  const seedKey = JSON.stringify([
    allAssetClasses,
    currentTargets ?? null,
    locale,
  ]);
  const [seededKey, setSeededKey] = useState(seedKey);
  if (seedKey !== seededKey) {
    setSeededKey(seedKey);
    setTargets(buildTargetInputs(allAssetClasses, currentTargets, locale));
  }

  const parsedTargets = Object.fromEntries(
    Object.entries(targets).map(([key, value]) => [
      key,
      parseTarget(value, locale),
    ]),
  );
  const hasInvalidTarget = Object.values(parsedTargets).some((v) => v === null);
  const total = Object.values(parsedTargets).reduce<number>(
    (sum, v) => sum + (v ?? 0),
    0,
  );

  const applyPreset = (presetTargets: Record<string, number>) => {
    const next: Record<string, string> = {};
    for (const assetClass of allAssetClasses) {
      next[assetClass] = formatLocaleNumberInput(
        presetTargets[assetClass] ?? 0,
        locale,
      );
    }
    setTargets(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (hasInvalidTarget) return;
    const allocation: Record<string, number> = {};
    for (const [key, num] of Object.entries(parsedTargets)) {
      if (num !== null && num > 0) allocation[key] = num;
    }
    try {
      await updatePortfolio.mutateAsync({
        portfolioId,
        targetAllocation:
          Object.keys(allocation).length > 0 ? allocation : null,
      });
      toast.success(t("save"));
      closeModal();
    } catch {
      toast.error(t("server-error"));
    }
  };

  return (
    <DrawerDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) closeModal();
      }}
      title={t("target-allocation")}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {ALLOCATION_PRESETS.map((preset) => (
            <Button
              key={preset.key}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => applyPreset(preset.targets)}
            >
              {t(`allocation-preset-${preset.key}`)}
            </Button>
          ))}
        </div>

        {allAssetClasses.map((assetClass) => (
          <div
            key={assetClass}
            className="flex items-center justify-between gap-3"
          >
            <Text className="text-sm font-medium">{assetClass}</Text>
            <div className="flex items-center gap-1">
              <Input
                inputMode="decimal"
                aria-invalid={parsedTargets[assetClass] === null}
                className="w-20 text-right"
                value={targets[assetClass] || "0"}
                onChange={(e) =>
                  setTargets((prev) => ({
                    ...prev,
                    [assetClass]: e.target.value,
                  }))
                }
              />
              <Text className="text-sm">%</Text>
            </div>
          </div>
        ))}

        <div className="flex items-center justify-between border-t pt-2">
          <Text className="text-sm font-semibold">{t("total")}</Text>
          <Text
            className={`text-sm font-semibold ${Math.abs(total - 100) > 0.1 ? "text-destructive-text" : "text-success-text"}`}
          >
            {formatPercentage(total / 100, {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            })}
          </Text>
        </div>

        {hasInvalidTarget && (
          <Text role="alert" className="text-destructive-text text-sm">
            {t("invalid-value")}
          </Text>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={closeModal}>
            {t("cancel")}
          </Button>
          <Button
            type="submit"
            disabled={updatePortfolio.isPending || hasInvalidTarget}
          >
            {t("save")}
          </Button>
        </div>
      </form>
    </DrawerDialog>
  );
};

export default PortfolioTargetAllocationEditor;
