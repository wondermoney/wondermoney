import { isMarketDataEnabled } from '@service/market-data/eodhd.service';
import { resolveOrCreateFinancialAsset } from '@service/portfolio/financial-asset.service';
import logger from '@utils/logger';

import type { AssetRef } from './restore-format';

/**
 * An asset a restored portfolio trades, from the market-data catalogue: its `financial_asset` key,
 * added to this server's asset list when the catalogue has it. Null without market data, or when
 * the catalogue's best match is a different asset (another symbol and another ISIN), so a restore
 * never files a trade under the wrong security.
 */
export async function resolveCatalogueAsset(asset: AssetRef): Promise<null | number> {
  if (!isMarketDataEnabled()) return null;
  try {
    const found = await resolveOrCreateFinancialAsset(asset.symbol);
    const sameSymbol = found.symbol.toUpperCase() === asset.symbol.toUpperCase();
    const sameIsin = asset.isin !== null && found.isin === asset.isin;
    return sameSymbol || sameIsin ? found.financialAssetKey : null;
  } catch (error) {
    logger.info({ error, symbol: asset.symbol }, 'Restore could not find an asset in the catalogue');
    return null;
  }
}
