import type { EntityManager } from '@mikro-orm/core';

import type { Currency } from '@entity/Currency';
import { ExchangeRate } from '@entity/ExchangeRate';
import { big, roundDisplay } from '@utils/money';

/**
 * Convert a value at the latest rate published on or before `date` (ECB rates exist for business
 * days only, so a weekend or holiday takes the previous business day's). Returns the value itself
 * for the same currency, null when no such rate is stored.
 */
export async function convertAtLatestRate(em: EntityManager, value: number, fromCurrency: Currency, toCurrency: Currency, date: Date): Promise<null | number> {
  if (fromCurrency.currencyKey === toCurrency.currencyKey) return value;
  const exchangeRate = await em.findOne(ExchangeRate, { date: { $lte: date }, fromCurrency, toCurrency }, { orderBy: { date: 'desc' } });
  return exchangeRate ? roundDisplay(big(value).times(big(exchangeRate.rate))) : null;
}
