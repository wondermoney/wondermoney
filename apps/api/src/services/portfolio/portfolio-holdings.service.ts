import { type Kysely, sql } from 'kysely';

import { DI } from '@app/app';
import { FINANCIAL_TRANSACTION_TYPES } from '@app/constants/financial-transaction-types';
import { anyOf, type SqlDatabase, sqlQuery } from '@app/database/sql';
import type { Appuser } from '@entity/Appuser';
import logger from '@utils/logger';

import assetPriceService from './asset-price.service';
import { enrichSavingsCertificateHoldings, isSavingsCertificateBatch } from './certificado-aforro-holdings.service';
import { resolveHoldingCurrentMetrics } from './portfolio-currency.utils';
import {
  aggregateBatchesIntoAssets,
  buildSplitAdjustedHoldingBatches,
  getPortfolioAssetInvalidKey,
  type HoldingBatch,
  type HoldingTimelineItem,
  type PortfolioAsset,
  type PortfolioHolding,
  recomputeAllocation,
  replayHoldingTimeline,
} from './portfolio-holdings.utils';

export interface RealizedGains {
  /**
   * Assets with a fee that could not be converted and was counted as zero. A fully sold asset
   * has no holding to carry `feeConversionIncomplete`, so the scope-level list is the only place
   * it shows. Present only when non-empty.
   */
  feeConversionIncompleteAssetKeys?: number[];
  totalCostBasisOfSold: number;
  totalRealizedGains: number;
}

type FeeConversion = { amount: number } | { reason: string };

/**
 * Service for calculating portfolio holdings using FIFO batch tracking.
 *
 * FIFO (First In, First Out) means when selling, the oldest purchase lots are sold first.
 * This is the standard method for tax calculation in Portugal and many other jurisdictions.
 */
