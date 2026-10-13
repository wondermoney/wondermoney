"use client";

import { useTranslations } from "next-intl";
import React from "react";

import { Card } from "@/components/ui/card";
import { Text } from "@/components/ui/Typography";

interface PortfolioAllocationGuidanceProps {
  guidanceText: string | null | undefined;
}

const PortfolioAllocationGuidance: React.FC<PortfolioAllocationGuidanceProps> = ({
  guidanceText,
}) => {
  const t = useTranslations();

  if (!guidanceText) {
    return null;
  }

  return (
    <Card className="flex flex-col gap-1 p-4">
      <Text className="text-sm">{guidanceText}</Text>
      <Text className="text-muted-foreground text-xs">
        {t("portfolio-allocation-guidance-disclaimer")}
      </Text>
    </Card>
  );
};

export default PortfolioAllocationGuidance;
