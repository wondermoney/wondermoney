import type { EntityManager, RequiredEntityData } from '@mikro-orm/core';
import { UniqueConstraintViolationException } from '@mikro-orm/core';

import { DI } from '@app/app';
import { Currency } from '@entity/Currency';
import { FinancialAsset } from '@entity/FinancialAsset';
import { FinancialAssetExchange } from '@entity/FinancialAssetExchange';
import { FinancialAssetType } from '@entity/FinancialAssetType';
import eodhd from '@service/market-data/eodhd.service';
import { BadRequestError, InternalServerError } from '@utils/errors';
import logger from '@utils/logger';

import { syncStockSplitsForAsset } from './stock-split-sync.service.js';

interface MappedAssetFields {
  currencyCode: string;
  exchangeShortName: string;
  isin: string;
  name: string;
  resolvedTypeName: 'ETF' | 'Mutual Fund' | 'Stock';
  symbol: string;
}

// Row type is inferred (EodhdTypes.SearchResult) rather than annotated
// explicitly: @wondermoney/shared@8.1.0's bundled .d.ts re-exports the eodhd
// package's SearchResult *interface* as a namespaced value, so
// `EodhdTypes.SearchResult` cannot be referenced in a type position (TS2749).
// `eodhd.search()`'s own return type is unaffected and correctly infers this
// shape — see financial-markets.ts / portfolio-import-asset-resolution.service.ts
// for the same pattern elsewhere in this migration.
//
// EODHD's search Type field isn't a fixed enum in the SDK's own types (typed as
// plain, always-present `string`) — it's been observed as free text like
// "Common Stock", "ETF", "Fund". Match loosely rather than exact-string, and
// default unrecognized values to Stock.
export function mapProfileToAssetFields(profile: Awaited<ReturnType<typeof eodhd.search>>[number]): MappedAssetFields {
  // Defensive: the SDK types Type as a required string, but the live API can
  // still omit or null it at runtime (e.g. a search result missing profile
  // data) — widen to `string | null | undefined` so this guard is a real
  // check rather than a lint-flagged dead condition, and avoid an unhandled
  // TypeError surfacing as a 500 during on-demand asset creation or CSV
  // import.
  const rawType = profile.Type as null | string | undefined;
  const type = rawType?.toLowerCase() ?? '';
  let resolvedTypeName: 'ETF' | 'Mutual Fund' | 'Stock' = 'Stock';
  if (type.includes('etf')) resolvedTypeName = 'ETF';
  else if (type.includes('fund')) resolvedTypeName = 'Mutual Fund';

  return {
    currencyCode: profile.Currency,
    exchangeShortName: profile.Exchange,
    isin: profile.ISIN,
    name: profile.Name,
    resolvedTypeName,
    symbol: profile.Code,
  };
}

/**
 * Returns an existing FinancialAsset for the given symbol, or creates one
 * on-demand from EODHD search data if it doesn't exist yet.
 *
 * Handles concurrent creation races: if two requests create the same symbol
 * simultaneously, the unique constraint violation is caught and we fall back
 * to finding the record that the other request inserted.
 */
export async function resolveOrCreateFinancialAsset(symbol: string, options: { em?: EntityManager; skipStockSplitSync?: boolean } = {}): Promise<FinancialAsset> {
  const em = options.em ?? DI.em;
  const existing = await em.findOne(FinancialAsset, { symbol });
  if (existing) return existing;

  // Fetch profile from EODHD search (Fundamentals-tier profile data — cik,
  // cusip, logo, isActivelyTrading — is not available on this plan; those
  // fields are left unset and the FinancialAsset entity's own defaults apply).
  const results = await eodhd.search(symbol);
  const profile = results.find((row) => row.Code.toUpperCase() === symbol.toUpperCase()) ?? results[0];
  if (!profile) {
    throw new BadRequestError(`Unknown symbol: ${symbol}`);
  }

  const fields = mapProfileToAssetFields(profile);

  const fork = options.em ? em : DI.em.fork();
  try {
    const forkCurrency = await fork.findOne(Currency, { code: fields.currencyCode });
    // Resolve the EODHD exchange code (e.g. 'US', 'LSE', 'F', 'TO') against the
    // existing FinancialAssetExchangeAlias pivot table, which already maps a
    // broad set of upstream-style codes (US, LSE, AMS, MIL, JP, TYO, XETRA-style
    // ones, etc.) to the seeded acronyms (NYSE, NASDAQ, LON, XAMS, …). Match on
    // either the seeded acronym or any alias name in a single query, so newly-
    // created holdings pick up an exchange attribution for every EODHD-sourced
    // code currently covered by the alias seeder. Codes that have no alias row
    // yet (e.g. 'XETRA', 'STU', 'BA', 'BK', 'HM') will still resolve to
    // undefined and fall through to the graceful `?? undefined` below — the
    // alias seeder can be extended in a follow-up to cover those.
    const eodhdExchangeCode = fields.exchangeShortName;
    const forkExchange = await fork.findOne(FinancialAssetExchange, {
      $or: [{ acronym: eodhdExchangeCode }, { aliases: { name: eodhdExchangeCode } }],
    });
    const forkAssetType = await fork.findOne(FinancialAssetType, { name: fields.resolvedTypeName });
    if (!forkCurrency) throw new BadRequestError(`Unsupported currency: ${fields.currencyCode}`);
    if (!forkAssetType) throw new BadRequestError(`Unsupported asset type: ${fields.resolvedTypeName}`);

    fork.create(FinancialAsset, {
      currencyKey: forkCurrency,
      financialAssetExchangeKey: forkExchange ?? undefined,
      financialAssetTypeKey: forkAssetType,
      isin: fields.isin || undefined,
      name: fields.name,
      symbol: fields.symbol,
    } as RequiredEntityData<FinancialAsset>);
    await fork.flush();
    logger.info({ symbol }, 'Created financial asset on demand');
  } catch (err) {
    if (options.em || !(err instanceof UniqueConstraintViolationException)) throw err;
    fork.clear();
    const created = await fork.findOne(FinancialAsset, { symbol });
    if (!created) {
      const existingAfterConflict = await DI.em.findOne(FinancialAsset, { symbol });
      if (!existingAfterConflict) throw new InternalServerError(`Race condition on symbol ${symbol}: asset not found after conflict`);
    }
  }

  const asset = await em.findOne(FinancialAsset, { symbol });
  if (!asset) throw new InternalServerError(`Created asset for ${symbol} not found in request entity manager`);
  if (!options.skipStockSplitSync) {
    try {
      await syncStockSplitsForAsset(asset);
    } catch (err) {
      logger.warn({ err, symbol }, 'Failed to sync stock splits for newly created asset');
    }
  }
  return asset;
}