class PortfolioHoldingsService {
  private async getPortfolioTransactionRows(appuserKey: number, portfolioId?: number, tenantKey?: number): Promise<{
    splitRows: Record<string, unknown>[];
    transactionRows: Record<string, unknown>[];
  }> {
    const db = sqlQuery(DI.em);
    const rawTransactionRows: Record<string, unknown>[] = await db
      .selectFrom('financial_transaction as ft')
      .innerJoin('financial_asset as fa', 'ft.financial_asset_key', 'fa.financial_asset_key')
      .innerJoin('portfolio as p', 'ft.portfolio_key', 'p.portfolio_key')
      .leftJoin('currency as c', 'fa.currency_key', 'c.currency_key')
      .leftJoin('currency as fee_c', 'ft.fee_currency_key', 'fee_c.currency_key')
      .leftJoin('currency as settlement_c', 'ft.settlement_currency_key', 'settlement_c.currency_key')
      .leftJoin('currency as original_c', 'ft.original_currency_key', 'original_c.currency_key')
      .leftJoin('appuser as au', 'ft.appuser_key', 'au.appuser_key')
      .leftJoin('currency as appuser_c', 'au.currency_key', 'appuser_c.currency_key')
      .leftJoin('financial_asset_type as fat', 'fa.financial_asset_type_key', 'fat.financial_asset_type_key')
      .select([
        'ft.financial_asset_key',
        'ft.portfolio_key',
        'ft.transaction_key',
        'ft.transaction_date',
        'ft.financial_transaction_type_key',
        'ft.quantity',
        'ft.appuser_unit_amount',
        'ft.appuser_settlement_amount',
        'ft.settlement_amount',
        'ft.settlement_unit_amount',
        'ft.fee_amount',
        'ft.settlement_exchange_rate',
        'ft.appuser_currency_exchange_rate',
        'fee_c.code as fee_currency_code',
        'settlement_c.code as settlement_currency_code',
        'original_c.code as original_currency_code',
        'ft.transaction_date',
        'appuser_c.code as appuser_currency_code',
        'fee_c.currency_key as fee_currency_key',
        'settlement_c.currency_key as settlement_currency_key',
        'original_c.currency_key as original_currency_key',
        'appuser_c.currency_key as appuser_currency_key',
        'c.code as financial_asset_currency_code',
        'fa.name as financial_asset_name',
        'fa.symbol as financial_asset_symbol',
        'fat.name as financial_asset_type_name',
        'fa.logo_url as financial_asset_logo_url',
        'fa.esg_score as financial_asset_esg_score',
        'p.name as portfolio_name',
      ])
      // Household scope when a tenant is supplied (request path, raw SQL bypasses
      // the filter); otherwise fall back to appuser scope (worker/snapshot path).
      .where((eb) =>
        tenantKey == null
          ? eb('ft.appuser_key', '=', appuserKey)
          // Keep both sides of the relationship tenant-scoped. The transaction tenant is
          // the normal request predicate, while the portfolio predicate makes an explicit
          // portfolio lookup safe even if upstream portfolio validation regresses or a
          // legacy transaction has a stale tenant key.
          : eb.and([eb('ft.tenant_key', '=', tenantKey), eb('p.tenant_key', '=', tenantKey)]))
      .where('ft.deleted_at', 'is', null)
      .where('ft.financial_transaction_type_key', 'in', [FINANCIAL_TRANSACTION_TYPES.BUY, FINANCIAL_TRANSACTION_TYPES.SELL])
      .$if(portfolioId != null, (query) => query.where('ft.portfolio_key', '=', portfolioId))
      .execute();

    // An asset with no resolved FinancialAssetType (unreachable through normal app
    // creation paths today, but possible via the type FK's `on delete set null`) must still
    // surface as a holding — the left join above keeps the row, this coalesce keeps it labeled.
    const transactionRows = rawTransactionRows.map(
      (row): Record<string, unknown> => ({
        ...row,
        financial_asset_type_name: row['financial_asset_type_name'] ?? 'Unclassified',
      }),
    );

    await Promise.all(transactionRows.map(async (row) => {
      const conversion = await convertFeeToAccountingCurrency(row, db);
      if ('amount' in conversion) {
        row['fee_accounting_amount'] = conversion.amount;
        return;
      }
      // One fee we cannot convert must not make the whole portfolio unreadable: count it as
      // zero, flag its asset (feeConversionIncomplete) and leave a trace to repair the data.
      row['fee_accounting_amount'] = 0;
      row['fee_conversion_incomplete'] = true;
      logger.warn(
        { feeCurrency: row['fee_currency_code'] ?? null, financialAssetKey: row['financial_asset_key'], reason: conversion.reason, transactionKey: row['transaction_key'] },
        'Portfolio fee left out of gains: it cannot be converted to the accounting currency',
      );
    }));

    const assetKeys = [...new Set(transactionRows.map((row) => Number(row['financial_asset_key'])).filter(Number.isFinite))];
    const splitRows = assetKeys.length > 0
      ? await db
          .selectFrom('financial_asset_stock_adjustment as fasa')
          .select(['fasa.financial_asset_key', 'fasa.date', 'fasa.numerator', 'fasa.denominator', 'fasa.split_ratio'])
          .where('fasa.adjustment_type', '=', 'SPLIT')
          .where('fasa.deleted_at', 'is', null)
          .where(anyOf('fasa.financial_asset_key', assetKeys))
          .execute()
      : [];

    return { splitRows, transactionRows };
  }

