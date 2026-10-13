// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import type { Dictionary, EntityManager } from '@mikro-orm/core';

import { FinancialAssetCompany } from '@entity/FinancialAssetCompany';
import { Seeder } from '@mikro-orm/seeder';

import stockList from './stock_list_clean.json' with { type: 'json' };

export class FinancialAssetCompanySeeder extends Seeder {
  async run(em: EntityManager, ctx: Dictionary): Promise<void> {
    const stockListParsed = stockList as {
      exchangeShortName: string;
      name: string;
      symbol: string;
      type: string;
    }[];
    const stockCompanies = stockListParsed.map((stock) => stock.name);
    const uniqueStockCompanies = [...new Set(stockCompanies)];
    ctx.financialAssetCompanies = uniqueStockCompanies.map((company) =>
      em.create(FinancialAssetCompany, {
        name: company,
      }),
    );
  }
}
