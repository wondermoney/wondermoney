// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import type { Dictionary, EntityManager } from '@mikro-orm/core';

import { FinancialAssetPrice } from '@entity/FinancialAssetPrice';
import { Seeder } from '@mikro-orm/seeder';
import { startOfDay, subDays } from 'date-fns';

import { createSeedRandom, getSeedNow, randomFloat, randomInt, requireSeedDependency } from '../utils/seed';

const PRICE_DAYS = 400;
const TARGET_SYMBOLS = ['AAPL', 'GOOGL', 'INTC', 'NVDA', 'CRM', 'TXN'];
const BASE_PRICES: Record<string, number> = {
  AAPL: 120,
  CRM: 110,
  GOOGL: 80,
  INTC: 23,
  NVDA: 132,
  TXN: 170,
};

export class FinancialAssetPriceSeeder extends Seeder {
  async run(em: EntityManager, ctx: Dictionary): Promise<void> {
    const pricesBySymbol: Record<string, { date: Date; price: number }[]> = {};
    const random = createSeedRandom('financial-asset-prices');
    const seedNow = getSeedNow();

    for (const symbol of TARGET_SYMBOLS) {
      const asset = requireSeedDependency(
        ctx.financialAssets.find((a) => a.symbol === symbol),
        `${symbol} financial asset`,
      );

      let price = BASE_PRICES[symbol];
      const prices: { date: Date; price: number }[] = [];

      for (let day = PRICE_DAYS; day >= 0; day--) {
        const date = startOfDay(subDays(seedNow, day));
        const volume = randomInt(random, 1_000_000, 50_000_000);

        em.create(FinancialAssetPrice, {
          date,
          financialAssetKey: asset.financialAssetKey,
          price: Math.round(price * 100) / 100,
          volume,
        });

        prices.push({ date, price: Math.round(price * 100) / 100 });

        // Random walk with slight upward bias
        price = price * (1 + (randomFloat(random, 0, 1) - 0.48) * 0.03);
      }

      pricesBySymbol[symbol] = prices;
    }

    ctx.financialAssetPrices = pricesBySymbol;
  }
}