  /**
   * Get financial transaction batches with FIFO remaining quantities.
   *
   * Algorithm:
   * 1. For each asset, assign row numbers to BUY transactions (in_row) ordered by date
   * 2. Calculate total quantity sold (total_quantity_out) per asset
   * 3. Self-join to compute running cumulative buys (running_in_quantity) for each lot
   * 4. Determine remaining quantity per lot by comparing cumulative buys vs total sells
   *
   * Example: Buy 100, Buy 50, Sell 120
   * - Lot 1: running_in=100, total_out=120 → remaining = 0 (fully sold)
   * - Lot 2: running_in=150, total_out=120 → remaining = 150-120 = 30
   */
  private getFinancialTransactionBatchesFromRows(
    transactionRows: Record<string, unknown>[],
    splitRows: Record<string, unknown>[],
  ): HoldingBatch[] {

    const timeline: HoldingTimelineItem[] = [
      ...transactionRows.map((row) => ({
        fee_amount: Number(row['fee_accounting_amount'] ?? 0),
        financial_asset_currency_code: row['financial_asset_currency_code'] as string | undefined,
        financial_asset_esg_score: row['financial_asset_esg_score'] as number | string | undefined,
        financial_asset_key: Number(row['financial_asset_key']),
        financial_asset_logo_url: row['financial_asset_logo_url'] as string | undefined,
        financial_asset_name: String(row['financial_asset_name']),
        financial_asset_symbol: String(row['financial_asset_symbol']),
        financial_asset_type_name: String(row['financial_asset_type_name']),
        financial_transaction_type_key: Number(row['financial_transaction_type_key']),
        itemType: 'TRANSACTION' as const,
        portfolio_key: Number(row['portfolio_key']),
        quantity: Number(row['quantity']),
        transaction_date: new Date(String(row['transaction_date'])),
        transaction_key: Number(row['transaction_key']),
        unit_appuser_amount: row['appuser_unit_amount'] == null ? row['appuser_unit_amount'] : Number(row['appuser_unit_amount']),
        unit_settlement_amount: Number(row['settlement_unit_amount']),
      })),
      ...splitRows.map((row) => ({
        date: new Date(String(row['date'])),
        denominator: row['denominator'] == null ? Number.NaN : Number(row['denominator']),
        financial_asset_key: Number(row['financial_asset_key']),
        itemType: 'SPLIT' as const,
        numerator: row['numerator'] == null ? Number.NaN : Number(row['numerator']),
        split_ratio: row['split_ratio'] == null ? undefined : Number(row['split_ratio']),
      })),
    ];

    return buildSplitAdjustedHoldingBatches(timeline);
  }

