import type { Big as BigType } from 'big.js';
import { isAfter } from 'date-fns';

import { FINANCIAL_TRANSACTION_TYPES } from '@app/constants/financial-transaction-types';
import { DI } from '@app/database/di';
import { anyOf, toDate as parseDatabaseDate, sqlQuery } from '@app/database/sql';
import { Appuser } from '@entity/Appuser';
import { Currency } from '@entity/Currency';
import { ExchangeRate } from '@entity/ExchangeRate';
import { FinancialAsset } from '@entity/FinancialAsset';
import { FinancialAssetStockAdjustment } from '@entity/FinancialAssetStockAdjustment';
import { FinancialTransaction } from '@entity/FinancialTransaction';
import { Portfolio } from '@entity/Portfolio';
import { PortfolioSnapshot } from '@entity/PortfolioSnapshot';
import { convertAtLatestRate } from '@service/currency/exchange-rate';
import logger from '@utils/logger';
import { big, roundDisplay } from '@utils/money';

/**
 * Service for managing portfolio snapshots (daily value records)
 */
class PortfolioSnapshotService {
  /** Rebuilds a portfolio's daily snapshots from `fromDate` (default: its first trade) to `toDate` (default: today). */
  async backfillSnapshotsForPortfolio(portfolioId: number, fromDate?: Date, toDate?: Date): Promise<void> {
    const plan = await this.computeSnapshotsForPortfolio(portfolioId, fromDate, toDate);
    if (!plan) return;
    const { endDate, snapshots, startDate } = plan;

    await DI.em.transactional(async (em) => {
      await em.nativeDelete(PortfolioSnapshot, {
        portfolioKey: { portfolioKey: portfolioId },
        snapshotDate: { $gte: startDate, $lte: endDate },
      });

      for (const snapshot of snapshots) {
        em.persist(snapshot);
      }

      await em.flush();
    });
  }

