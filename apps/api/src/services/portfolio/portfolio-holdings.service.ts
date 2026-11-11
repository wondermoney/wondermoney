import type { Big } from 'big.js';
import { type Kysely, sql } from 'kysely';

import { DI } from '@app/app';
import { FINANCIAL_TRANSACTION_TYPES } from '@app/constants/financial-transaction-types';
import { PortfolioCostBasisMethod } from '@app/constants/portfolio-cost-basis';
import { anyOf, type SqlDatabase, sqlQuery } from '@app/database/sql';
import type { Appuser } from '@entity/Appuser';
import { FEED_RATES_ONLY } from '@service/currency/exchange-rate';
import { completenessFromCounts, currencyKeySql, loadDailyRates, type ReportCompleteness, type UnconvertedCount } from '@service/reports/report-currency';
import logger from '@utils/logger';
import { big, roundDisplay, sumMoney } from '@utils/money';

import assetPriceService from './asset-price.service';
import { enrichSavingsCertificateHoldings, isSavingsCertificateBatch } from './certificado-aforro-holdings.service';
import { resolveHoldingCurrentMetrics } from './portfolio-currency.utils';
import {
  aggregateBatchesIntoAssets,
  buildSplitAdjustedHoldingBatches,
  type CostBasisMethodResolver,
  getPortfolioAssetInvalidKey,
  type HoldingBatch,
  type HoldingTimelineItem,
  type PortfolioAsset,
  type PortfolioHolding,
  recomputeAllocation,
  replayHoldingTimeline,
} from './portfolio-holdings.utils';
import type { InvestmentCashFlow } from './portfolio-metrics.utils';
import { type PortfolioValue, valuePortfolioHoldings } from './portfolio-value';

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

/** Dividend income in the viewer's currency (`completeness.currencyCode`). */
export interface DividendIncome {
  byAsset: { financialAssetKey: number; symbol: string; totalDividends: number }[];
  /** The dividends left out of the totals because no rate converts them. */
  completeness: ReportCompleteness;
  totalDividends: number;
}

/** One purchase lot as the holding-detail lots view reads it. */
export interface HoldingLot {
  /** The purchase date, ISO 8601. For an AVERAGE pool, the earliest open lot's date. */
  date: string;
  /** The fee recorded on the purchase (split does not change it). */
  fees: number;
  /** The lot's quantity at purchase, split-adjusted. */
  quantity: number;
  /** What is still open from this lot. */
  remainingQuantity: number;
  status: 'CLOSED' | 'OPEN';
  /** The buy that created the lot; null for the single AVERAGE pooled position. */
  transactionKey: null | number;
  /** Per-unit cost excluding fees; with `fees`, this is the lot's cost basis. */
  unitCost: number;
}

export interface HoldingLots {
  /** All-in cost per open unit (fees included), matching the holding's `averageBuyPrice`. */
  averageUnitCost: null | number;
  costBasisMethod: PortfolioCostBasisMethod;
  lots: HoldingLot[];
  /** Cost basis of the open position, fees included. */
  openCostBasis: number;
  openQuantity: number;
  /** Cost relieved by sales so far, under this portfolio's method. */
  realizedCostBasis: number;
}

type FeeConversion = { amount: number } | { reason: string };