  private getInvalidHoldingsFromRows(
    transactionRows: Record<string, unknown>[],
    splitRows: Record<string, unknown>[],
    currency: string,
  ): PortfolioHolding[] {

    const holdingsByKey = new Map<string, { assetCurrencyCode?: string; assetKey: number; assetLogoUrl?: string; assetName: string; assetSymbol: string; assetType: string; portfolioKey: number; portfolioName: string; relatedTransactionKeys: number[]; timeline: HoldingTimelineItem[] }>();
    for (const row of transactionRows) {
      const portfolioKey = Number(row['portfolio_key']);
      const assetKey = Number(row['financial_asset_key']);
      const key = getPortfolioAssetInvalidKey(portfolioKey, assetKey);
      const entry = holdingsByKey.get(key) ?? {
        assetCurrencyCode: row['financial_asset_currency_code'] as string | undefined,
        assetKey,
        assetLogoUrl: row['financial_asset_logo_url'] as string | undefined,
        assetName: String(row['financial_asset_name'] ?? ''),
        assetSymbol: String(row['financial_asset_symbol'] ?? ''),
        assetType: String(row['financial_asset_type_name'] ?? ''),
        portfolioKey,
        portfolioName: String(row['portfolio_name'] ?? ''),
        relatedTransactionKeys: [],
        timeline: [],
      };
      entry.relatedTransactionKeys.push(Number(row['transaction_key']));
      entry.timeline.push({
        financial_asset_key: assetKey,
        financial_asset_name: entry.assetName,
        financial_asset_symbol: entry.assetSymbol,
        financial_asset_type_name: entry.assetType,
        financial_transaction_type_key: Number(row['financial_transaction_type_key']),
        itemType: 'TRANSACTION',
        portfolio_key: portfolioKey,
        quantity: Number(row['quantity']),
        transaction_date: new Date(String(row['transaction_date'])),
        transaction_key: Number(row['transaction_key']),
        unit_settlement_amount: 0,
      });
      holdingsByKey.set(key, entry);
    }

    for (const row of splitRows) {
      const assetKey = Number(row['financial_asset_key']);
      for (const entry of holdingsByKey.values()) {
        if (entry.assetKey !== assetKey) continue;
        entry.timeline.push({
          date: new Date(String(row['date'])),
          denominator: row['denominator'] == null ? Number.NaN : Number(row['denominator']),
          financial_asset_key: assetKey,
          itemType: 'SPLIT',
          numerator: row['numerator'] == null ? Number.NaN : Number(row['numerator']),
          split_ratio: row['split_ratio'] == null ? undefined : Number(row['split_ratio']),
        });
      }
    }

    const invalidHoldings: PortfolioHolding[] = [];
    for (const entry of holdingsByKey.values()) {
      const { oversoldByPortfolioAsset } = replayHoldingTimeline(entry.timeline);
      const oversold = oversoldByPortfolioAsset.get(getPortfolioAssetInvalidKey(entry.portfolioKey, entry.assetKey)) ?? 0;

      if (oversold <= 0) continue;

      invalidHoldings.push({
        allocation: null,
        averageBuyPrice: 0,
        currency,
        currentPrice: null,
        currentValue: null,
        financialAssetCurrencyCode: entry.assetCurrencyCode,
        financialAssetKey: entry.assetKey,
        financialAssetLogoUrl: entry.assetLogoUrl,
        financialAssetName: entry.assetName,
        financialAssetSymbol: entry.assetSymbol,
        financialAssetType: entry.assetType,
        invalidReason: 'NEGATIVE_UNITS',
        isInvalid: true,
        portfolioKey: entry.portfolioKey,
        portfolioName: entry.portfolioName,
        quantity: -Math.abs(oversold),
        relatedTransactionKeys: entry.relatedTransactionKeys,
        unrealizedGains: null,
        unrealizedGainsPercentage: null,
      });
    }

    return invalidHoldings;
  }

  /**
   * Add current prices and calculate gains/allocation for holdings
   */
  private async enrichHoldingsWithPrices(portfolioAssets: PortfolioAsset[], currency = 'USD'): Promise<PortfolioHolding[]> {
    const assetsCurrentPrice = await assetPriceService.getCurrentAssetPrices();

    const assetCurrencyCodes = [...new Set(portfolioAssets.map((p) => p.financialAssetCurrencyCode).filter(Boolean))] as string[];
    const exchangeRateRows = assetCurrencyCodes.length > 0
      ? await sqlQuery(DI.em)
          .selectFrom('exchange_rate as er')
          .innerJoin('currency as from_c', 'er.from_currency_key', 'from_c.currency_key')
          .innerJoin('currency as to_c', 'er.to_currency_key', 'to_c.currency_key')
          .innerJoin(
            sql<{ from_currency_key: unknown; max_date: unknown; to_currency_key: unknown }>`(SELECT from_currency_key, to_currency_key, MAX(date) as max_date FROM exchange_rate GROUP BY from_currency_key, to_currency_key)`.as('latest'),
            (join) =>
              join
                .onRef('er.from_currency_key', '=', 'latest.from_currency_key')
                .onRef('er.to_currency_key', '=', 'latest.to_currency_key')
                .onRef('er.date', '=', 'latest.max_date'),
          )
          .select(['from_c.code as from_currency_code', 'er.rate'])
          .where(anyOf('from_c.code', assetCurrencyCodes))
          .where('to_c.code', '=', currency)
          .execute()
      : [];

    const exchangeRateMap = new Map<string, number>();
    for (const row of exchangeRateRows as { from_currency_code: string; rate: string }[]) {
      exchangeRateMap.set(row.from_currency_code, Number(row.rate));
    }

    const assetsPrices = portfolioAssets.map((p) => {
      const currentPrice = assetsCurrentPrice.find((x) => x.financial_asset_key === p.financialAssetKey);
      const conversionRate = p.financialAssetCurrencyCode && p.financialAssetCurrencyCode !== currency
        ? exchangeRateMap.get(p.financialAssetCurrencyCode)
        : 1;
      const { currentPrice: normalizedCurrentPrice, currentValue, unrealizedGains, unrealizedGainsPercentage } =
        resolveHoldingCurrentMetrics({
          assetType: p.financialAssetType,
          averageBuyPrice: p.averageBuyPrice,
          conversionRate,
          quantity: p.quantity,
          rawCurrentPrice: currentPrice?.price ?? null,
        });

      return {
        ...p,
        allocation: null,
        currency,
        currentPrice: normalizedCurrentPrice,
        currentValue,
        unrealizedGains,
        unrealizedGainsPercentage,
      };
    });

    // Calculate allocation
    const totalInvestmentCurrentValue = assetsPrices.reduce((acc, cur) => acc + (cur.currentValue ?? 0), 0);
    return assetsPrices.map((p) => ({
      ...p,
      allocation:
        p.currentValue && totalInvestmentCurrentValue > 0 ? (p.currentValue / totalInvestmentCurrentValue) * 100 : null,
    }));
  }

