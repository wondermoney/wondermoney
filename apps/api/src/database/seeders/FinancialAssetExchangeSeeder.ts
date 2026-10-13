// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import type { Dictionary, EntityManager } from '@mikro-orm/core';

import { FinancialAssetExchange } from '@entity/FinancialAssetExchange';
import { Seeder } from '@mikro-orm/seeder';

export class FinancialAssetExchangeSeeder extends Seeder {
  async run(em: EntityManager, ctx: Dictionary): Promise<void> {
    const ctxFinancialAssetExchanges = [];
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'NYSE',
        aliases: [1, 2, 3, 4, 5],
        country: 'USA',
        currencyKey: ctx.currencies.find((c) => c.code === 'USD')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/nyse.com',
        name: 'New York Stock Exchange',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'NASDAQ',
        aliases: [6, 7, 8, 9, 10, 11],
        country: 'USA',
        currencyKey: ctx.currencies.find((c) => c.code === 'USD')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/nasdaq.com',
        name: 'National Association of Securities Dealers Automated Quotations',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'AMEX',
        country: 'USA',
        currencyKey: ctx.currencies.find((c) => c.code === 'USD')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/amex.com',
        name: 'American Stock Exchange',
      }),
    );
    // Euronext - begin
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'Euronext',
        currencyKey: ctx.currencies.find((c) => c.code === 'EUR')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/euronext.com',
        name: 'Euronext NV',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'XAMS',
        aliases: [12, 13, 14],
        country: 'Netherlands',
        currencyKey: ctx.currencies.find((c) => c.code === 'EUR')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/euronext.com',
        name: 'Euronext Amsterdam',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'XBRU',
        aliases: [15, 16, 17],
        country: 'Belgium',
        currencyKey: ctx.currencies.find((c) => c.code === 'EUR')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/euronext.com',
        name: 'Euronext Brussels',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'XLIS',
        aliases: [18, 19, 20],
        country: 'Portugal',
        currencyKey: ctx.currencies.find((c) => c.code === 'EUR')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/euronext.com',
        name: 'Euronext Lisbon',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'XPAR',
        aliases: [21, 22, 23],
        country: 'France',
        currencyKey: ctx.currencies.find((c) => c.code === 'EUR')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/euronext.com',
        name: 'Euronext Paris',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'XMSM',
        aliases: [24],
        country: 'Ireland',
        currencyKey: ctx.currencies.find((c) => c.code === 'EUR')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/euronext.com',
        name: 'Euronext Dublin',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'XMIL',
        aliases: [25, 62],
        country: 'Italy',
        currencyKey: ctx.currencies.find((c) => c.code === 'EUR')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/euronext.com',
        name: 'Euronext Milan',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'XOSL',
        aliases: [26],
        country: 'Norway',
        currencyKey: ctx.currencies.find((c) => c.code === 'NOK')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/euronext.com',
        name: 'Euronext Oslo',
      }),
    );
    // Euronext - end
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'TSX',
        aliases: [27, 28, 29, 30],
        country: 'Canada',
        currencyKey: ctx.currencies.find((c) => c.code === 'CAD')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/tsx.com',
        name: 'Toronto Stock Exchange',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'SSE',
        country: 'China',
        name: 'Shanghai Stock Exchange',
        // logoUrl: 'https://logo.clearbit.com/sse.com.cn',
        aliases: [31, 32, 33, 34, 35],
        currencyKey: ctx.currencies.find((c) => c.code === 'CNY')?.currencyKey,
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'SHE',
        country: 'China',
        name: 'Shenzhen Stock Exchange',
        // logoUrl: 'https://logo.clearbit.com/sse.com.cn',
        aliases: [36, 37],
        currencyKey: ctx.currencies.find((c) => c.code === 'CNY')?.currencyKey,
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'JPX',
        aliases: [38, 39, 40, 41, 42],
        country: 'Japan',
        currencyKey: ctx.currencies.find((c) => c.code === 'JPY')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/jpx.co.jp',
        name: 'Japan Exchange Group',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'HKG',
        aliases: [43, 44],
        country: 'Hong Kong',
        currencyKey: ctx.currencies.find((c) => c.code === 'HKD')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/hkex.com.hk',
        name: 'Hong Kong Stock Exchange',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'BOM',
        aliases: [45, 46, 47, 48],
        country: 'India',
        currencyKey: ctx.currencies.find((c) => c.code === 'INR')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/bseindia.com',
        name: 'Bombay Stock Exchange',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'NSE',
        aliases: [49, 50],
        country: 'India',
        currencyKey: ctx.currencies.find((c) => c.code === 'INR')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/nseindia.com',
        name: 'National Stock Exchange',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'LON',
        aliases: [51, 52, 53, 54, 55],
        country: 'United Kingdom',
        currencyKey: ctx.currencies.find((c) => c.code === 'GBP')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/londonstockexchange.com',
        name: 'London Stock Exchange',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'SAU',
        aliases: [56, 57, 58],
        country: 'Saudi Arabia',
        currencyKey: ctx.currencies.find((c) => c.code === 'SAR')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/tadawul.com.sa',
        name: 'Saudi Stock Exchange (Tadawul)',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'SWX',
        aliases: [59, 60, 61],
        country: 'Switzerland',
        currencyKey: ctx.currencies.find((c) => c.code === 'CHF')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/six-swiss-exchange.com',
        name: 'SIX Swiss Exchange',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'ASE',
        aliases: [],
        country: 'United States',
        currencyKey: ctx.currencies.find((c) => c.code === 'USD')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/nyse.com',
        name: 'NYSE American Options',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'ATH',
        aliases: [],
        country: 'Greece',
        currencyKey: ctx.currencies.find((c) => c.code === 'EUR')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/athexgroup.gr',
        name: 'Athens Exchange',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'BATS',
        aliases: [],
        country: 'United Kingdom',
        currencyKey: ctx.currencies.find((c) => c.code === 'EUR')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/bats.com',
        name: 'BATS Europe',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'BER',
        aliases: [],
        country: 'Germany',
        currencyKey: ctx.currencies.find((c) => c.code === 'EUR')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/borse-berlin.de',
        name: 'Berlin Stock Exchange',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'BUD',
        aliases: [],
        country: 'Hungary',
        currencyKey: ctx.currencies.find((c) => c.code === 'HUF')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/bse.hu',
        name: 'Budapest Stock Exchange',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'BUE',
        aliases: [],
        country: 'Argentina',
        currencyKey: ctx.currencies.find((c) => c.code === 'ARS')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/bolsar.com.ar',
        name: 'Buenos Aires Stock Exchange',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'CPH',
        aliases: [],
        country: 'Denmark',
        currencyKey: ctx.currencies.find((c) => c.code === 'DKK')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/nasdaqomxnordic.com',
        name: 'Copenhagen Stock Exchange',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'DFM',
        aliases: [],
        country: 'United Arab Emirates',
        currencyKey: ctx.currencies.find((c) => c.code === 'AED')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/dfm.ae',
        name: 'Dubai Financial Market',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'DOH',
        aliases: [],
        country: 'Qatar',
        currencyKey: ctx.currencies.find((c) => c.code === 'QAR')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/qatarstockexchange.com',
        name: 'Qatar Stock Exchange',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'DUS',
        aliases: [],
        country: 'Germany',
        currencyKey: ctx.currencies.find((c) => c.code === 'EUR')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/borse-dusseldorf.de',
        name: 'Dusseldorf Stock Exchange',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'FGI',
        aliases: [],
        country: 'Finland',
        currencyKey: ctx.currencies.find((c) => c.code === 'EUR')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/fgi.fi',
        name: 'Finnish Grain Exchange',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'FKA',
        aliases: [],
        country: 'Germany',
        currencyKey: ctx.currencies.find((c) => c.code === 'EUR')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/borse-frankfurt.de',
        name: 'Frankfurt Stock Exchange',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'HAM',
        aliases: [],
        country: 'Germany',
        currencyKey: ctx.currencies.find((c) => c.code === 'EUR')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/borse-hamburg.de',
        name: 'Hamburg Stock Exchange',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'HEL',
        aliases: [],
        country: 'Finland',
        currencyKey: ctx.currencies.find((c) => c.code === 'EUR')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/helsinkibourse.fi',
        name: 'Helsinki Stock Exchange',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'IST',
        aliases: [],
        country: 'Turkey',
        currencyKey: ctx.currencies.find((c) => c.code === 'TRY')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/ise.com.tr',
        name: 'Istanbul Stock Exchange',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'JKT',
        aliases: [],
        country: 'Indonesia',
        currencyKey: ctx.currencies.find((c) => c.code === 'IDR')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/idx.co.id',
        name: 'Indonesia Stock Exchange',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'JNB',
        aliases: [],
        country: 'South Africa',
        currencyKey: ctx.currencies.find((c) => c.code === 'ZAR')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/jse.co.za',
        name: 'Johannesburg Stock Exchange',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'KLS',
        aliases: [],
        country: 'Malaysia',
        currencyKey: ctx.currencies.find((c) => c.code === 'MYR')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/bursamalaysia.com',
        name: 'Bursa Malaysia',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'KSC',
        aliases: [],
        country: 'South Korea',
        currencyKey: ctx.currencies.find((c) => c.code === 'KRW')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/krx.co.kr',
        name: 'Korea Exchange',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'MCE',
        aliases: [],
        country: 'Spain',
        currencyKey: ctx.currencies.find((c) => c.code === 'EUR')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/bolsamadrid.es',
        name: 'Bolsa de Madrid',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'MCX',
        aliases: [],
        country: 'Russia',
        currencyKey: ctx.currencies.find((c) => c.code === 'RUB')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/moscowexchange.com',
        name: 'Moscow Exchange',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'MEX',
        aliases: [],
        country: 'Mexico',
        currencyKey: ctx.currencies.find((c) => c.code === 'MXN')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/bmv.com.mx',
        name: 'Bolsa Mexicana de Valores',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'MUN',
        aliases: [],
        country: 'Germany',
        currencyKey: ctx.currencies.find((c) => c.code === 'EUR')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/bmwi.de',
        name: 'Munich Stock Exchange',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'NEO',
        aliases: [],
        country: 'Canada',
        currencyKey: ctx.currencies.find((c) => c.code === 'CAD')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/neoexchange.ca',
        name: 'Aequitas NEO Exchange',
      }),
    );
    ctxFinancialAssetExchanges.push(
      em.create(FinancialAssetExchange, {
        acronym: 'PRA',
        aliases: [],
        country: 'Czech Republic',
        currencyKey: ctx.currencies.find((c) => c.code === 'CZK')?.currencyKey,
        logoUrl: 'https://logo.clearbit.com/psx.cz',
        name: 'Prague Stock Exchange',
      }),
    );
    ctx.financialAssetExchanges = ctxFinancialAssetExchanges;
  }
}
