import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { RecentTransactionsSection, type RecentTransactionsSectionState } from './recent-transactions-section'

async function renderSection(state: RecentTransactionsSectionState, onRetry = jest.fn()) {
  const i18n = await initMobileI18n('en')
  const view = await render(
    <I18nextProvider i18n={i18n}>
      <RecentTransactionsSection state={state} onRetry={onRetry} />
    </I18nextProvider>,
  )
  return { view, onRetry }
}

describe('RecentTransactionsSection', () => {
  it('renders persisted rows with textual credit/debit direction and a synthetic initial-balance row', async () => {
    const { view } = await renderSection({
      status: 'loaded',
      stale: false,
      rows: [
        { kind: 'persisted', displayName: 'Blue Bottle', occurredAt: '2026-06-10T09:00:00.000Z', amount: -12.5, currencyCode: 'EUR', direction: 'debit' },
        { kind: 'persisted', displayName: 'Refund', occurredAt: '2026-06-09T09:00:00.000Z', amount: 20, currencyCode: 'EUR', direction: 'credit' },
        { kind: 'synthetic-initial-balance', occurredAt: '2026-01-01T00:00:00.000Z', amount: 100, currencyCode: 'EUR' },
      ],
    })
    expect(view.getByRole('header', { name: 'Recent transactions' })).toBeOnTheScreen()
    expect(view.getByLabelText(/Blue Bottle,.*€12\.50, Debit/)).toBeOnTheScreen()
    expect(view.getByLabelText(/Refund,.*€20\.00, Credit/)).toBeOnTheScreen()
    expect(view.getByLabelText(/Initial balance,.*€100\.00/)).toBeOnTheScreen()
  })

  it('shows honest unavailable copy for null name, date and amount', async () => {
    const { view } = await renderSection({
      status: 'loaded',
      stale: false,
      rows: [{ kind: 'persisted', displayName: null, occurredAt: null, amount: null, currencyCode: null, direction: null }],
    })
    expect(view.getByText('Unnamed transaction')).toBeOnTheScreen()
    expect(view.getByText('Date unavailable')).toBeOnTheScreen()
    expect(view.getByText('Amount unavailable')).toBeOnTheScreen()
  })

  it('shows an empty state and a stale note', async () => {
    const empty = await renderSection({ status: 'loaded', rows: [], stale: false })
    expect(empty.view.getByText('No transactions yet.')).toBeOnTheScreen()

    const stale = await renderSection({ status: 'loaded', rows: [], stale: true })
    expect(stale.view.getByText('Showing the previously loaded transactions.')).toBeOnTheScreen()
  })

  it('shows a retryable section error without a heading-less blank', async () => {
    const onRetry = jest.fn()
    const { view } = await renderSection({ status: 'error' }, onRetry)
    expect(view.getByRole('header', { name: 'Recent transactions' })).toBeOnTheScreen()
    expect(view.getByRole('alert')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('renders a loading state', async () => {
    const { view } = await renderSection({ status: 'loading' })
    expect(view.getByLabelText('Loading recent transactions')).toBeOnTheScreen()
  })
})
