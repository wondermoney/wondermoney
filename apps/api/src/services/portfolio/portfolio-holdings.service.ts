import type { Big } from 'big.js';
import { type Expression, type Kysely, sql, type SqlBool } from 'kysely';

import { DI } from '@app/app';
import { FINANCIAL_TRANSACTION_TYPES } from '@app/constants/financial-transaction-types';
import { PortfolioCostBasisMethod } from '@app/constants/portfolio-cost-basis';
import { anyOf, type SqlDatabase, sqlQuery } from '@app/database/sql';
import type { Appuser } from '@entity/Appuser';
import { FEED_RATES_ONLY } from '@service/currency/exchange-rate';
import { completenessFromCounts, currencyKeySql, loadDailyRates, type ReportCompleteness, type UnconvertedCount } from '@service/reports/report-currency';
import logger from '@utils/logger';
import { addMoney, big, convertMoney, roundDisplay, roundMoney, subtractMoney, sumMoney } from '@utils/money';

import assetPriceService from './asset-price.service';
import { enrichSavingsCertificateHoldings, isSavingsCertificateBatch } from './certificado-aforro-holdings.service';
import { resolveHoldingCurrentMetrics } from './portfolio-currency.utils';
import {
  aggregateBatchesIntoAssets,
  type CostBasisMethodResolver,
  getPortfolioAssetInvalidKey,
  type HoldingBatch,
  type HoldingDisposal,
  type HoldingReplayResult,
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

/** Totals of a set of sales, in the report's currency. */
export interface RealizedGainsTotals {
  costBasis: number;
  proceeds: number;
  realizedGain: number;
  sales: number;
}

/** One sale. Amounts are in `currencyCode`: the viewer's, unless no rate converts the sale. */
export interface RealizedDisposal {
  costBasis: number;
  currencyCode: null | string;
  /** The sale's date, ISO 8601. */
  date: string;
  /** Set when a fee feeding this sale's figures could not be converted and counted as zero. */
  feeConversionIncomplete?: true;
  financialAssetKey: number;
  financialAssetName: string;
  /** The purchase date of the oldest lot the sale consumed, ISO 8601; null when it consumed none. */
  holdingPeriodStart: null | string;
  portfolioKey: number;
  portfolioName: string;
  /** Proceeds less the sale's fee. */
  proceeds: number;
  quantity: number;
  realizedGain: number;
  symbol: string;
  transactionKey: number;
}

export interface RealizedGainsByAsset extends RealizedGainsTotals {
  financialAssetKey: number;
  financialAssetName: string;
  quantity: number;
  symbol: string;
}

export interface RealizedGainsByYear extends RealizedGainsTotals {
  year: number;
}

/** An asset sold out of every portfolio in scope, with its lifetime result. */
export interface ClosedPosition extends RealizedGainsTotals {
  financialAssetKey: number;
  financialAssetLogoUrl: null | string;
  financialAssetName: string;
  financialAssetType: string;
  /** The oldest lot any of its sales consumed, ISO 8601. */
  holdingPeriodStart: null | string;
  lastSaleDate: string;
  quantity: number;
  symbol: string;
}

/**
 * Realized gains per sale, per asset and per UTC year, in the viewer's currency. `disposals`,
 * `byAsset` and `totals` cover the requested year (every year when none is given); `byYear` and
 * `closedPositions` always cover the whole history. A sale no rate converts is listed in its own
 * currency, left out of every total and counted in `completeness`.
 */
export interface RealizedGainsReport {
  byAsset: RealizedGainsByAsset[];
  byYear: RealizedGainsByYear[];
  closedPositions: ClosedPosition[];
  completeness: ReportCompleteness;
  currencyCode: string;
  disposals: RealizedDisposal[];
  /** Assets with a fee that was counted as zero, as on the realized total. Present only when non-empty. */
  feeConversionIncompleteAssetKeys?: number[];
  totals: RealizedGainsTotals;
  year: null | number;
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
 * The portfolios a read covers: one portfolio, or a set of them (the member filter's, see
 * `memberPortfolioKeys`). An empty set covers none. Absent, a read covers every portfolio in its
 * scope (the household's with a tenant, else the user's own).
 */
export type PortfolioSelection = number | readonly number[];

/** SQL: the row's portfolio is one of the selection. */
function inPortfolios(column: string, selection: PortfolioSelection): Expression<SqlBool> {
  return typeof selection === 'number' ? sql<SqlBool>`${sql.ref(column)} = ${selection}` : anyOf(column, selection);
}

/**
 * Service for calculating portfolio holdings from purchase lots.
 *
 * A portfolio's `costBasisMethod` decides how a sale relieves cost. FIFO (First In, First Out)
 * sells the oldest lots first, the standard method in Portugal and Spain. AVERAGE relieves the
 * running average of the open position, as in Brazil. Both run through `replayHoldingTimeline`.
 */
class PortfolioHoldingsService {
  private async getPortfolioTransactionRows(appuserKey: number, portfolios?: PortfolioSelection, tenantKey?: number): Promise<{
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
      .$if(portfolios != null, (query) => query.where(inPortfolios('ft.portfolio_key', portfolios ?? [])))
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
   * Replays the rows under each portfolio's cost basis method: the open lots the holdings are
   * built from and one disposal per sale (see `replayHoldingTimeline`).
   *
   * Example under FIFO: Buy 100, Buy 50, Sell 120
   * - Lot 1: fully sold; Lot 2: 30 remain
   * - One disposal of 120 relieving all of lot 1 and 20 of lot 2
   */
  private replayRows(
    transactionRows: Record<string, unknown>[],
    splitRows: Record<string, unknown>[],
    costBasisMethod: CostBasisMethodResolver,
  ): HoldingReplayResult {
    return replayHoldingTimeline(this.buildTimelineFromRows(transactionRows, splitRows), costBasisMethod);
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
        ...(Number(row['financial_transaction_type_key']) === FINANCIAL_TRANSACTION_TYPES.SELL
          ? { proceeds_amount: saleProceedsAmount(row) }
          : {}),
        ...(row['fee_conversion_incomplete'] === true ? { fee_conversion_incomplete: true } : {}),
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
  private async enrichHoldingsWithPrices(portfolioAssets: PortfolioAsset[], currency = 'USD', tenantKey?: number): Promise<PortfolioHolding[]> {
    const assetsCurrentPrice = await assetPriceService.getCurrentAssetPrices(tenantKey);

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
      const { currentPrice: normalizedCurrentPrice, currentPriceInAssetCurrency, currentValue, unrealizedGains, unrealizedGainsPercentage } =
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
        currentPriceInAssetCurrency,
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
    tenantKey?: number,
  ): Promise<PortfolioHolding[]> {
    const openBatches = batches.filter((batch) => !invalidKeys.has(getPortfolioAssetInvalidKey(batch.portfolio_key, batch.financial_asset_key)));
    const savingsCertificateBatches = openBatches.filter(isSavingsCertificateBatch);
    const otherBatches = openBatches.filter((batch) => !isSavingsCertificateBatch(batch));

    const portfolioAssets = aggregateBatchesIntoAssets(otherBatches);
    const [enrichedOther, enrichedSavingsCertificates] = await Promise.all([
      this.enrichHoldingsWithPrices(portfolioAssets, currency, tenantKey),
      enrichSavingsCertificateHoldings(savingsCertificateBatches, currency),
    ]);
    const combined = recomputeAllocation([...enrichedOther, ...enrichedSavingsCertificates]);
    return [...combined, ...invalidHoldings];
  }

  /**
   * Get holdings for a specific portfolio. `tenantKey` scopes the trades to the household (else
   * the appuser's own) and prices them with the household's price overrides; `priceTenantKey`
   * applies a household's overrides without changing the trade scope (the snapshot worker).
   */
  async getPortfolioHoldings(appuser: Appuser, portfolioId: number, tenantKey?: number, priceTenantKey = tenantKey): Promise<PortfolioHolding[]> {
    const { splitRows, transactionRows } = await this.getPortfolioTransactionRows(appuser.appuserKey, portfolioId, tenantKey);
    const currency = appuser.currencyKey.code || 'EUR';
    const costBasisMethod = this.costBasisMethodFromRows(transactionRows);
    const replay = this.replayRows(transactionRows, splitRows, costBasisMethod);
    const invalidHoldings = this.getInvalidHoldingsFromRows(transactionRows, splitRows, currency, costBasisMethod);
    const invalidKeys = new Set(
      invalidHoldings.map((holding) => getPortfolioAssetInvalidKey(holding.portfolioKey!, holding.financialAssetKey)),
    );
    const holdings = await this.buildHoldingsFromOpenBatches(replay.openBatches, invalidHoldings, invalidKeys, currency, priceTenantKey);
    return flagIncompleteFeeConversions(attachRealizedGains(holdings, replay.disposals, invalidKeys), transactionRows);
  }

  private async getInvalidHoldings(appuserKey: number, currency: string, portfolioId?: number): Promise<PortfolioHolding[]> {
    const { splitRows, transactionRows } = await this.getPortfolioTransactionRows(appuserKey, portfolioId);
    const costBasisMethod = this.costBasisMethodFromRows(transactionRows);
    return this.getInvalidHoldingsFromRows(transactionRows, splitRows, currency, costBasisMethod);
  }

  /**
   * Holdings across portfolios, one per asset: the household's (the user's own without a
   * tenant), or only `portfolios` (the member filter's). Selecting the portfolios before the
   * replay, not filtering its result, matters because an asset held in several merges into one.
   */
  async getPortfoliosHoldings(appuser: Appuser, tenantKey?: number, portfolios?: readonly number[]): Promise<PortfolioHolding[]> {
    const { splitRows, transactionRows } = await this.getPortfolioTransactionRows(appuser.appuserKey, portfolios, tenantKey);
    const currency = appuser.currencyKey.code || 'EUR';
    const costBasisMethod = this.costBasisMethodFromRows(transactionRows);
    const replay = this.replayRows(transactionRows, splitRows, costBasisMethod);
    const invalidHoldings = this.getInvalidHoldingsFromRows(transactionRows, splitRows, currency, costBasisMethod);
    const invalidKeys = new Set(
      invalidHoldings.map((holding) => getPortfolioAssetInvalidKey(holding.portfolioKey!, holding.financialAssetKey)),
    );
    const holdings = await this.buildHoldingsFromOpenBatches(replay.openBatches, invalidHoldings, invalidKeys, currency, tenantKey);
    return flagIncompleteFeeConversions(attachRealizedGains(holdings, replay.disposals, invalidKeys), transactionRows);
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
   * household's flows, otherwise the viewer's own; with `portfolioKey`, only those portfolios'.
   */
  async getInvestmentCashFlows(viewer: Appuser, tenantKey?: number, portfolioKey?: PortfolioSelection): Promise<InvestmentCashFlow[]> {
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
      .$if(portfolioKey != null, (query) => query.where(inPortfolios('ft.portfolio_key', portfolioKey ?? [])))
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
   * `portfolioId`, only those portfolios'.
   */
  async getDividendIncome(viewer: Appuser, portfolioId?: PortfolioSelection, tenantKey?: number): Promise<DividendIncome> {
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
      .$if(portfolioId != null, (query) => query.where(inPortfolios('ft.portfolio_key', portfolioId ?? [])))
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
    portfolioId?: PortfolioSelection,
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
      .reduce((sum, row) => sum + Math.abs(saleProceedsAmount(row)) - Number(row['fee_accounting_amount'] ?? 0), 0);

    const costBasisOfSold = [...this.replayRows(transactionRows, splitRows, costBasisMethod).realizedCostBasisByPortfolioAsset.entries()]
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

  /**
   * Every sale as a disposal (see {@link RealizedGainsReport}), from the replay that prices the
   * holdings and the realized total, so the per-sale figures add up to `getRealizedGains`. A sale
   * is converted from the currency its gains are counted in (the recording member's, else its
   * settlement currency) into the viewer's at the rate of its UTC day; the cost it relieved is
   * converted with it. An oversold asset is left out, as from the realized total. `tenantKey`
   * scopes the trades to the household, as for the holdings.
   */
  async getRealizedGainsReport(
    viewer: Appuser,
    options: { portfolioId?: PortfolioSelection; tenantKey?: number; year?: number } = {},
  ): Promise<RealizedGainsReport> {
    if (!viewer.currencyKey.code) await DI.em.populate(viewer, ['currencyKey']);
    const viewerCurrency = viewer.currencyKey.code;
    const { portfolioId, tenantKey, year } = options;
    const { splitRows, transactionRows } = await this.getPortfolioTransactionRows(viewer.appuserKey, portfolioId, tenantKey);
    const costBasisMethod = this.costBasisMethodFromRows(transactionRows);
    const invalidKeys = new Set(
      this.getInvalidHoldingsFromRows(transactionRows, splitRows, viewerCurrency, costBasisMethod)
        // Invalid holdings are built per portfolio, so they always carry their portfolio key.
        .map((holding) => getPortfolioAssetInvalidKey(holding.portfolioKey ?? 0, holding.financialAssetKey)),
    );
    const replay = this.replayRows(transactionRows, splitRows, costBasisMethod);
    const rowByTransactionKey = new Map(transactionRows.map((row) => [Number(row['transaction_key']), row]));
    const validDisposals = replay.disposals.filter(
      (disposal) => !invalidKeys.has(getPortfolioAssetInvalidKey(disposal.portfolioKey, disposal.financialAssetKey)),
    );

    const dayOf = (date: Date) => date.toISOString().slice(0, 10);
    const sourceCurrencyOf = (row: Record<string, unknown> | undefined) => {
      const code = row?.['appuser_settlement_amount'] == null ? row?.['settlement_currency_code'] : row['appuser_currency_code'];
      return typeof code === 'string' ? code : null;
    };
    const rateFor = await loadDailyRates(
      DI.em,
      viewerCurrency,
      validDisposals.map((disposal) => ({ currencyCode: sourceCurrencyOf(rowByTransactionKey.get(disposal.transactionKey)), day: dayOf(disposal.transactionDate) })),
      FEED_RATES_ONLY,
    );

    const converted = validDisposals.map((disposal) => {
      const row = rowByTransactionKey.get(disposal.transactionKey);
      const sourceCurrency = sourceCurrencyOf(row);
      // A sale that records no currency is read in the viewer's, as reports read such rows.
      const rate = sourceCurrency == null ? 1 : rateFor({ currencyCode: sourceCurrency, day: dayOf(disposal.transactionDate) });
      const amount = (value: number) => (rate == null ? roundMoney(value) : convertMoney(value, rate));
      const proceeds = amount(disposal.proceeds);
      const costBasis = amount(disposal.costBasis);
      const entry: RealizedDisposal = {
        costBasis,
        currencyCode: rate == null ? sourceCurrency : viewerCurrency,
        date: disposal.transactionDate.toISOString(),
        ...(disposal.feeConversionIncomplete ? { feeConversionIncomplete: true as const } : {}),
        financialAssetKey: disposal.financialAssetKey,
        financialAssetName: String(row?.['financial_asset_name'] ?? ''),
        holdingPeriodStart: disposal.holdingPeriodStart?.toISOString() ?? null,
        portfolioKey: disposal.portfolioKey,
        portfolioName: String(row?.['portfolio_name'] ?? ''),
        proceeds,
        quantity: disposal.quantity,
        realizedGain: subtractMoney(proceeds, costBasis),
        symbol: String(row?.['financial_asset_symbol'] ?? ''),
        transactionKey: disposal.transactionKey,
      };
      return { entry, isConverted: rate != null, row, year: disposal.transactionDate.getUTCFullYear() };
    });

    const inYear = converted.filter((item) => year == null || item.year === year);
    const counted = (items: typeof converted) => items.filter((item) => item.isConverted).map((item) => item.entry);

    const byAsset = new Map<number, RealizedGainsByAsset>();
    for (const disposal of counted(inYear)) {
      const asset = byAsset.get(disposal.financialAssetKey) ?? { ...emptyTotals(), financialAssetKey: disposal.financialAssetKey, financialAssetName: disposal.financialAssetName, quantity: 0, symbol: disposal.symbol };
      addToTotals(asset, disposal);
      asset.quantity = addMoney(asset.quantity, disposal.quantity, 8);
      byAsset.set(disposal.financialAssetKey, asset);
    }

    const byYear = new Map<number, RealizedGainsByYear>();
    for (const item of converted) {
      if (!item.isConverted) continue;
      const entry = byYear.get(item.year) ?? { ...emptyTotals(), year: item.year };
      addToTotals(entry, item.entry);
      byYear.set(item.year, entry);
    }

    // Closed: no open quantity left in any portfolio in scope (the holdings merge per asset too).
    const openAssetKeys = new Set(replay.openBatches.map((batch) => batch.financial_asset_key));
    const closed = new Map<number, ClosedPosition>();
    for (const item of converted) {
      if (!item.isConverted || openAssetKeys.has(item.entry.financialAssetKey)) continue;
      const { entry, row } = item;
      const position = closed.get(entry.financialAssetKey) ?? {
        ...emptyTotals(),
        financialAssetKey: entry.financialAssetKey,
        financialAssetLogoUrl: typeof row?.['financial_asset_logo_url'] === 'string' ? row['financial_asset_logo_url'] : null,
        financialAssetName: entry.financialAssetName,
        financialAssetType: String(row?.['financial_asset_type_name'] ?? ''),
        holdingPeriodStart: null,
        lastSaleDate: entry.date,
        quantity: 0,
        symbol: entry.symbol,
      };
      addToTotals(position, entry);
      position.quantity = addMoney(position.quantity, entry.quantity, 8);
      if (entry.date > position.lastSaleDate) position.lastSaleDate = entry.date;
      if (entry.holdingPeriodStart && (!position.holdingPeriodStart || entry.holdingPeriodStart < position.holdingPeriodStart)) {
        position.holdingPeriodStart = entry.holdingPeriodStart;
      }
      closed.set(entry.financialAssetKey, position);
    }

    const totals = emptyTotals();
    for (const disposal of counted(inYear)) addToTotals(totals, disposal);

    const unconverted = new Map<null | string, number>();
    for (const item of inYear) {
      if (!item.isConverted) unconverted.set(item.entry.currencyCode, (unconverted.get(item.entry.currencyCode) ?? 0) + 1);
    }
    const feeConversionIncompleteAssetKeys = getFeeConversionIncompleteAssetKeys(
      transactionRows.filter((row) => !invalidKeys.has(getPortfolioAssetInvalidKey(Number(row['portfolio_key']), Number(row['financial_asset_key'])))),
    );

    return {
      byAsset: [...byAsset.values()].toSorted((a, b) => a.symbol.localeCompare(b.symbol) || a.financialAssetKey - b.financialAssetKey),
      byYear: [...byYear.values()].toSorted((a, b) => a.year - b.year),
      closedPositions: [...closed.values()].toSorted((a, b) => b.lastSaleDate.localeCompare(a.lastSaleDate) || a.financialAssetKey - b.financialAssetKey),
      completeness: completenessFromCounts(viewerCurrency, [...unconverted].map(([currencyCode, transactions]) => ({ currencyCode, transactions }))),
      currencyCode: viewerCurrency,
      // Newest first, as the transactions list reads.
      disposals: inYear.map((item) => item.entry).toReversed(),
      ...(feeConversionIncompleteAssetKeys.length > 0 ? { feeConversionIncompleteAssetKeys } : {}),
      totals,
      year: year ?? null,
    };
  }
}

function addToTotals(totals: RealizedGainsTotals, disposal: Pick<RealizedDisposal, 'costBasis' | 'proceeds' | 'realizedGain'>): void {
  totals.costBasis = addMoney(totals.costBasis, disposal.costBasis);
  totals.proceeds = addMoney(totals.proceeds, disposal.proceeds);
  totals.realizedGain = addMoney(totals.realizedGain, disposal.realizedGain);
  totals.sales += 1;
}

function emptyTotals(): RealizedGainsTotals {
  return { costBasis: 0, proceeds: 0, realizedGain: 0, sales: 0 };
}

/**
 * Each holding's lifetime realized gain: its sales' gains, in the same accounting amounts as its
 * unrealized gain. Holdings merge per asset across portfolios, so the gains do too. An oversold
 * holding has none.
 */
function attachRealizedGains(holdings: PortfolioHolding[], disposals: HoldingDisposal[], invalidKeys: Set<string>): PortfolioHolding[] {
  const byAsset = new Map<number, Big>();
  for (const disposal of disposals) {
    if (invalidKeys.has(getPortfolioAssetInvalidKey(disposal.portfolioKey, disposal.financialAssetKey))) continue;
    byAsset.set(disposal.financialAssetKey, (byAsset.get(disposal.financialAssetKey) ?? big(0)).plus(big(disposal.realizedGain)));
  }
  return holdings.map((holding) => ({
    ...holding,
    realizedGains: holding.isInvalid ? null : roundDisplay(byAsset.get(holding.financialAssetKey) ?? 0),
  }));
}

/** A sale's gross proceeds in the currency its gains are counted in, as recorded. */
function saleProceedsAmount(row: Record<string, unknown>): number {
  return Number(row['appuser_settlement_amount'] ?? row['settlement_amount'] ?? 0);
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
