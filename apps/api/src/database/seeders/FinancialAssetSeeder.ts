// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import type { Dictionary, EntityManager } from '@mikro-orm/core';

import { FinancialAsset } from '@entity/FinancialAsset';
import { Seeder } from '@mikro-orm/seeder';

import { createSeedRandom, randomInt } from '../utils/seed';
import stockList from './stock_list_clean.json' with { type: 'json' };

// The in-scope Certificados de Aforro series (Portuguese savings certificates).
const CERTIFICADO_AFORRO_SERIES = [
  { name: 'Certificado de Aforro — Série A', symbol: 'CA-SERIE-A' },
  { name: 'Certificado de Aforro — Série B', symbol: 'CA-SERIE-B' },
  { name: 'Certificado de Aforro — Série C', symbol: 'CA-SERIE-C' },
  { name: 'Certificado de Aforro — Série D', symbol: 'CA-SERIE-D' },
  { name: 'Certificado de Aforro — Série E', symbol: 'CA-SERIE-E' },
  { name: 'Certificado de Aforro — Série F', symbol: 'CA-SERIE-F' },
];

export class FinancialAssetSeeder extends Seeder {
  async run(em: EntityManager, ctx: Dictionary): Promise<void> {
    const random = createSeedRandom('financial-assets');
    const stockListParsed = stockList as {
      exchangeShortName: string;
      name: string;
      symbol: string;
      type: string;
    }[];
    ctx.financialAssets = stockListParsed.map((stock) =>
      em.create(FinancialAsset, {
        currencyKey: ctx.financialAssetExchanges.find((c) => c.acronym === stock.exchangeShortName)?.currencyKey,
        esgScore: randomInt(random, 0, 99),
        financialAssetCompanyKey: ctx.financialAssetCompanies.find((company) => company.name === stock.name)
          ?.financialAssetCompanyKey,
        financialAssetExchangeKey: ctx.financialAssetExchanges.find(
          (e) => e.acronym.toLowerCase() === stock.exchangeShortName.toLowerCase(),
        )?.financialAssetExchangeKey,
        financialAssetTypeKey: ctx.financialAssetTypes.find(
          (type) => type.name.toLowerCase() === stock.type.toLowerCase(),
        )?.financialAssetTypeKey,
        // EODHD exposes no logo endpoint, so seed no logo rather than a URL that is
        // known not to resolve (it would render a broken image).
        logoUrl: undefined,
        name: stock.name,
        symbol: stock.symbol,
      }),
    );
    // Create Cash Assets using the currencies
    ctx.financialAssets = ctx.financialAssets.concat(
      ctx.currencies.map((currency) =>
        em.create(FinancialAsset, {
          currencyKey: currency.currencyKey,
          financialAssetCompanyKey: undefined,
          financialAssetExchangeKey: undefined,
          financialAssetTypeKey: ctx.financialAssetTypes.find((type) => type.name.toLowerCase() === 'cash')
            ?.financialAssetTypeKey,
          name: currency.code,
          symbol: `CURRENCY_${currency.code}`, // CURRENCY_USD, CURRENCY_EUR, etc.
        }),
      ),
    );

    // Create the 6 in-scope Certificado de Aforro series, one FinancialAsset
    // row per series, all denominated in EUR.
    const eurCurrency = ctx.currencies.find((currency) => currency.code === 'EUR');
    const savingsCertificateType = ctx.financialAssetTypes.find(
      (type) => type.name === 'Savings Certificate',
    );
    ctx.financialAssets = ctx.financialAssets.concat(
      CERTIFICADO_AFORRO_SERIES.map((series) =>
        em.create(FinancialAsset, {
          currencyKey: eurCurrency,
          financialAssetTypeKey: savingsCertificateType,
          isActivelyTrading: false,
          name: series.name,
          symbol: series.symbol,
        }),
      ),
    );
  }
}
