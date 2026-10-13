"use client";

import { Info } from "lucide-react";
import { useTranslations } from "next-intl";
import React from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/Alert";
import type { UnclassifiedHolding } from "@/lib/api/portfolio/usePortfolioAllocation";

interface PortfolioUnclassifiedHoldingsBannerProps {
  holdings: UnclassifiedHolding[] | undefined;
}

const PortfolioUnclassifiedHoldingsBanner: React.FC<
  PortfolioUnclassifiedHoldingsBannerProps
> = ({ holdings }) => {
  const t = useTranslations();

  if (!holdings?.length) {
    return null;
  }

  return (
    <Alert>
      <Info className="h-4 w-4" />
      <AlertTitle>{t("unclassified-holdings-title")}</AlertTitle>
      <AlertDescription>
        <p>{t("unclassified-holdings-description")}</p>
        <ul className="mt-2 list-disc pl-5">
          {holdings.map((holding) => (
            <li key={holding.name}>{holding.name}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
};

export default PortfolioUnclassifiedHoldingsBanner;
