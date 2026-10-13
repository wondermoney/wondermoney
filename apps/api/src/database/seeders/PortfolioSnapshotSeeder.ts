// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import type { Dictionary, EntityManager } from '@mikro-orm/core';

import { FinancialTransaction } from '@entity/FinancialTransaction';
import { PortfolioSnapshot } from '@entity/PortfolioSnapshot';
import { Seeder } from '@mikro-orm/seeder';
import { addDays, isAfter, startOfDay } from 'date-fns';

import { getSeedToday } from '../utils/seed';

const USD_TO_EUR_RATE = 0.94;

function getCurrencyCode(currency: { code?: string } | undefined): string | undefined {
  return currency?.code;
}

function getSeedExchangeRate(fromCode: string | undefined, toCode: string | undefined): number {
  if (!fromCode || !toCode || fromCode === toCode) return 1;
  if (fromCode === 'USD' && toCode === 'EUR') return USD_TO_EUR_RATE;
  if (fromCode === 'EUR' && toCode === 'USD') return 1 / USD_TO_EUR_RATE;

  return 1;
}

export class PortfolioSnapshotSeeder extends Seeder {
  async run(em: EntityManager, ctx: Dictionary): Promise<void> {
    if (!ctx.portfolios || !ctx.financialAssetPrices) return;

    const today = getSeedToday();

    // Load financial transactions with populated relations
    const allFinancialTransactions = await em.find(
      FinancialTransaction,
      {},
      {
        orderBy: { transactionDate: 'ASC' },
        populate: ['portfolioKey', 'financialAssetKey', 'financialTransactionTypeKey'],
      },
    );

    for (const portfolio of ctx.portfolios) {
      const portfolioTransactions = allFinancialTransactions.filter(
        (t) => t.portfolioKey?.portfolioKey === portfolio.portfolioKey,
      );

      if (portfolioTransactions.length === 0) continue;

      // Find the earliest transaction date
      const earliestDate = startOfDay(portfolioTransactions[0].transactionDate);

      // Track holdings: symbol -> { quantity, totalCost }
      const holdings: Record<string, { quantity: number; totalCost: number }> = {};

      let currentDate = earliestDate;
      let txIdx = 0;

      while (!isAfter(currentDate, today)) {
        // Process all transactions up to and including currentDate
        while (
          txIdx < portfolioTransactions.length &&
          !isAfter(startOfDay(portfolioTransactions[txIdx].transactionDate), currentDate)
        ) {
          const tx = portfolioTransactions[txIdx];
          const assetKey = tx.financialAssetKey?.financialAssetKey;
          const typeName = tx.financialTransactionTypeKey?.name;

          if (assetKey && (typeName === 'BUY' || typeName === 'SELL')) {
            if (!holdings[assetKey]) {
              holdings[assetKey] = { quantity: 0, totalCost: 0 };
            }
            holdings[assetKey].quantity += tx.quantity;
            if (typeName === 'BUY') {
              holdings[assetKey].totalCost += Math.abs(tx.settlementAmount);
            } else {
              // For sells, reduce cost basis proportionally
              const holding = holdings[assetKey];
              if (holding.quantity > 0) {
                const avgCost = holding.totalCost / (holding.quantity - tx.quantity);
                holding.totalCost = avgCost * holding.quantity;
              }
            }
          }
          txIdx++;
        }

        // Calculate portfolio value for this date
        let totalValue = 0;
        let costBasis = 0;

        for (const [assetKeyStr, holding] of Object.entries(holdings)) {
          if (holding.quantity <= 0) continue;

          // Find the asset symbol from the key
          const asset = ctx.financialAssets.find((a) => String(a.financialAssetKey) === assetKeyStr);
          if (!asset) continue;

          // Cash assets don't need price lookup
          if (asset.symbol.startsWith('CURRENCY_')) continue;

          const symbolPrices = ctx.financialAssetPrices[asset.symbol];
          if (!symbolPrices) continue;

          // Find closest price on or before currentDate
          let price: number | null = null;
          for (let i = symbolPrices.length - 1; i >= 0; i--) {
            if (!isAfter(symbolPrices[i].date, currentDate)) {
              price = symbolPrices[i].price;
              break;
            }
          }

          if (price !== null) {
            const assetToPortfolioRate = getSeedExchangeRate(
              getCurrencyCode(asset.currencyKey),
              getCurrencyCode(portfolio.currencyKey),
            );
            totalValue += holding.quantity * price * assetToPortfolioRate;
            costBasis += holding.totalCost;
          }
        }

        // Only create snapshot if there are holdings with value
        if (totalValue > 0) {
          const portfolioToAppuserRate = getSeedExchangeRate(
            getCurrencyCode(portfolio.currencyKey),
            getCurrencyCode(portfolio.portfolioOwnerAppuserKey?.currencyKey),
          );
          // @ts-expect-error - missing PK
          em.create(PortfolioSnapshot, {
            appuserCurrencyCostBasis: Math.round(costBasis * portfolioToAppuserRate * 100) / 100,
            appuserCurrencyKey: portfolio.portfolioOwnerAppuserKey?.currencyKey,
            appuserCurrencyTotalValue: Math.round(totalValue * portfolioToAppuserRate * 100) / 100,
            costBasis: Math.round(costBasis * 100) / 100,
            currencyKey: portfolio.currencyKey,
            portfolioKey: portfolio.portfolioKey,
            snapshotDate: currentDate,
            totalValue: Math.round(totalValue * 100) / 100,
          });
        }

        currentDate = addDays(currentDate, 1);
      }
    }
  }
}
