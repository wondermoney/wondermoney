import { render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { CategorySpendingList } from './category-spending-list'

const rows = [{ id: 1, name: 'Groceries', amount: -120, currency: 'EUR', transactionCount: 4 }]
const leftOut = { currencyCode: 'EUR', isComplete: false, unconvertedTransactions: 2, unconvertedCurrencies: ['USD'] }

async function renderList(props: Partial<React.ComponentProps<typeof CategorySpendingList>> = {}) {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}><CategorySpendingList currency="EUR" locale="en" rows={rows} {...props} /></I18nextProvider>)
}

describe('CategorySpendingList', () => {
  it('says which spending was left out for want of an exchange rate', async () => {
    const view = await renderList({ completeness: leftOut })
    expect(view.getByText('Groceries')).toBeOnTheScreen()
    expect(view.getByTestId('category-spending-unconverted')).toHaveTextContent(/2 transactions in USD are left out/)
  })

  it('says so on an empty list too, where everything may have been left out', async () => {
    const view = await renderList({ rows: [], completeness: leftOut })
    expect(view.getByTestId('category-spending-unconverted')).toBeOnTheScreen()
  })

  it('adds nothing when every amount was converted', async () => {
    const view = await renderList({ completeness: { currencyCode: 'EUR', isComplete: true, unconvertedTransactions: 0, unconvertedCurrencies: [] } })
    expect(view.queryByTestId('category-spending-unconverted')).not.toBeOnTheScreen()
  })
})
