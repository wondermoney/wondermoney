// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import type { Dictionary, EntityManager } from '@mikro-orm/core';

import { ExchangeRate } from '@entity/ExchangeRate';
import { Seeder } from '@mikro-orm/seeder';

import exchangeRateList from './exchange_rate_eur_ecb_20200101_20221215.json' with { type: 'json' };

export class ExchangeRateSeeder extends Seeder {
  async run(em: EntityManager, ctx: Dictionary): Promise<void> {
    const exchangeRateListParsed = exchangeRateList as {
      d: string;
      f: string;
      r: number;
      t: string;
    }[];
    exchangeRateListParsed.forEach((exchangeRate) => {
      em.create(ExchangeRate, {
        date: exchangeRate.d,
        fromCurrency: ctx.currencies.find((c) => c.code === exchangeRate.f)!.currencyKey,
        rate: exchangeRate.r,
        toCurrency: ctx.currencies.find((c) => c.code === exchangeRate.t)!.currencyKey,
      });
    });
  }
}