  /**
   * Combines FIFO batches into priced holdings. Savings Certificate batches are branched off
   * *before* `aggregateBatchesIntoAssets` — that aggregation collapses multiple lots of the same
   * asset into one weighted-average `PortfolioAsset` and discards each lot's own
   * `transaction_date`, but Certificado de Aforro valuation needs each lot's own subscription
   * date. `enrichHoldingsWithPrices` (market-price path) and
   * `enrichSavingsCertificateHoldings` (per-lot accrual path) compute `allocation` against only
   * the holdings passed to them, so `recomputeAllocation` re-derives it across the full combined
   * set before returning — otherwise every non-CA holding's allocation would overstate its share.
   */
  private async buildHoldingsFromOpenBatches(
    batches: HoldingBatch[],
    invalidHoldings: PortfolioHolding[],
    invalidKeys: Set<string>,
    currency: string,
  ): Promise<PortfolioHolding[]> {
    const openBatches = batches.filter((batch) => !invalidKeys.has(getPortfolioAssetInvalidKey(batch.portfolio_key, batch.financial_asset_key)));
    const savingsCertificateBatches = openBatches.filter(isSavingsCertificateBatch);
    const otherBatches = openBatches.filter((batch) => !isSavingsCertificateBatch(batch));

    const portfolioAssets = aggregateBatchesIntoAssets(otherBatches);
    const [enrichedOther, enrichedSavingsCertificates] = await Promise.all([
      this.enrichHoldingsWithPrices(portfolioAssets, currency),
      enrichSavingsCertificateHoldings(savingsCertificateBatches, currency),
    ]);
    const combined = recomputeAllocation([...enrichedOther, ...enrichedSavingsCertificates]);
    return [...combined, ...invalidHoldings];
  }

  /**
   * Get holdings for a specific portfolio
   */
  async getPortfolioHoldings(appuser: Appuser, portfolioId: number, tenantKey?: number): Promise<PortfolioHolding[]> {
    const { splitRows, transactionRows } = await this.getPortfolioTransactionRows(appuser.appuserKey, portfolioId, tenantKey);
    const currency = appuser.currencyKey.code || 'EUR';
    const batches = this.getFinancialTransactionBatchesFromRows(transactionRows, splitRows);
    const invalidHoldings = this.getInvalidHoldingsFromRows(transactionRows, splitRows, currency);
    const invalidKeys = new Set(
      invalidHoldings.map((holding) => getPortfolioAssetInvalidKey(holding.portfolioKey!, holding.financialAssetKey)),
    );
    return flagIncompleteFeeConversions(await this.buildHoldingsFromOpenBatches(batches, invalidHoldings, invalidKeys, currency), transactionRows);
  }

