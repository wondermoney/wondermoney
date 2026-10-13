import { DI } from '@app/app';
import { FINANCIAL_TRANSACTION_TYPES } from '@app/constants/financial-transaction-types';
import type { Appuser } from '@entity/Appuser';

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
    const knex = DI.em.getKnex();
    const rawTransactionRows = (await knex('financial_transaction as ft')
      .select(
        'ft.financial_asset_key',
        'ft.portfolio_key',
        'ft.transaction_key',
        'ft.transaction_date',
        'ft.financial_transaction_type_key',
        'ft.quantity',
        'ft.appuser_unit_amount',
        'ft.settlement_unit_amount',
        'c.code as financial_asset_currency_code',
        'fa.name as financial_asset_name',
        'fa.symbol as financial_asset_symbol',
        'fat.name as financial_asset_type_name',
        'fa.logo_url as financial_asset_logo_url',
        'fa.esg_score as financial_asset_esg_score',
        'p.name as portfolio_name',
      )
      .innerJoin('financial_asset as fa', 'ft.financial_asset_key', 'fa.financial_asset_key')
      .innerJoin('portfolio as p', 'ft.portfolio_key', 'p.portfolio_key')
      .leftJoin('currency as c', 'fa.currency_key', 'c.currency_key')
      .leftJoin('financial_asset_type as fat', 'fa.financial_asset_type_key', 'fat.financial_asset_type_key')
      // RAD-343: household scope when a tenant is supplied (request path, raw SQL bypasses
      // the filter); otherwise fall back to appuser scope (worker/snapshot path).
      .where(function () {
        if (tenantKey == null) this.where('ft.appuser_key', appuserKey);
        else {
          // Keep both sides of the relationship tenant-scoped. The transaction tenant is
          // the normal request predicate, while the portfolio predicate makes an explicit
          // portfolio lookup safe even if upstream portfolio validation regresses or a
          // legacy transaction has a stale tenant key.
          this.where('ft.tenant_key', tenantKey).where('p.tenant_key', tenantKey);
        }
      })
      .whereNull('ft.deleted_at')
      .whereIn('ft.financial_transaction_type_key', [FINANCIAL_TRANSACTION_TYPES.BUY, FINANCIAL_TRANSACTION_TYPES.SELL])
      .modify((query) => {
        if (portfolioId != null) query.where('ft.portfolio_key', portfolioId);
      })) as Record<string, unknown>[];

    // RAD-168: an asset with no resolved FinancialAssetType (unreachable through normal app
    // creation paths today, but possible via the type FK's `on delete set null`) must still
    // surface as a holding — the left join above keeps the row, this coalesce keeps it labeled.
    const transactionRows = rawTransactionRows.map(
      (row): Record<string, unknown> => ({
        ...row,
        financial_asset_type_name: row['financial_asset_type_name'] ?? 'Unclassified',
      }),
    );

    const assetKeys = [...new Set(transactionRows.map((row) => Number(row['financial_asset_key'])).filter(Number.isFinite))];
    const splitRows = assetKeys.length > 0
      ? await knex('financial_asset_stock_adjustment as fasa')
          .select('fasa.financial_asset_key', 'fasa.date', 'fasa.numerator', 'fasa.denominator', 'fasa.split_ratio')
          .where('fasa.adjustment_type', 'SPLIT')
          .whereNull('fasa.deleted_at')
          .whereIn('fasa.financial_asset_key', assetKeys)
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
    const knex = DI.em.getKnex();

    const assetCurrencyCodes = [...new Set(portfolioAssets.map((p) => p.financialAssetCurrencyCode).filter(Boolean))] as string[];
    const exchangeRateRows = assetCurrencyCodes.length > 0
      ? await knex('exchange_rate as er')
          .select('from_c.code as from_currency_code', 'er.rate')
          .innerJoin('currency as from_c', 'er.from_currency_key', 'from_c.currency_key')
          .innerJoin('currency as to_c', 'er.to_currency_key', 'to_c.currency_key')
          .innerJoin(
            knex.raw('(SELECT from_currency_key, to_currency_key, MAX(date) as max_date FROM exchange_rate GROUP BY from_currency_key, to_currency_key) as latest'),
            function () {
              this.on('er.from_currency_key', 'latest.from_currency_key')
                .andOn('er.to_currency_key', 'latest.to_currency_key')
                .andOn('er.date', 'latest.max_date');
            },
          )
          .whereIn('from_c.code', assetCurrencyCodes)
          .andWhere('to_c.code', currency)
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
   * date (RAD-445). `enrichHoldingsWithPrices` (market-price path) and
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
    return this.buildHoldingsFromOpenBatches(batches, invalidHoldings, invalidKeys, currency);
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
    return this.buildHoldingsFromOpenBatches(batches, invalidHoldings, invalidKeys, currency);
  }

  /**
   * Get total dividend income for a portfolio or all portfolios
   */
  async getDividendIncome(
    appuserKey: number,
    portfolioId?: number,
    tenantKey?: number,
  ): Promise<{ byAsset: { financialAssetKey: number; symbol: string; totalDividends: number }[]; totalDividends: number }> {
    const knex = DI.em.getKnex();

    const query = knex('financial_transaction as ft')
      .select('fa.financial_asset_key', 'fa.symbol')
      .sum('ft.appuser_settlement_amount as total_dividends')
      .innerJoin('financial_asset as fa', 'ft.financial_asset_key', 'fa.financial_asset_key')
      .where('ft.financial_transaction_type_key', FINANCIAL_TRANSACTION_TYPES.DIVIDEND)
      // RAD-343: household scope when a tenant is supplied (request path, raw SQL bypasses
      // the filter); otherwise fall back to appuser scope (worker/snapshot path).
      .where(function () {
        if (tenantKey == null) this.where('ft.appuser_key', appuserKey);
        else this.where('ft.tenant_key', tenantKey);
      })
      .whereNull('ft.deleted_at')
      .groupBy('fa.financial_asset_key', 'fa.symbol');

    if (portfolioId) {
      query.where('ft.portfolio_key', portfolioId);
    }

    const rows = (await query) as { financial_asset_key: number; symbol: string; total_dividends: string }[];

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
  ): Promise<{ totalCostBasisOfSold: number; totalRealizedGains: number }> {
    const knex = DI.em.getKnex();
    const { splitRows, transactionRows } = await this.getPortfolioTransactionRows(appuserKey, portfolioId, tenantKey);
    const invalidHoldings = this.getInvalidHoldingsFromRows(transactionRows, splitRows, 'EUR');
    const invalidKeys = new Set(
      invalidHoldings.map((holding) => getPortfolioAssetInvalidKey(holding.portfolioKey!, holding.financialAssetKey)),
    );

    // Get total sell proceeds
    const query = knex('financial_transaction')
      .select('portfolio_key', 'financial_asset_key', 'appuser_settlement_amount', 'settlement_amount')
      .where('financial_transaction_type_key', FINANCIAL_TRANSACTION_TYPES.SELL)
      // RAD-343: household scope when a tenant is supplied; else appuser (worker path).
      .where(function () {
        if (tenantKey == null) this.where('appuser_key', appuserKey);
        else this.where('tenant_key', tenantKey);
      })
      .whereNull('deleted_at');

    if (portfolioId) {
      query.where('portfolio_key', portfolioId);
    }

    const sellRows = await query as {
      appuser_settlement_amount: null | number | string;
      financial_asset_key: number;
      portfolio_key: number;
      settlement_amount: null | number | string;
    }[];
    const totalSellProceeds = sellRows
      .filter((row) => !invalidKeys.has(getPortfolioAssetInvalidKey(row.portfolio_key, row.financial_asset_key)))
      .reduce((sum, row) => {
        const settlementAmount = row.appuser_settlement_amount ?? row.settlement_amount ?? 0;
        return sum + Math.abs(Number(settlementAmount));
      }, 0);

    const timeline: HoldingTimelineItem[] = [
      ...transactionRows.map((row) => ({
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

    return { totalCostBasisOfSold: costBasisOfSold, totalRealizedGains: totalSellProceeds - costBasisOfSold };
  }
}

export default new PortfolioHoldingsService();
