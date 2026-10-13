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