  private async getInvalidHoldings(appuserKey: number, currency: string, portfolioId?: number): Promise<PortfolioHolding[]> {
    const { splitRows, transactionRows } = await this.getPortfolioTransactionRows(appuserKey, portfolioId);
    return this.getInvalidHoldingsFromRows(transactionRows, splitRows, currency);
  }

  /**
   * Get holdings across all portfolios for a user
   */
  async getPortfoliosHoldings(appuser: Appuser, tenantKey?: number): Promise<PortfolioHolding[]> {
    const { splitRows, transactionRows } = await this.getPortfolioTransactionRows(appuser.appuserKey, undefined, tenantKey);
    const currency = appuser.currencyKey.code || 'EUR';
    const batches = this.getFinancialTransactionBatchesFromRows(transactionRows, splitRows);
    const invalidHoldings = this.getInvalidHoldingsFromRows(transactionRows, splitRows, currency);
    const invalidKeys = new Set(
      invalidHoldings.map((holding) => getPortfolioAssetInvalidKey(holding.portfolioKey!, holding.financialAssetKey)),
    );
    return flagIncompleteFeeConversions(await this.buildHoldingsFromOpenBatches(batches, invalidHoldings, invalidKeys, currency), transactionRows);
  }

  /**
   * Get total dividend income for a portfolio or all portfolios
   */
  async getDividendIncome(
    appuserKey: number,
    portfolioId?: number,
    tenantKey?: number,
  ): Promise<{ byAsset: { financialAssetKey: number; symbol: string; totalDividends: number }[]; totalDividends: number }> {
    const rows = (await sqlQuery(DI.em)
      .selectFrom('financial_transaction as ft')
      .innerJoin('financial_asset as fa', 'ft.financial_asset_key', 'fa.financial_asset_key')
      .leftJoin('appuser as au', 'ft.appuser_key', 'au.appuser_key')
      .select([
        'fa.financial_asset_key',
        'fa.symbol',
        // The converted amount is only stored for a dividend settled in another currency than the
        // user's; one settled in the user's own currency counts at its settlement amount.
        sql<string>`SUM(COALESCE(ft.appuser_settlement_amount, CASE WHEN ft.settlement_currency_key = au.currency_key THEN ft.settlement_amount END))`.as('total_dividends'),
      ])
      .where('ft.financial_transaction_type_key', '=', FINANCIAL_TRANSACTION_TYPES.DIVIDEND)
      // Household scope when a tenant is supplied (request path, raw SQL bypasses
      // the filter); otherwise fall back to appuser scope (worker/snapshot path).
      .where((eb) => (tenantKey == null ? eb('ft.appuser_key', '=', appuserKey) : eb('ft.tenant_key', '=', tenantKey)))
      .where('ft.deleted_at', 'is', null)
      .$if(Boolean(portfolioId), (query) => query.where('ft.portfolio_key', '=', portfolioId))
      .groupBy(['fa.financial_asset_key', 'fa.symbol'])
      .execute()) as { financial_asset_key: number; symbol: string; total_dividends: string }[];

    const byAsset = rows.map((r) => ({
      financialAssetKey: r.financial_asset_key,
      symbol: r.symbol,
      totalDividends: Number(r.total_dividends),
    }));

    const totalDividends = byAsset.reduce((sum, a) => sum + a.totalDividends, 0);

    return { byAsset, totalDividends };
  }
  /**
   * Calculate portfolio-weighted ESG score
   */
  calculatePortfolioEsgScore(holdings: PortfolioHolding[]): null | number {
    const holdingsWithEsg = holdings.filter((h) => h.financialAssetEsgScore != null && h.currentValue != null);
    if (holdingsWithEsg.length === 0) return null;

    const totalValue = holdingsWithEsg.reduce((sum, h) => sum + (h.currentValue || 0), 0);
    if (totalValue === 0) return null;

    return holdingsWithEsg.reduce((score, h) => {
      const weight = (h.currentValue || 0) / totalValue;
      return score + weight * Number(h.financialAssetEsgScore);
    }, 0);
  }

