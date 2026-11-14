import type { Request, Response } from 'express';

import { DI } from '@app/database/di';
import { getMarketDataSources } from '@service/market-data/price-sources.service';

/**
 * The market-data providers this server lists (`MARKET_DATA_PROVIDERS`) and where the prices of
 * the last week came from. Shared catalogue data, admin-gated with the rest of `/v1/admin`.
 */
export async function getAdminMarketDataSources(_req: Request, res: Response): Promise<Response> {
  return res.json(await getMarketDataSources(DI.em));
}
