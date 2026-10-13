"use client";

import { useTranslations } from "next-intl";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/Alert";
import type { PortfolioImportSessionPreviewResponse } from "@/lib/api/portfolio/importSessionTypes";
import { getPortfolioImportUnsupportedAssetWarnings } from "@/lib/portfolio/import-session-unsupported-assets";

interface PortfolioImportUnsupportedAssetsAlertProps {
  unsupportedAssets?: PortfolioImportSessionPreviewResponse["summary"]["unsupportedAssets"];
}

export function PortfolioImportUnsupportedAssetsAlert({
  unsupportedAssets,
}: PortfolioImportUnsupportedAssetsAlertProps) {
  const t = useTranslations();
  const warnings = getPortfolioImportUnsupportedAssetWarnings(unsupportedAssets);

  if (!warnings.length) return null;

  return (
    <Alert variant="warning">
      <AlertTitle>{t("portfolio-import-unsupported-assets-title")}</AlertTitle>
      <AlertDescription>
        <ul className="list-disc space-y-1 pl-4">
          {warnings.map(({ symbol, skippedRows }) => (
            <li key={symbol}>
              {t("portfolio-import-unsupported-asset-warning", {
                count: skippedRows,
                symbol,
              })}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
