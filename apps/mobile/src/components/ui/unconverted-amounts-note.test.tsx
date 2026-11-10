import { render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import type { AmountsCompleteness } from '@/lib/api/completeness'
import { initMobileI18n } from '@/lib/i18n'

import { UnconvertedAmountsNote } from './unconverted-amounts-note'

async function renderNote(completeness: AmountsCompleteness | undefined, language: 'en' | 'pt-PT' | 'es' = 'en') {
  const i18n = await initMobileI18n(language)
  return render(<I18nextProvider i18n={i18n}><UnconvertedAmountsNote completeness={completeness} /></I18nextProvider>)
}

describe('UnconvertedAmountsNote', () => {
  it.each([
    ['no completeness', undefined],
    ['a complete total', { currencyCode: 'EUR', isComplete: true, unconvertedTransactions: 0, unconvertedCurrencies: [] }],
    ['an older server that only names the currency', { currencyCode: 'EUR' }],
  ])('says nothing for %s', async (_case, completeness) => {
    const view = await renderNote(completeness)
    expect(view.queryByTestId('unconverted-amounts-note')).not.toBeOnTheScreen()
  })

  it('names the currencies left out and how many transactions', async () => {
    const view = await renderNote({ currencyCode: 'EUR', isComplete: false, unconvertedTransactions: 3, unconvertedCurrencies: ['GBP', 'USD'] })
    const note = view.getByTestId('unconverted-amounts-note')
    expect(note).toHaveTextContent(/3 transactions in GBP.*USD are left out of this total/)
  })

  it('reads in the singular for one transaction', async () => {
    const view = await renderNote({ currencyCode: 'EUR', isComplete: false, unconvertedTransactions: 1, unconvertedCurrencies: ['JPY'] })
    expect(view.getByTestId('unconverted-amounts-note')).toHaveTextContent('Some amounts are in different currencies: 1 transaction in JPY is left out of this total until an exchange rate is available.')
  })

  it('still says something was left out when the endpoint does not name the currencies', async () => {
    const view = await renderNote({ currencyCode: 'EUR', isComplete: false, unconvertedTransactions: 2 })
    expect(view.getByTestId('unconverted-amounts-note')).toHaveTextContent(/2 transactions are left out of this total/)
  })

  it('is translated into Portuguese and Spanish', async () => {
    const completeness = { currencyCode: 'EUR', isComplete: false, unconvertedTransactions: 2, unconvertedCurrencies: ['USD'] }
    expect((await renderNote(completeness, 'pt-PT')).getByTestId('unconverted-amounts-note')).toHaveTextContent(/2 transações em USD ficam de fora deste total/)
    expect((await renderNote(completeness, 'es')).getByTestId('unconverted-amounts-note')).toHaveTextContent(/2 transacciones en USD quedan fuera de este total/)
  })
})