  /**
   * Calculate realized gains from FIFO sell transactions.
   * Compares total sell proceeds against cost basis of fully sold FIFO lots.
   */
  async getRealizedGains(
    appuserKey: number,
    portfolioId?: number,
    tenantKey?: number,
  ): Promise<RealizedGains> {
    const { splitRows, transactionRows } = await this.getPortfolioTransactionRows(appuserKey, portfolioId, tenantKey);
    const invalidHoldings = this.getInvalidHoldingsFromRows(transactionRows, splitRows, 'EUR');
    const invalidKeys = new Set(
      invalidHoldings.map((holding) => getPortfolioAssetInvalidKey(holding.portfolioKey!, holding.financialAssetKey)),
    );

    const totalSellProceeds = transactionRows
      .filter((row) => Number(row['financial_transaction_type_key']) === FINANCIAL_TRANSACTION_TYPES.SELL)
      .filter((row) => !invalidKeys.has(getPortfolioAssetInvalidKey(Number(row['portfolio_key']), Number(row['financial_asset_key']))))
      .reduce((sum, row) => {
        const settlementAmount = row['appuser_settlement_amount'] ?? row['settlement_amount'] ?? 0;
        return sum + Math.abs(Number(settlementAmount)) - Number(row['fee_accounting_amount'] ?? 0);
      }, 0);

    const timeline: HoldingTimelineItem[] = [
      ...transactionRows.map((row) => ({
        fee_amount: Number(row['fee_accounting_amount'] ?? 0),
        financial_asset_currency_code: row['financial_asset_currency_code'] as string | undefined,
        financial_asset_esg_score: row['financial_asset_esg_score'] as number | string | undefined,
        financial_asset_key: Number(row['financial_asset_key']),
        financial_asset_logo_url: row['financial_asset_logo_url'] as string | undefined,
        financial_asset_name: String(row['financial_asset_name']),
        financial_asset_symbol: String(row['financial_asset_symbol']),
        financial_asset_type_name: String(row['financial_asset_type_name']),
        financial_transaction_type_key: Number(row['financial_transaction_type_key']),
        itemType: 'TRANSACTION' as const,
        portfolio_key: Number(row['portfolio_key']),
        quantity: Number(row['quantity']),
        transaction_date: new Date(String(row['transaction_date'])),
        transaction_key: Number(row['transaction_key']),
        unit_appuser_amount: row['appuser_unit_amount'] == null ? row['appuser_unit_amount'] : Number(row['appuser_unit_amount']),
        unit_settlement_amount: Number(row['settlement_unit_amount']),
      })),
      ...splitRows.map((row) => ({
        date: new Date(String(row['date'])),
        denominator: row['denominator'] == null ? Number.NaN : Number(row['denominator']),
        financial_asset_key: Number(row['financial_asset_key']),
        itemType: 'SPLIT' as const,
        numerator: row['numerator'] == null ? Number.NaN : Number(row['numerator']),
        split_ratio: row['split_ratio'] == null ? undefined : Number(row['split_ratio']),
      })),
    ];
    const costBasisOfSold = [...replayHoldingTimeline(timeline).realizedCostBasisByPortfolioAsset.entries()]
      .filter(([key]) => !invalidKeys.has(key))
      .reduce((sum, [, value]) => sum + value, 0);

    const feeConversionIncompleteAssetKeys = getFeeConversionIncompleteAssetKeys(
      transactionRows.filter((row) => !invalidKeys.has(getPortfolioAssetInvalidKey(Number(row['portfolio_key']), Number(row['financial_asset_key'])))),
    );

    return {
      ...(feeConversionIncompleteAssetKeys.length > 0 ? { feeConversionIncompleteAssetKeys } : {}),
      totalCostBasisOfSold: costBasisOfSold,
      totalRealizedGains: totalSellProceeds - costBasisOfSold,
    };
  }
}

