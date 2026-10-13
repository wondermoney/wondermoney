import { initMobileI18n } from '@/lib/i18n'

import { formatManualTransactionType, knownManualTransactionTypes } from './manual-transaction-types'

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
