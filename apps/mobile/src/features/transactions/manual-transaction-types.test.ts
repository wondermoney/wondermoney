import { initMobileI18n } from '@/lib/i18n'

import { defaultTypeOfKind, formatManualTransactionType, knownManualTransactionTypes, manualTransactionKind, typesOfKind } from './manual-transaction-types'

describe('manual transaction type localization', () => {
  it.each(['en', 'pt-PT', 'es'])('localizes every current API type and uses a safe localized fallback in %s', async (locale) => {
    const i18n = await initMobileI18n(locale)
    for (const type of knownManualTransactionTypes) {
      const translated = formatManualTransactionType(i18n.t, type)
      expect(translated).not.toBe(`transactionCreate.types.${type.toLowerCase()}`)
      expect(translated.trim()).not.toBe('')
    }
    const fallback = formatManualTransactionType(i18n.t, 'FUTURE_PRIVATE_TYPE')
    expect(fallback).toContain('future private type')
    expect(fallback).not.toContain('transactionCreate.types')
  })
})

describe('manual transaction kinds', () => {
  it('sorts every current API type under expense, income or transfer by the direction the server applies', () => {
    const kinds = Object.fromEntries(knownManualTransactionTypes.map((type) => [type, manualTransactionKind(type.toLowerCase())]))
    expect(kinds).toEqual({
      TRANSFER_IN: 'transfer', TRANSFER_OUT: 'transfer',
      PAYMENT: 'expense', CARD_PAYMENT: 'expense', ATM: 'expense', LOAN: 'expense', FEE: 'expense',
      TOPUP: 'income', EXCHANGE: 'income', DEPOSIT: 'income', REVERT: 'income', REWARD: 'income', CASHBACK: 'income', CARD_REFUND: 'income',
    })
  })

  it('starts each kind on its preferred type when the server offers it, else on its first', () => {
    const types = [{ id: 1, name: 'payment' }, { id: 2, name: 'card_payment' }, { id: 3, name: 'reward' }, { id: 4, name: 'transfer_in' }]
    expect(defaultTypeOfKind(types, 'expense')?.id).toBe(2)
    expect(defaultTypeOfKind(types, 'income')?.id).toBe(3)
    expect(defaultTypeOfKind(types, 'transfer')?.id).toBe(4)
    expect(defaultTypeOfKind([], 'expense')).toBeNull()
    expect(typesOfKind(types, 'expense').map((type) => type.id)).toEqual([1, 2])
  })
})
