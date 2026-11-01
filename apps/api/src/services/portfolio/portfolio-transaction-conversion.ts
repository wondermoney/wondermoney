import { type EntityManager, QueryOrder } from '@mikro-orm/core';

import type { Currency } from '@entity/Currency';
import { ExchangeRate } from '@entity/ExchangeRate';

export interface ConvertibleTrade {
  settlementAmount: number;
  settlementCurrencyKey: Currency;
  settlementUnitAmount: number;
  transactionDate?: Date;
}

/** A portfolio trade's amounts in its owner's currency (`appuser_*` columns). All absent: no conversion. */
export interface UserCurrencyConversion {
  appuserCurrencyExchangeRate?: number;
  appuserSettlementAmount?: number;
  appuserUnitAmount?: number;
}

/**
 * The rate to convert a trade at: the latest published on or before its date. ECB rates are
 * stored at midnight UTC on business days, so an exact-date match missed every trade made during
 * the day or on a weekend and left it unconverted.
 */
async function findLatestExchangeRate(em: EntityManager, fromCurrency: Currency, toCurrency: Currency, date: Date): Promise<ExchangeRate | null> {
  return em.findOne(
    ExchangeRate,
    { date: { $lte: date }, fromCurrency, toCurrency },
    { orderBy: { date: QueryOrder.DESC } },
  );
}

/**
 * What a trade stores in the user's currency. A trade settled in the user's own currency, or one
 * with no date or no rate published by its date, stores no conversion: holdings then read the
 * settlement amounts. Creating, editing and repairs all go through this, so they agree.
 */
export async function resolveUserCurrencyConversion(em: EntityManager, trade: ConvertibleTrade, userCurrency: Currency): Promise<UserCurrencyConversion> {
  if (trade.settlementCurrencyKey.currencyKey === userCurrency.currencyKey || !trade.transactionDate) return {};
  const exchangeRate = await findLatestExchangeRate(em, trade.settlementCurrencyKey, userCurrency, trade.transactionDate);
  if (!exchangeRate) return {};
  return {
    appuserCurrencyExchangeRate: exchangeRate.rate,
    appuserSettlementAmount: trade.settlementAmount * exchangeRate.rate,
    appuserUnitAmount: trade.settlementUnitAmount * exchangeRate.rate,
  };
}

/** Assigns a conversion to a trade, clearing whatever conversion it held before. */
export function applyUserCurrencyConversion(trade: UserCurrencyConversion, conversion: UserCurrencyConversion): void {
  trade.appuserCurrencyExchangeRate = conversion.appuserCurrencyExchangeRate;
  trade.appuserSettlementAmount = conversion.appuserSettlementAmount;
  trade.appuserUnitAmount = conversion.appuserUnitAmount;
}
