"use client";

import { useTranslations } from "next-intl";
import React from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Text } from "@/components/ui/Typography";
import { ALLOCATION_PRESETS } from "@/lib/portfolio/allocation-presets";

interface PortfolioAllocationEmptyStateProps {
  onApplyPreset: (targets: Record<string, number>) => void;
  onCustomize: () => void;
}

const PortfolioAllocationEmptyState: React.FC<PortfolioAllocationEmptyStateProps> = ({
  onApplyPreset,
  onCustomize,
}) => {
  const t = useTranslations();

  return (
    <Card className="flex flex-col items-center gap-3 p-6 text-center">
      <Text className="text-sm font-medium">
        {t("portfolio-allocation-set-target-title")}
      </Text>
      <Text className="text-muted-foreground text-sm">
        {t("portfolio-allocation-set-target-description")}
      </Text>
      <div className="flex flex-wrap justify-center gap-2 pt-1">
        {ALLOCATION_PRESETS.map((preset) => (
          <Button
            key={preset.key}
            variant="outline"
            size="sm"
            onClick={() => onApplyPreset(preset.targets)}
          >
            {t(`allocation-preset-${preset.key}`)}
          </Button>
        ))}
        <Button variant="ghost" size="sm" onClick={onCustomize}>
          {t("allocation-customize")}
        </Button>
      </div>
    </Card>
  );
};

export default PortfolioAllocationEmptyState;
