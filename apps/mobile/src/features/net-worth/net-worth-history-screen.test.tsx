import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { mapNetWorthHistory } from './net-worth-history-view-model'
import { NetWorthHistoryScreen, type NetWorthHistoryViewState } from './net-worth-history-screen'
import type { NetWorthHistorySummaryDto } from './net-worth-contract'

const summary = (readiness: NetWorthHistorySummaryDto['readiness'], points: NetWorthHistorySummaryDto['points']): NetWorthHistorySummaryDto => ({
  currencyCode: 'EUR', granularity: 'monthly', readiness, points,
})
const p = (date: string, total: number | null, isComplete = true) => ({ date, totalNetWorth: total, accountsTotal: total, portfoliosTotal: 0, loansTotal: 0, isComplete })

const loaded = (s: NetWorthHistorySummaryDto): NetWorthHistoryViewState => ({ status: 'loaded', data: mapNetWorthHistory(s), refreshFailed: false, refreshing: false })

async function renderScreen(state: NetWorthHistoryViewState) {
  const i18n = await initMobileI18n('en')
  const props = { state, onBack: jest.fn(), onRetry: jest.fn(), onLogout: jest.fn() }
  const view = await render(<I18nextProvider i18n={i18n}><NetWorthHistoryScreen {...props} /></I18nextProvider>)
  return { view, props }
}

describe('NetWorthHistoryScreen', () => {
  it('renders the trend with signed textual change and honest unavailable/partial months', async () => {
    const { view } = await renderScreen(loaded(summary('ready', [
      p('2026-01-01', 1000),
      p('2026-02-01', null, false),
      p('2026-03-01', 1500),
    ])))
    expect(view.getByRole('header', { name: 'Net worth trend' })).toBeOnTheScreen()
    // change is expressed as words, not colour alone (appears in the row and the net-change stat)
    expect(view.getAllByText(/up\s.*500/).length).toBeGreaterThanOrEqual(1)
    // null month is explicitly unavailable and marked partial
    expect(view.getAllByText('Not available').length).toBeGreaterThanOrEqual(1)
    expect(view.getAllByText('Partial month').length).toBeGreaterThanOrEqual(1)
  })

  it('shows stats including a signed net change', async () => {
    const { view } = await renderScreen(loaded(summary('ready', [p('2026-01-01', 1000), p('2026-02-01', 800)])))
    expect(view.getByLabelText('Net change, down €200.00')).toBeOnTheScreen()
    expect(view.getByLabelText(/Highest, .*1,000/)).toBeOnTheScreen()
  })

  it('shows an empty-readiness notice and no table', async () => {
    const { view } = await renderScreen(loaded(summary('empty', [p('2026-01-01', null, false), p('2026-02-01', null, false)])))
    expect(view.getByRole('header', { name: 'No trend yet' })).toBeOnTheScreen()
    expect(view.queryByText('Month')).not.toBeOnTheScreen()
  })

  it('warns when history is insufficient but still lists resolved months', async () => {
    const { view } = await renderScreen(loaded(summary('insufficient_history', [p('2026-01-01', 1000), p('2026-02-01', null, false)])))
    expect(view.getByRole('alert')).toBeOnTheScreen()
    expect(view.getByText('Month')).toBeOnTheScreen()
  })

  it('renders loading and retryable error states', async () => {
    const loading = await renderScreen({ status: 'loading' })
    expect(loading.view.getByLabelText('Loading net worth trend')).toBeOnTheScreen()

    const errored = await renderScreen({ status: 'error' })
    await fireEvent.press(errored.view.getByRole('button', { name: 'Retry' }))
    expect(errored.props.onRetry).toHaveBeenCalled()
  })

  it('returns nothing during an access transition', async () => {
    const { view } = await renderScreen({ status: 'access-transition' })
    expect(view.toJSON()).toBeNull()
  })
})