/**
 * Converts a transaction's fee into the currency its gains are counted in: the appuser
 * currency when the row carries appuser amounts, otherwise the settlement currency.
 */
async function convertFeeToAccountingCurrency(row: Record<string, unknown>, db: Kysely<SqlDatabase>): Promise<FeeConversion> {
  if (String(row['financial_asset_type_name']) === 'Savings Certificate') return { amount: 0 };
  const fee = Math.abs(Number(row['fee_amount'] ?? 0));
  if (!fee) return { amount: 0 };
  const feeCode = row['fee_currency_code'] as string | undefined;
  if (!feeCode) return { reason: 'non-zero fee without a fee currency' };
  const usesAppuserAmount = Number(row['financial_transaction_type_key']) === FINANCIAL_TRANSACTION_TYPES.SELL
    ? row['appuser_settlement_amount'] != null
    : row['appuser_unit_amount'] != null;
  const accountingCode = usesAppuserAmount
    ? row['appuser_currency_code'] as string | undefined
    : row['settlement_currency_code'] as string | undefined;
  if (!accountingCode) return { reason: 'accounting currency could not be resolved' };
  if (feeCode === accountingCode) return { amount: fee };

  const settlementCode = row['settlement_currency_code'] as string | undefined;
  const appuserRateValue = row['appuser_currency_exchange_rate'];
  const missingStoredRate = (from: string | undefined) => ({ reason: `missing transaction-time exchange rate from ${from ?? 'unknown'} to ${accountingCode}` });
  if (feeCode === settlementCode) {
    if (!isValidFeeExchangeRate(appuserRateValue)) return missingStoredRate(settlementCode);
    return { amount: fee * Number(appuserRateValue) };
  }
  const originalCode = row['original_currency_code'] as string | undefined;
  if (feeCode === originalCode) {
    const settlementRateValue = row['settlement_exchange_rate'];
    if (!isValidFeeExchangeRate(settlementRateValue)) return missingStoredRate(originalCode);
    if (settlementCode === accountingCode) return { amount: fee * Number(settlementRateValue) };
    if (!isValidFeeExchangeRate(appuserRateValue)) return missingStoredRate(settlementCode);
    return { amount: fee * Number(settlementRateValue) * Number(appuserRateValue) };
  }
  const rateRow = await db
    .selectFrom('exchange_rate')
    .select('rate')
    .where('from_currency_key', '=', Number(row['fee_currency_key']))
    .where('to_currency_key', '=', Number(usesAppuserAmount ? row['appuser_currency_key'] : row['settlement_currency_key']))
    .where('date', '<=', new Date(String(row['transaction_date'])))
    .orderBy('date', 'desc')
    .limit(1)
    .executeTakeFirst() as undefined | { rate?: number | string };
  if (!isValidFeeExchangeRate(rateRow?.rate)) return { reason: `missing historical exchange rate from ${feeCode} to ${accountingCode}` };
  return { amount: fee * Number(rateRow?.rate) };
}

function getFeeConversionIncompleteAssetKeys(transactionRows: Record<string, unknown>[]): number[] {
  return [...new Set(
    transactionRows.filter((row) => row['fee_conversion_incomplete'] === true).map((row) => Number(row['financial_asset_key'])),
  )].toSorted((a, b) => a - b);
}

/** Marks every holding of an asset that has a fee we could not convert. */
function flagIncompleteFeeConversions(holdings: PortfolioHolding[], transactionRows: Record<string, unknown>[]): PortfolioHolding[] {
  const assetKeys = new Set(getFeeConversionIncompleteAssetKeys(transactionRows));
  if (assetKeys.size === 0) return holdings;
  return holdings.map((holding) => (assetKeys.has(holding.financialAssetKey) ? { ...holding, feeConversionIncomplete: true } : holding));
}

function isValidFeeExchangeRate(rate: unknown): boolean {
  if (rate == null) return false;
  const value = Number(rate);
  return Number.isFinite(value) && value > 0;
}

export default new PortfolioHoldingsService();
