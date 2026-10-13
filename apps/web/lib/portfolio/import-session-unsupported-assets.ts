import type { PortfolioImportSessionPreviewResponse } from "@/lib/api/portfolio/importSessionTypes";

type UnsupportedAsset = NonNullable<
  PortfolioImportSessionPreviewResponse["summary"]["unsupportedAssets"]
>[number];

const SAFE_SYMBOL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:=/^+-]{0,63}$/;

export function getPortfolioImportUnsupportedAssetWarnings(
  unsupportedAssets?: UnsupportedAsset[],
) {
  return (unsupportedAssets ?? []).flatMap(({ symbol, skippedRows }) => {
    const safeSymbol = symbol.trim();
    if (
      !SAFE_SYMBOL_PATTERN.test(safeSymbol) ||
      !Number.isFinite(skippedRows) ||
      skippedRows <= 0
    ) {
      return [];
    }

    return [{ symbol: safeSymbol, skippedRows: Math.floor(skippedRows) }];
  });
}