  /**
   * The daily snapshots a backfill would write, without writing them: every day from `fromDate`
   * (default: the first trade) to `toDate` (default: today) with a positive value. Reads stored
   * prices and exchange rates only; it never calls the market-data provider. Null when the range
   * is empty.
   */
  async computeSnapshotsForPortfolio(portfolioId: number, fromDate?: Date, toDate?: Date): Promise<null | { endDate: Date; snapshots: PortfolioSnapshot[]; startDate: Date }> {
    const portfolio = await this.getPortfolio(portfolioId);
    const today = startOfUtcDay(new Date());
    const endDate = startOfUtcDay(toDate ?? today);

    const transactions = await DI.em.find(
      FinancialTransaction,
      {
        deletedAt: undefined,
        portfolioKey: { portfolioKey: portfolioId },
      },
      {
        orderBy: { transactionDate: 'asc' },
        populate: ['financialAssetKey.currencyKey', 'financialAssetKey.financialAssetTypeKey', 'financialTransactionTypeKey', 'settlementCurrencyKey', 'feeCurrencyKey'],
      },
    );

    const buySellTransactions = transactions.filter((tx) => {
      const name = tx.financialTransactionTypeKey?.name;
      return name === 'BUY' || name === 'SELL';
    });

    const stockSplits = await DI.em.find(
      FinancialAssetStockAdjustment,
      {
        adjustmentType: 'SPLIT',
        deletedAt: undefined,
        financialAssetKey: {
          financialAssetKey: {
            $in: [
              ...new Set(
                buySellTransactions
                  .map((tx) => tx.financialAssetKey?.financialAssetKey)
                  .filter((k): k is number => k != null),
              ),
            ],
          },
        },
      },
      { orderBy: { date: 'asc' }, populate: ['financialAssetKey'] },
    );

    const earliestTransactionDate = buySellTransactions[0]?.transactionDate
      ? startOfUtcDay(buySellTransactions[0].transactionDate)
      : null;
    const startDate = startOfUtcDay(fromDate ?? earliestTransactionDate ?? today);
    if (isAfter(startDate, endDate)) return null;

    const snapshotsToPersist: PortfolioSnapshot[] = [];
    if (buySellTransactions.length) {
      const assetKeys = Array.from(
        new Set(
          buySellTransactions
            .map((tx) => tx.financialAssetKey?.financialAssetKey)
            .filter((assetKey): assetKey is number => assetKey != null),
        ),
      );
      const pricesByAsset = await this.loadHistoricalPrices(assetKeys, endDate);
      const sameCurrency =
        portfolio.currencyKey.currencyKey === portfolio.portfolioOwnerAppuserKey.currencyKey.currencyKey;
      const exchangeRateCache = new Map<string, Map<string, number>>();
      const getExchangeRates = async (fromCurrency: Currency, toCurrency: Currency) => {
        const cacheKey = `${fromCurrency.currencyKey}:${toCurrency.currencyKey}`;
        let rates = exchangeRateCache.get(cacheKey);
        if (!rates) {
          rates = await this.loadExchangeRates(endDate, fromCurrency, toCurrency);
          exchangeRateCache.set(cacheKey, rates);
        }
        return rates;
      };
      const portfolioToAppuserRates = sameCurrency
        ? new Map<string, number>()
        : await getExchangeRates(portfolio.currencyKey, portfolio.portfolioOwnerAppuserKey.currencyKey);
      const holdings = new Map<number, { assetCurrency?: Currency; lots: { quantity: number; totalCost: BigType }[] }>();
      const assetToPortfolioRatesByCurrency = new Map<number, Map<string, number>>();
      const priceCursors = new Map<number, number>();
      const latestPrices = new Map<number, number>();
      const events = [
        ...buySellTransactions.map((tx) => ({
          date: startOfUtcDay(tx.transactionDate ?? new Date(0)),
          order: 1,
          transaction: tx,
          type: 'TX' as const,
        })),
        ...stockSplits.map((split) => ({ date: startOfUtcDay(split.date), order: 0, split, type: 'SPLIT' as const })),
      ].sort((a, b) => a.date.getTime() - b.date.getTime() || a.order - b.order);
      let eventIdx = 0;

      for (let currentDate = startDate; !isAfter(currentDate, endDate); currentDate = addUtcDays(currentDate, 1)) {
        while (eventIdx < events.length) {
          const event = events[eventIdx];
          if (!event || isAfter(event.date, currentDate)) break;
          eventIdx++;
          if (event.type === 'SPLIT') {
            const ratio = this.getSplitRatio(event.split);
            if (ratio == null) continue;
            const assetKey = event.split.financialAssetKey.financialAssetKey;
            const holding = holdings.get(assetKey);
            if (!holding) continue;
            for (const lot of holding.lots) {
              lot.quantity *= ratio;
            }
            holdings.set(assetKey, holding);
            continue;
          }
          const tx = event.transaction;
          if (!tx.transactionDate) continue;
          if (!tx.financialAssetKey) continue;
          const assetKey = tx.financialAssetKey.financialAssetKey;
          const typeName = tx.financialTransactionTypeKey?.name;
          if (!assetKey || !typeName) continue;
          const holding = holdings.get(assetKey) ?? { assetCurrency: tx.financialAssetKey.currencyKey, lots: [] };
          if (typeName === 'BUY') {
            // Settlement first: a lot with no settlement rate is skipped, as it was before fees
            // counted, rather than failing the whole backfill on its fee.
            let settlementCost = big(Math.abs(tx.settlementAmount));
            const settlementCurrency = tx.settlementCurrencyKey as Currency | undefined;
            if (settlementCurrency && settlementCurrency.currencyKey !== portfolio.currencyKey.currencyKey) {
              const rates = await getExchangeRates(settlementCurrency, portfolio.currencyKey);
              const rate = this.getCarryForwardRate(rates, tx.transactionDate);
              if (rate == null) continue;
              settlementCost = settlementCost.times(big(rate));
            }
            const isSavingsCertificate = tx.financialAssetKey.financialAssetTypeKey?.name === 'Savings Certificate';
            const feeAmount = isSavingsCertificate ? 0 : Math.abs(tx.feeAmount ?? 0);
            let feeCost = big(0);
            if (feeAmount > 0) {
              // A fee we cannot convert counts as zero, as in holdings: one bad fee must not
              // abort the backfill (or the transaction edit that triggers it).
              const feeCurrency = tx.feeCurrencyKey;
              if (feeCurrency?.currencyKey === portfolio.currencyKey.currencyKey) feeCost = big(feeAmount);
              else {
                const rate = feeCurrency ? this.getCarryForwardRate(await getExchangeRates(feeCurrency, portfolio.currencyKey), tx.transactionDate) : undefined;
                if (isValidFeeExchangeRate(rate)) feeCost = big(feeAmount).times(big(rate));
                else {
                  logger.warn(
                    { feeCurrency: feeCurrency?.code ?? null, portfolioId, transactionKey: tx.transactionKey },
                    'Portfolio fee left out of snapshot cost basis: it cannot be converted to the portfolio currency',
                  );
                }
              }
            }
            holding.lots.push({ quantity: tx.quantity, totalCost: settlementCost.plus(feeCost) });
          } else if (typeName === 'SELL' && holding.lots.length > 0) {
            let sellQuantity = Math.abs(tx.quantity);
            while (sellQuantity > 0 && holding.lots.length > 0) {
              const lot = holding.lots[0];
              if (!lot) break;
              const consumed = Math.min(sellQuantity, lot.quantity);
              const available = lot.quantity;
              const lotCostPerShare = lot.totalCost.div(big(lot.quantity));
              lot.quantity = available - consumed;
              lot.totalCost = consumed === available
                ? big(0)
                : lot.totalCost.minus(lotCostPerShare.times(big(consumed)));
              sellQuantity -= consumed;
              if (lot.quantity <= 0) holding.lots.shift();
            }
          }
          holdings.set(assetKey, holding);
        }

        // Exact decimal arithmetic throughout (no float accumulation of the per-holding
        // multiply); rounded once on write.
        let totalValue = big(0);
        let costBasis = big(0);
        for (const [assetKey, holding] of holdings) {
          const quantity = holding.lots.reduce((sum, lot) => sum + lot.quantity, 0);
          const costBasisForAsset = holding.lots.reduce<BigType>((sum, lot) => sum.plus(lot.totalCost), big(0));
          if (quantity <= 0) continue;
          const prices = pricesByAsset.get(assetKey);
          if (!prices?.length) continue;
          let price = latestPrices.get(assetKey) ?? null;
          let cursor = priceCursors.get(assetKey) ?? 0;
          while (cursor < prices.length) {
            const priceRow = prices[cursor];
            if (!priceRow || isAfter(startOfUtcDay(priceRow.date), currentDate)) break;
            price = priceRow.price;
            cursor++;
          }
          priceCursors.set(assetKey, cursor);
          if (price !== null) latestPrices.set(assetKey, price);
          if (price === null) continue;
          const assetCurrency = holding.assetCurrency ?? portfolio.currencyKey;
          let assetToPortfolioRate = 1;
          if (assetCurrency.currencyKey !== portfolio.currencyKey.currencyKey) {
            let rates = assetToPortfolioRatesByCurrency.get(assetCurrency.currencyKey);
            if (!rates) {
              rates = await getExchangeRates(assetCurrency, portfolio.currencyKey);
              assetToPortfolioRatesByCurrency.set(assetCurrency.currencyKey, rates);
            }
            const rate = this.getCarryForwardRate(rates, currentDate);
            if (rate == null) continue;
            assetToPortfolioRate = rate;
          }
          totalValue = totalValue.plus(big(quantity).times(big(price)).times(big(assetToPortfolioRate)));
          costBasis = costBasis.plus(costBasisForAsset);
        }
        if (totalValue.lte(0)) continue;
        const appuserRate = sameCurrency ? 1 : this.getCarryForwardRate(portfolioToAppuserRates, currentDate);
        if (appuserRate == null) {
          throw new Error(
            `Missing exchange rate for ${portfolio.currencyKey.code} to ${portfolio.portfolioOwnerAppuserKey.currencyKey.code} on ${currentDate.toISOString()}`,
          );
        }
        const appuserCurrencyTotalValue = roundDisplay(totalValue.times(big(appuserRate)));
        const appuserCurrencyCostBasis = roundDisplay(costBasis.times(big(appuserRate)));
        const newSnapshot = new PortfolioSnapshot();
        newSnapshot.portfolioKey = portfolio;
        newSnapshot.snapshotDate = currentDate;
        newSnapshot.currencyKey = portfolio.currencyKey;
        newSnapshot.totalValue = roundDisplay(totalValue);
        newSnapshot.costBasis = roundDisplay(costBasis);
        newSnapshot.appuserCurrencyTotalValue = appuserCurrencyTotalValue;
        newSnapshot.appuserCurrencyCostBasis = appuserCurrencyCostBasis;
        newSnapshot.appuserCurrencyKey = portfolio.portfolioOwnerAppuserKey.currencyKey;
        snapshotsToPersist.push(newSnapshot);
      }
    }

    return { endDate, snapshots: snapshotsToPersist, startDate };
  }

