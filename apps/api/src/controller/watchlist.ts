import type { RequiredEntityData } from '@mikro-orm/core';
import type { Request, Response } from 'express';

import { DI } from '@app/app';
import { Appuser } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import { FinancialAsset } from '@entity/FinancialAsset';
import { Tenant } from '@entity/Tenant';
import { Watchlist } from '@entity/Watchlist';
import { BadRequestError } from '@utils/errors';
import { watchlistSymbolParamSchema } from '@validators/financial-markets';
import { zParse } from '@validators/parser';

export async function addToWatchlist(req: Request, res: Response) {
  const { params: { symbol } } = await zParse(watchlistSymbolParamSchema, req);
  const normalizedSymbol = symbol.toUpperCase();
  const { appuser, tenant } = await getWatchlistContext(req);
  // Idempotent: adding a symbol already on the list is a no-op (the unique
  // constraint on (appuser, symbol) also guards against duplicates).
  const existing = await DI.em.findOne(Watchlist, {
    appuserKey: appuser,
    symbol: normalizedSymbol,
    tenantKey: tenant,
  });
  if (!existing) {
    const item = DI.em.create(Watchlist, {
      appuserKey: appuser,
      symbol: normalizedSymbol,
      tenantKey: tenant,
    } as RequiredEntityData<Watchlist>);
    await DI.em.persist(item).flush();
  }
  return res.sendStatus(204);
}

export async function getWatchlist(req: Request, res: Response) {
  const { appuser, tenant } = await getWatchlistContext(req);
  const items = await DI.em.find(
    Watchlist,
    { appuserKey: appuser, tenantKey: tenant },
    { orderBy: { createdAt: 'asc' } },
  );
  const symbols = items.map((item) => item.symbol);
  const logos = await loadLogoUrls(symbols);
  // `symbols` stays for older clients; `items` adds each symbol's logo where a known asset has one.
  return res.json({ items: symbols.map((symbol) => ({ logoUrl: logos.get(symbol) ?? null, symbol })), symbols });
}

/** Logo URLs of the assets whose symbol is on the list (symbols are unique per asset). */
export async function removeFromWatchlist(req: Request, res: Response) {
  const { params: { symbol } } = await zParse(watchlistSymbolParamSchema, req);
  const { appuser, tenant } = await getWatchlistContext(req);
  await DI.em.nativeDelete(Watchlist, {
    appuserKey: appuser,
    symbol: symbol.toUpperCase(),
    tenantKey: tenant,
  });
  return res.sendStatus(204);
}

async function getWatchlistContext(req: Request): Promise<{ appuser: Appuser; tenant: Tenant }> {
  if (!req.user) {
    throw new BadRequestError('User not found');
  }
  const appuserTenant = await DI.em.getRepository(AppuserTenant).getAppuserTenantByAppuser(req.user);
  if (!appuserTenant) {
    throw new BadRequestError("User doesn't have AppuserTenant");
  }
  return { appuser: req.user, tenant: appuserTenant.tenantKey };
}

async function loadLogoUrls(symbols: string[]): Promise<Map<string, string>> {
  if (symbols.length === 0) return new Map();
  const assets = await DI.em.find(FinancialAsset, { deletedAt: undefined, symbol: { $in: symbols } }, { fields: ['symbol', 'logoUrl'] });
  return new Map(assets.flatMap((asset) => (asset.logoUrl ? [[asset.symbol, asset.logoUrl] as const] : [])));
}