/**
 * Service for calculating portfolio holdings from purchase lots.
 *
 * A portfolio's `costBasisMethod` decides how a sale relieves cost. FIFO (First In, First Out)
 * sells the oldest lots first, the standard method in Portugal and Spain. AVERAGE relieves the
 * running average of the open position, as in Brazil. Both run through `replayHoldingTimeline`.
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
        'p.cost_basis_method as cost_basis_method',
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
    costBasisMethod: CostBasisMethodResolver,
  ): HoldingBatch[] {
    return buildSplitAdjustedHoldingBatches(this.buildTimelineFromRows(transactionRows, splitRows), costBasisMethod);
  }

  /** The replay timeline for a set of transaction and split rows. */
  private buildTimelineFromRows(
    transactionRows: Record<string, unknown>[],
    splitRows: Record<string, unknown>[],
  ): HoldingTimelineItem[] {
    return [
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
  }

  /**
   * The portfolio's method per row, so one replay can span portfolios with different methods
   * (the aggregate holdings read). Rows carry the portfolio's `cost_basis_method`; a missing
   * value (legacy/partial fixtures) is FIFO.
   */
  private costBasisMethodFromRows(transactionRows: Record<string, unknown>[]): (portfolioKey: number) => PortfolioCostBasisMethod {
    const byPortfolio = new Map<number, PortfolioCostBasisMethod>();
    for (const row of transactionRows) {
      const portfolioKey = Number(row['portfolio_key']);
      if (byPortfolio.has(portfolioKey)) continue;
      byPortfolio.set(
        portfolioKey,
        row['cost_basis_method'] === PortfolioCostBasisMethod.AVERAGE
          ? PortfolioCostBasisMethod.AVERAGE
          : PortfolioCostBasisMethod.FIFO,
      );
    }
    return (portfolioKey) => byPortfolio.get(portfolioKey) ?? PortfolioCostBasisMethod.FIFO;
  }

  private getInvalidHoldingsFromRows(
    transactionRows: Record<string, unknown>[],
    splitRows: Record<string, unknown>[],
    currency: string,
    costBasisMethod: CostBasisMethodResolver,
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
      const { oversoldByPortfolioAsset } = replayHoldingTimeline(entry.timeline, costBasisMethod);
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
    const costBasisMethod = this.costBasisMethodFromRows(transactionRows);
    const batches = this.getFinancialTransactionBatchesFromRows(transactionRows, splitRows, costBasisMethod);
    const invalidHoldings = this.getInvalidHoldingsFromRows(transactionRows, splitRows, currency, costBasisMethod);
    const invalidKeys = new Set(
      invalidHoldings.map((holding) => getPortfolioAssetInvalidKey(holding.portfolioKey!, holding.financialAssetKey)),
    );
    return flagIncompleteFeeConversions(await this.buildHoldingsFromOpenBatches(batches, invalidHoldings, invalidKeys, currency), transactionRows);
  }

  private async getInvalidHoldings(appuserKey: number, currency: string, portfolioId?: number): Promise<PortfolioHolding[]> {
    const { splitRows, transactionRows } = await this.getPortfolioTransactionRows(appuserKey, portfolioId);
    const costBasisMethod = this.costBasisMethodFromRows(transactionRows);
    return this.getInvalidHoldingsFromRows(transactionRows, splitRows, currency, costBasisMethod);
  }

  /**
   * Get holdings across all portfolios for a user
   */
  async getPortfoliosHoldings(appuser: Appuser, tenantKey?: number): Promise<PortfolioHolding[]> {
    const { splitRows, transactionRows } = await this.getPortfolioTransactionRows(appuser.appuserKey, undefined, tenantKey);
    const currency = appuser.currencyKey.code || 'EUR';
    const costBasisMethod = this.costBasisMethodFromRows(transactionRows);
    const batches = this.getFinancialTransactionBatchesFromRows(transactionRows, splitRows, costBasisMethod);
    const invalidHoldings = this.getInvalidHoldingsFromRows(transactionRows, splitRows, currency, costBasisMethod);
    const invalidKeys = new Set(
      invalidHoldings.map((holding) => getPortfolioAssetInvalidKey(holding.portfolioKey!, holding.financialAssetKey)),
    );
    return flagIncompleteFeeConversions(await this.buildHoldingsFromOpenBatches(batches, invalidHoldings, invalidKeys, currency), transactionRows);
  }

  /**
   * The open and closed purchase lots of one holding, under the portfolio's cost basis method.
   * Under AVERAGE the open lots are one pooled position: its quantity, average unit cost and
   * remaining fees. Null when the portfolio has no trades in this asset (the caller 404s).
   */
  async getHoldingLots(
    appuser: Appuser,
    portfolioId: number,
    financialAssetKey: number,
    tenantKey?: number,
  ): Promise<HoldingLots | null> {
    const { splitRows, transactionRows } = await this.getPortfolioTransactionRows(appuser.appuserKey, portfolioId, tenantKey);
    const assetRows = transactionRows.filter((row) => Number(row['financial_asset_key']) === financialAssetKey);
    if (assetRows.length === 0) return null;
    const method = this.costBasisMethodFromRows(assetRows)(portfolioId);
    const replay = replayHoldingTimeline(
      this.buildTimelineFromRows(
        assetRows,
        splitRows.filter((row) => Number(row['financial_asset_key']) === financialAssetKey),
      ),
      method,
    );
    const realizedCostBasis = replay.realizedCostBasisByPortfolioAsset.get(getPortfolioAssetInvalidKey(portfolioId, financialAssetKey)) ?? 0;
    const openBatches = replay.openBatches;
    const openQuantity = openBatches.reduce((sum, batch) => sum + (batch.remaining_batch ?? 0), 0);
    const openFees = openBatches.reduce((sum, batch) => sum + (batch.remaining_fee_amount ?? 0), 0);
    const openUnitCosts = openBatches.reduce(
      (sum, batch) => sum + (batch.unit_appuser_amount ?? batch.unit_settlement_amount) * (batch.remaining_batch ?? 0),
      0,
    );
    const openCostBasis = openUnitCosts + openFees;

    if (method === PortfolioCostBasisMethod.AVERAGE) {
      const firstDate = openBatches.reduce<Date | null>(
        (earliest, batch) => (!earliest || batch.transaction_date < earliest ? batch.transaction_date : earliest),
        null,
      );
      return {
        averageUnitCost: openQuantity > 0 ? openCostBasis / openQuantity : null,
        costBasisMethod: method,
        lots: openQuantity > 0 && firstDate
          ? [{
            date: firstDate.toISOString(),
            fees: openFees,
            quantity: openQuantity,
            remainingQuantity: openQuantity,
            status: 'OPEN',
            transactionKey: null,
            unitCost: openQuantity > 0 ? openUnitCosts / openQuantity : 0,
          }]
          : [],
        openCostBasis,
        openQuantity,
        realizedCostBasis,
      };
    }

    return {
      averageUnitCost: openQuantity > 0 ? openCostBasis / openQuantity : null,
      costBasisMethod: method,
      lots: replay.allBatches.map((batch) => ({
        date: batch.transaction_date.toISOString(),
        fees: batch.fee_amount ?? 0,
        quantity: batch.quantity,
        remainingQuantity: batch.remaining_batch ?? 0,
        status: (batch.remaining_batch ?? 0) > 0 ? 'OPEN' : 'CLOSED',
        transactionKey: batch.transaction_key,
        unitCost: batch.unit_appuser_amount ?? batch.unit_settlement_amount,
      })),
      openCostBasis,
      openQuantity,
      realizedCostBasis,
    };
  }

  /**
   * Current value of each portfolio (see `valuePortfolioHoldings`), keyed by portfolio key.
   * One portfolio at a time, because holdings across portfolios merge per asset.
   */
  async getPortfolioValues(appuser: Appuser, portfolioKeys: number[], tenantKey?: number): Promise<Map<number, PortfolioValue>> {
    const values = new Map<number, PortfolioValue>();
    for (const portfolioKey of portfolioKeys) {
      values.set(portfolioKey, valuePortfolioHoldings(await this.getPortfolioHoldings(appuser, portfolioKey, tenantKey)));
    }
    return values;
  }

  /**
   * Every buy, sale and dividend as a dated cash flow for `viewer` (see InvestmentCashFlow), oldest
   * first, for money-weighted returns. Trades are priced exactly as the holdings and realized gains
   * price them: a buy at its quantity times its unit amount plus its converted fee, a sale at its
   * proceeds less its fee. A dividend counts at the stored amount dividend income reads it at
   * ({@link dividendSourceAmount}), so the two agree for every member. Each flow carries its
   * currency (`currencyCode`) for the reader to convert into the viewer's. With `tenantKey`, the
   * household's flows, otherwise the viewer's own; with `portfolioKey`, only that portfolio's.
   */
  async getInvestmentCashFlows(viewer: Appuser, tenantKey?: number, portfolioKey?: number): Promise<InvestmentCashFlow[]> {
    const appuserKey = viewer.appuserKey;
    const { transactionRows } = await this.getPortfolioTransactionRows(appuserKey, portfolioKey, tenantKey);
    const dividend = dividendSourceAmount(viewer.currencyKey.currencyKey);
    const dividendRows = (await sqlQuery(DI.em)
      .selectFrom('financial_transaction as ft')
      .innerJoin('portfolio as p', 'ft.portfolio_key', 'p.portfolio_key')
      .leftJoin('appuser as au', 'ft.appuser_key', 'au.appuser_key')
      .leftJoin('currency as member_c', 'au.currency_key', 'member_c.currency_key')
      .leftJoin('currency as settlement_c', 'ft.settlement_currency_key', 'settlement_c.currency_key')
      .select(['ft.transaction_date', dividend.amount.as('amount'), dividend.currencyCode.as('currency_code')])
      .where('ft.financial_transaction_type_key', '=', FINANCIAL_TRANSACTION_TYPES.DIVIDEND)
      // Household scope when a tenant is supplied (raw SQL bypasses the filter), on both the
      // transaction and its portfolio as for trades; otherwise appuser scope.
      .where((eb) =>
        tenantKey == null
          ? eb('ft.appuser_key', '=', appuserKey)
          : eb.and([eb('ft.tenant_key', '=', tenantKey), eb('p.tenant_key', '=', tenantKey)]))
      .where('ft.deleted_at', 'is', null)
      .$if(portfolioKey != null, (query) => query.where('ft.portfolio_key', '=', portfolioKey))
      .execute()) as Record<string, unknown>[];

    // Each flow carries the currency its amount is in, as gains count it: the recording member's
    // when the row holds a converted amount, else the settlement currency. Its fee is already
    // converted into that currency (`fee_accounting_amount`).
    const codeOf = (value: unknown) => (typeof value === 'string' ? value : null);
    const flows: InvestmentCashFlow[] = [];
    for (const row of transactionRows) {
      const date = new Date(String(row['transaction_date']));
      const fee = Number(row['fee_accounting_amount'] ?? 0);
      if (Number(row['financial_transaction_type_key']) === FINANCIAL_TRANSACTION_TYPES.BUY) {
        const converted = row['appuser_unit_amount'] != null;
        const unitAmount = converted ? row['appuser_unit_amount'] : row['settlement_unit_amount'];
        const currencyCode = codeOf(converted ? row['appuser_currency_code'] : row['settlement_currency_code']);
        flows.push({ amount: -(Math.abs(Number(row['quantity'])) * Number(unitAmount) + fee), currencyCode, date, kind: 'BUY' });
      } else {
        const converted = row['appuser_settlement_amount'] != null;
        const proceeds = Math.abs(Number((converted ? row['appuser_settlement_amount'] : row['settlement_amount']) ?? 0));
        const currencyCode = codeOf(converted ? row['appuser_currency_code'] : row['settlement_currency_code']);
        flows.push({ amount: proceeds - fee, currencyCode, date, kind: 'SELL' });
      }
    }
    // A dividend in the currency of the amount it is read at, for the reader to convert or report
    // as unknown; it is never dropped.
    for (const row of dividendRows) {
      if (row['amount'] == null) continue;
      flows.push({ amount: Math.abs(Number(row['amount'])), currencyCode: codeOf(row['currency_code']), date: new Date(String(row['transaction_date'])), kind: 'DIVIDEND' });
    }
    return flows.toSorted((a, b) => a.date.getTime() - b.date.getTime());
  }

  /**
   * Every dividend received, per asset and in total, in the viewer's currency. A dividend counts at
   * the stored amount {@link dividendSourceAmount} picks: exact when one is already in the viewer's
   * currency, otherwise converted into it at the rate of the dividend's UTC day. One with no rate is
   * left out of both totals and counted in `completeness`, never added at face value. With
   * `tenantKey`, the household's dividends; otherwise the viewer's own (worker path). With
   * `portfolioId`, that portfolio's only.
   */
  async getDividendIncome(viewer: Appuser, portfolioId?: number, tenantKey?: number): Promise<DividendIncome> {
    if (!viewer.currencyKey.code) await DI.em.populate(viewer, ['currencyKey']);
    const viewerCurrency = viewer.currencyKey.code;
    // Summed per asset, currency and UTC day (rates are daily), so each day's sum is converted once.
    const day = sql<string>`to_char(ft.transaction_date AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;
    const { amount, currencyCode } = dividendSourceAmount(viewer.currencyKey.currencyKey);
    const rows = (await sqlQuery(DI.em)
      .selectFrom('financial_transaction as ft')
      .innerJoin('financial_asset as fa', 'ft.financial_asset_key', 'fa.financial_asset_key')
      .leftJoin('appuser as au', 'ft.appuser_key', 'au.appuser_key')
      .leftJoin('currency as member_c', 'au.currency_key', 'member_c.currency_key')
      .leftJoin('currency as settlement_c', 'ft.settlement_currency_key', 'settlement_c.currency_key')
      .select([
        'fa.financial_asset_key',
        'fa.symbol',
        currencyCode.as('currency_code'),
        day.as('day'),
        sql<string>`SUM(${amount})`.as('amount'),
        sql<string>`COUNT(*)`.as('transactions'),
      ])
      .where('ft.financial_transaction_type_key', '=', FINANCIAL_TRANSACTION_TYPES.DIVIDEND)
      // Household scope when a tenant is supplied (request path, raw SQL bypasses
      // the filter); otherwise fall back to appuser scope (worker/snapshot path).
      .where((eb) => (tenantKey == null ? eb('ft.appuser_key', '=', viewer.appuserKey) : eb('ft.tenant_key', '=', tenantKey)))
      .where('ft.deleted_at', 'is', null)
      .where(sql<boolean>`${amount} IS NOT NULL`)
      .$if(Boolean(portfolioId), (query) => query.where('ft.portfolio_key', '=', portfolioId))
      .groupBy(['fa.financial_asset_key', 'fa.symbol', currencyCode, day])
      .orderBy('fa.financial_asset_key')
      .execute()) as { amount: string; currency_code: null | string; day: string; financial_asset_key: number; symbol: string; transactions: string }[];

    const rateFor = await loadDailyRates(DI.em, viewerCurrency, rows.flatMap((row) => (row.currency_code == null ? [] : [{ currencyCode: row.currency_code, day: row.day }])), FEED_RATES_ONLY);
    const unconverted: UnconvertedCount[] = [];
    const byAssetKey = new Map<number, { financialAssetKey: number; symbol: string; total: Big }>();
    for (const row of rows) {
      const asset = byAssetKey.get(row.financial_asset_key) ?? { financialAssetKey: row.financial_asset_key, symbol: row.symbol, total: big(0) };
      byAssetKey.set(row.financial_asset_key, asset);
      // A row that records no currency cannot be read in the viewer's; one with no rate neither.
      const rate = row.currency_code == null ? null : rateFor({ currencyCode: row.currency_code, day: row.day });
      if (rate == null) {
        unconverted.push({ currencyCode: row.currency_code, transactions: row.transactions });
        continue;
      }
      asset.total = asset.total.plus(big(row.amount).times(big(rate)));
    }

    const byAsset = [...byAssetKey.values()].map((asset) => ({ financialAssetKey: asset.financialAssetKey, symbol: asset.symbol, totalDividends: roundDisplay(asset.total) }));
    const totalDividends = roundDisplay(sumMoney(byAsset.map((asset) => asset.totalDividends)));
    return { byAsset, completeness: completenessFromCounts(viewerCurrency, unconverted), totalDividends };
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
   * Calculate realized gains from sell transactions.
   * Compares total sell proceeds against the cost basis the portfolio's method relieved.
   */
  async getRealizedGains(
    appuserKey: number,
    portfolioId?: number,
    tenantKey?: number,
  ): Promise<RealizedGains> {
    const { splitRows, transactionRows } = await this.getPortfolioTransactionRows(appuserKey, portfolioId, tenantKey);
    const costBasisMethod = this.costBasisMethodFromRows(transactionRows);
    const invalidHoldings = this.getInvalidHoldingsFromRows(transactionRows, splitRows, 'EUR', costBasisMethod);
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
    const costBasisOfSold = [...replayHoldingTimeline(timeline, costBasisMethod).realizedCostBasisByPortfolioAsset.entries()]
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

/**
 * Which stored amount a dividend is read at for a viewer whose currency is `viewerCurrencyKey`,
 * and the currency that amount is in. One already in the viewer's currency when there is one
 * (exact, no conversion), else its settlement amount, converted once. The amount stored in its
 * member's currency is read only when the settlement amount is missing, or when the settlement
 * records no currency and the member amount does. Dividend income and the investment cash flows
 * both read it, so the two agree. The query joins `ft` (financial_transaction), `au` (its
 * member), `member_c` (the member's currency) and `settlement_c` (the settlement currency). The
 * key is inlined (not bound) so a select and a group-by repeat the same text.
 */
function dividendSourceAmount(viewerCurrencyKey: number) {
  const viewerKey = sql.raw(currencyKeySql(viewerCurrencyKey));
  const fromSettlement = sql<boolean>`(CASE
    WHEN ft.settlement_amount IS NOT NULL AND ft.settlement_currency_key = ${viewerKey} THEN TRUE
    WHEN ft.appuser_settlement_amount IS NOT NULL AND au.currency_key = ${viewerKey} THEN FALSE
    ELSE ft.settlement_amount IS NOT NULL AND (ft.settlement_currency_key IS NOT NULL OR ft.appuser_settlement_amount IS NULL)
  END)`;
  return {
    amount: sql<null | string>`CASE WHEN ${fromSettlement} THEN ft.settlement_amount ELSE ft.appuser_settlement_amount END`,
    currencyCode: sql<null | string>`CASE WHEN ${fromSettlement} THEN settlement_c.code ELSE member_c.code END`,
  };
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