  private getCarryForwardRate(exchangeRates: Map<string, number>, date: Date): null | number {
    for (const [rateDate, value] of exchangeRates) {
      if (rateDate <= startOfUtcDay(date).toISOString()) return value;
    }
    return null;
  }

  private async getPortfolio(portfolioId: number): Promise<Portfolio> {
    const portfolio = await DI.em.findOne(
      Portfolio,
      { portfolioKey: portfolioId },
      { populate: ['portfolioOwnerAppuserKey.currencyKey', 'currencyKey'] },
    );

    if (!portfolio) throw new Error(`Portfolio ${portfolioId} not found`);
    return portfolio;
  }

  private getSplitRatio(split: FinancialAssetStockAdjustment): null | number {
    const numerator = Number(split.numerator);
    const denominator = Number(split.denominator);
    if (Number.isFinite(numerator) && Number.isFinite(denominator) && numerator > 0 && denominator > 0)
      return numerator / denominator;
    const ratio = Number(split.splitRatio);
    return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
  }

  private async loadExchangeRates(toDate: Date, fromCurrency: Currency, toCurrency: Currency) {
    if (fromCurrency.currencyKey === toCurrency.currencyKey) return new Map<string, number>();

    const rates = await DI.em.find(
      ExchangeRate,
      {
        date: { $lte: toDate },
        fromCurrency,
        toCurrency,
      },
      { orderBy: { date: 'desc' } },
    );

    return new Map(rates.map((rate) => [startOfUtcDay(rate.date).toISOString(), rate.rate]));
  }

