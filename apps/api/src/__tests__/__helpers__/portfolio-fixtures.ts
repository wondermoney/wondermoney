/**
 * A portfolio, one asset and the reference rows the portfolio services read, on top of a
 * `finance-fixtures.ts` household. For tests that run against `pg-test-db.ts`.
 */
import type { EntityManager } from '@mikro-orm/postgresql';

import { FINANCIAL_TRANSACTION_TYPES } from '@app/constants/financial-transaction-types';
import { Appuser } from '@entity/Appuser';
import { Currency } from '@entity/Currency';
import { ExchangeRate } from '@entity/ExchangeRate';
import { FinancialAsset } from '@entity/FinancialAsset';
import { FinancialAssetPrice } from '@entity/FinancialAssetPrice';
import { FinancialAssetType } from '@entity/FinancialAssetType';
import { FinancialTransactionType } from '@entity/FinancialTransactionType';
import { Portfolio } from '@entity/Portfolio';

import type { Household } from './finance-fixtures';

export interface PortfolioSetup {
  /** The owner, loaded in the setup's own EntityManager with its currency. */
  appuser: Appuser;
  asset: FinancialAsset;
  em: EntityManager;
  portfolio: Portfolio;
  usd: Currency;
}

export async function addAssetPrice(em: EntityManager, asset: FinancialAsset, day: string, price: number): Promise<void> {
  em.create(FinancialAssetPrice, { date: new Date(`${day}T00:00:00Z`), financialAssetKey: asset, price, volume: 0 });
  await em.flush();
}

/** A USD-priced stock in a portfolio held in `portfolioCurrency` (the user's EUR by default). */
export async function seedPortfolio(em: EntityManager, household: Household, options: { portfolioCurrency?: 'EUR' | 'USD' } = {}): Promise<PortfolioSetup> {
  const usd = em.create(Currency, { code: 'USD', num: '840' }, { partial: true });
  for (const [name, key] of Object.entries(FINANCIAL_TRANSACTION_TYPES)) {
    em.create(FinancialTransactionType, { financialTransactionTypeKey: key, name }, { partial: true });
  }
  const stock = em.create(FinancialAssetType, { name: 'Stock' }, { partial: true });
  const asset = em.create(FinancialAsset, { currencyKey: usd, financialAssetTypeKey: stock, name: 'Apple', symbol: 'AAPL' }, { partial: true });
  await em.flush();
  const currency = options.portfolioCurrency === 'USD' ? usd : await em.findOneOrFail(Currency, { currencyKey: household.currency.currencyKey });
  const appuser = await em.findOneOrFail(Appuser, { appuserKey: household.appuser.appuserKey }, { filters: false, populate: ['currencyKey'] });
  const portfolio = em.create(Portfolio, { currencyKey: currency, name: 'Shares', portfolioOwnerAppuserKey: appuser, tenantKey: household.tenant }, { partial: true });
  await em.flush();
  return { appuser, asset, em, portfolio, usd };
}

/** An ECB-style rate row: dated midnight UTC on a business day. */
export async function addExchangeRate(em: EntityManager, from: Currency, to: Currency, day: string, rate: number): Promise<void> {
  em.create(ExchangeRate, { date: new Date(`${day}T00:00:00Z`), fromCurrency: from, rate, toCurrency: to }, { partial: true });
  await em.flush();
}
