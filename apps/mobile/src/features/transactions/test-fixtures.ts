import type { TransactionDto } from './transactions-contract'

export const transactionFixture: TransactionDto = {
  transactionKey: 41,
  transactionDate: '2026-07-18T10:00:00.000Z',
  transactionTypeKey: { name: 'debit' },
  accountKey: { accountKey: 7, accountName: 'Daily account', currencyKey: { code: 'EUR' } },
  description: 'Card purchase',
  descriptionDirty: 'CARD PURCHASE 1234',
  settlementAmount: 12.5,
  settlementCurrencyKey: { code: 'EUR' },
  appuserSettlementAmount: 12.5,
  appuserCurrencyKey: { code: 'EUR' },
  balance: 987.5,
  appuserCurrencyBalance: 987.5,
  transactionMerchantKey: { name: 'Corner shop' },
  reviewed: false,
  appuserTransactionCategories: [{ categoryKey: 3, name: 'Groceries', isSystemCategory: true }],
  recurringSeries: null,
}

export const nullishTransactionFixture: TransactionDto = {
  ...transactionFixture,
  accountKey: { ...transactionFixture.accountKey, accountName: null },
  settlementAmount: null,
  settlementCurrencyKey: null,
  appuserSettlementAmount: null,
  appuserCurrencyKey: null,
  balance: null,
  appuserCurrencyBalance: null,
}

/** A ¥10,000 purchase with no exchange rate: no converted amount, `fxStatus` `missing`. */
export const unconvertedTransactionFixture: TransactionDto = {
  ...transactionFixture,
  transactionKey: 51,
  transactionMerchantKey: { name: 'Tokyo kiosk' },
  settlementAmount: -10_000,
  settlementCurrencyKey: { code: 'JPY' },
  appuserSettlementAmount: null,
  appuserCurrencyKey: { code: 'EUR' },
  fxStatus: 'missing',
  fxRateDate: null,
}

/** The same purchase converted at an old rate: `fxStatus` `provisional`, dated `fxRateDate`. */
export const estimatedTransactionFixture: TransactionDto = {
  ...unconvertedTransactionFixture,
  transactionKey: 52,
  transactionMerchantKey: { name: 'Osaka cafe' },
  appuserSettlementAmount: -60,
  fxStatus: 'provisional',
  fxRateDate: '2026-11-03',
}