  private async loadHistoricalPrices(assetKeys: number[], toDate: Date) {
    if (!assetKeys.length) return new Map<number, { date: Date; price: number }[]>();

    const prices = (await sqlQuery(DI.em)
      .selectFrom('financial_asset_price')
      .select(['financial_asset_key', 'date', 'price'])
      .where(anyOf('financial_asset_key', assetKeys))
      .where('date', '<=', toDate)
      .orderBy('date', 'asc')
      .execute()) as { date: Date | string; financial_asset_key: number; price: number }[];

    return prices.reduce((map, price) => {
      const assetKey = price.financial_asset_key;
      const bucket = map.get(assetKey) ?? [];
      bucket.push({ date: parseDatabaseDate(price.date), price: price.price });
      map.set(assetKey, bucket);
      return map;
    }, new Map<number, { date: Date; price: number }[]>());
  }

  /**
   * Ensure all assets in a portfolio have fresh prices
   */
  private async ensureFreshPricesForPortfolio(portfolioId: number): Promise<void> {
    // Get distinct assets in this portfolio
    const assets = (await sqlQuery(DI.em)
      .selectFrom('financial_transaction')
      .select('financial_asset_key')
      .distinct()
      .where('portfolio_key', '=', portfolioId)
      .where('financial_transaction_type_key', 'in', [
        FINANCIAL_TRANSACTION_TYPES.BUY,
        FINANCIAL_TRANSACTION_TYPES.SELL,
      ])
      .execute()) as { financial_asset_key: number }[];

    // Fetch fresh prices for each asset
    for (const { financial_asset_key } of assets) {
      const financialAsset = await DI.em.findOne(FinancialAsset, { financialAssetKey: financial_asset_key });
      if (financialAsset) {
        const { default: assetPriceService } = await import('./asset-price.service');
        await assetPriceService.ensureRecentAssetPrice(financialAsset, 1); // 1 day threshold for snapshots
      }
    }
  }

  /**
   * Calculate portfolio value and cost basis using FIFO holdings
   */
  private async calculatePortfolioMetrics(
    appuser: Appuser,
    portfolioId: number,
  ): Promise<{ costBasis: number; totalValue: number }> {
    const { default: portfolioHoldingsService } = await import('./portfolio-holdings.service');
    const holdings = await portfolioHoldingsService.getPortfolioHoldings(appuser, portfolioId);

    const totalValue = holdings.reduce((sum, h) => sum + (h.currentValue || 0), 0);
    const costBasis = holdings.reduce((sum, h) => sum + h.averageBuyPrice * h.quantity, 0);

    return { costBasis, totalValue };
  }

