"use client";

import { useTranslations } from "next-intl";
import React, { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DrawerDialog } from "@/components/ui/dialog-responsive";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/Typography";
import useUpdatePortfolio from "@/lib/api/portfolio/useUpdatePortfolio";
import { ALLOCATION_PRESETS } from "@/lib/portfolio/allocation-presets";
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
): Record<string, string> {
  const initial: Record<string, string> = {};
  for (const assetClass of assetClasses) {
    initial[assetClass] = String(currentTargets?.[assetClass] ?? 0);
  }
  return initial;
}

const PortfolioTargetAllocationEditor: React.FC<
  PortfolioTargetAllocationEditorProps
> = ({ isOpen, closeModal, portfolioId, currentAssetClasses, currentTargets }) => {
  const t = useTranslations();
  const formatPercentage = useFormatPercentage();
  const updatePortfolio = useUpdatePortfolio();
  const allAssetClasses = useMemo(
    () => [
      ...new Set([...currentAssetClasses, ...Object.keys(currentTargets ?? {})]),
    ],
    [currentAssetClasses, currentTargets],
  );

  const [targets, setTargets] = useState<Record<string, string>>(() =>
    buildTargetInputs(allAssetClasses, currentTargets),
  );
  // Re-seed the inputs when the saved targets or asset classes change,
  // adjusting during render rather than in an effect. Compared by content: the
  // parent builds `currentAssetClasses` fresh on every render.
  const seedKey = JSON.stringify([allAssetClasses, currentTargets ?? null]);
  const [seededKey, setSeededKey] = useState(seedKey);
  if (seedKey !== seededKey) {
    setSeededKey(seedKey);
    setTargets(buildTargetInputs(allAssetClasses, currentTargets));
  }

  const total = Object.values(targets).reduce(
    (sum, v) => sum + (Number(v) || 0),
    0,
  );

  const applyPreset = (presetTargets: Record<string, number>) => {
    const next: Record<string, string> = {};
    for (const assetClass of allAssetClasses) {
      next[assetClass] = String(presetTargets[assetClass] ?? 0);
    }
    setTargets(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const allocation: Record<string, number> = {};
    for (const [key, val] of Object.entries(targets)) {
      const num = Number(val);
      if (num > 0) allocation[key] = num;
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
          <div key={assetClass} className="flex items-center justify-between gap-3">
            <Text className="text-sm font-medium">{assetClass}</Text>
            <div className="flex items-center gap-1">
              <Input
                type="number"
                min="0"
                max="100"
                step="0.1"
                className="w-20 text-right"
                value={targets[assetClass] || "0"}
                onChange={(e) =>
                  setTargets((prev) => ({ ...prev, [assetClass]: e.target.value }))
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
            {formatPercentage(total / 100, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
          </Text>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={closeModal}>
            {t("cancel")}
          </Button>
          <Button type="submit" disabled={updatePortfolio.isPending}>
            {t("save")}
          </Button>
        </div>
      </form>
    </DrawerDialog>
  );
};

export default PortfolioTargetAllocationEditor;