  /**
   * Update or create snapshot for a portfolio for today's date
   */
  async updateSnapshotForToday(portfolioId: number): Promise<PortfolioSnapshot> {
    const today = startOfUtcDay(new Date());

    // Get portfolio with owner and currency
    const portfolio = await DI.em.findOne(
      Portfolio,
      { portfolioKey: portfolioId },
      { populate: ['portfolioOwnerAppuserKey.currencyKey', 'currencyKey'] },
    );

    if (!portfolio) {
      throw new Error(`Portfolio ${portfolioId} not found`);
    }

    // Ensure fresh prices
    await this.ensureFreshPricesForPortfolio(portfolioId);

    // Calculate metrics using FIFO holdings. Holdings are valued in the owner's currency, so
    // these are the user-currency figures; the portfolio-currency ones are converted from them.
    // Converting them again, portfolio to owner, counted a foreign-currency portfolio twice, and
    // an exact-date rate lookup valued it at nothing on days without a rate.
    const { costBasis: appuserCurrencyCostBasis, totalValue: appuserCurrencyTotalValue } = await this.calculatePortfolioMetrics(
      portfolio.portfolioOwnerAppuserKey,
      portfolioId,
    );

    const appuserCurrency = portfolio.portfolioOwnerAppuserKey.currencyKey;
    const portfolioCurrency = portfolio.currencyKey;
    const totalValue = await convertAtLatestRate(DI.em, appuserCurrencyTotalValue, appuserCurrency, portfolioCurrency, today);
    const costBasis = await convertAtLatestRate(DI.em, appuserCurrencyCostBasis, appuserCurrency, portfolioCurrency, today);

    // Find existing snapshot for today or create new one
    let snapshot = await DI.em.findOne(PortfolioSnapshot, {
      portfolioKey: { portfolioKey: portfolioId },
      snapshotDate: today,
    });

    if (snapshot) {
      // Update existing snapshot
      snapshot.totalValue = totalValue ?? undefined;
      snapshot.costBasis = costBasis ?? undefined;
      snapshot.appuserCurrencyTotalValue = appuserCurrencyTotalValue;
      snapshot.appuserCurrencyCostBasis = appuserCurrencyCostBasis;
      snapshot.appuserCurrencyKey = appuserCurrency;
    } else {
      // Create new snapshot
      snapshot = new PortfolioSnapshot();
      snapshot.portfolioKey = portfolio;
      snapshot.snapshotDate = today;
      snapshot.totalValue = totalValue ?? undefined;
      snapshot.costBasis = costBasis ?? undefined;
      snapshot.currencyKey = portfolio.currencyKey;
      snapshot.appuserCurrencyTotalValue = appuserCurrencyTotalValue;
      snapshot.appuserCurrencyCostBasis = appuserCurrencyCostBasis;
      snapshot.appuserCurrencyKey = appuserCurrency;
      DI.em.persist(snapshot);
    }

    await DI.em.flush();
    return snapshot;
  }

  /**
   * Update snapshots for all portfolios belonging to a user
   */
  async updateAllSnapshotsForUser(appuserKey: number): Promise<void> {
    const portfolios = await DI.em.find(Portfolio, {
      deletedAt: undefined,
      portfolioOwnerAppuserKey: { appuserKey },
    });

    for (const portfolio of portfolios) {
      await this.updateSnapshotForToday(portfolio.portfolioKey);
    }
  }
}

function addUtcDays(date: Date | string, days: number): Date {
  const utcDate = startOfUtcDay(date);
  return new Date(Date.UTC(utcDate.getUTCFullYear(), utcDate.getUTCMonth(), utcDate.getUTCDate() + days));
}

function isValidFeeExchangeRate(rate: unknown): rate is number {
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0;
}

function startOfUtcDay(date: Date | string): Date {
  const parsedDate = date instanceof Date ? date : new Date(date);
  return new Date(Date.UTC(parsedDate.getUTCFullYear(), parsedDate.getUTCMonth(), parsedDate.getUTCDate()));
}

export default new PortfolioSnapshotService();
