import { render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { SyncHistoryScreen, type SyncHistoryScreenState } from '../sync-history-screen'
import type { BankSyncHistoryRow } from '../sync-history-view-model'

const row = (over: Partial<BankSyncHistoryRow> = {}): BankSyncHistoryRow => ({
  accounts: 3,
  error: null,
  finishedAt: '2026-07-21T10:05:00.000Z',
  flow: 'scheduled-refresh',
  result: 'full_success',
  retryAt: null,
  rowsCreated: 12,
  startedAt: '2026-07-21T10:00:00.000Z',
  ...over,
})

const loaded = (rows: readonly BankSyncHistoryRow[]): SyncHistoryScreenState => ({ status: 'loaded', rows })

const baseProps = {
  onBack: jest.fn(),
  onRetry: jest.fn(),
}

const renderScreen = async (state: SyncHistoryScreenState) => {
  const i18n = await initMobileI18n('en')
  return render(
    <I18nextProvider i18n={i18n}>
      <SyncHistoryScreen {...baseProps} state={state} institutionName="Real Bank" />
    </I18nextProvider>,
  )
}

describe('SyncHistoryScreen', () => {
  it('shows each run and a failure in plain words with the action that helps', async () => {
    const view = await renderScreen(loaded([
      row(),
      row({
        accounts: 2,
        error: { actionKey: 'bank-sync.actions.reconnect', messageKey: 'bank-sync.errors.consent-expired' },
        finishedAt: '2026-07-20T10:05:00.000Z',
        flow: 'initial-add',
        result: 'failed',
        rowsCreated: null,
        startedAt: '2026-07-20T10:00:00.000Z',
      }),
    ]))

    expect(view.getByText('Succeeded')).toBeOnTheScreen()
    expect(view.getByText('Failed')).toBeOnTheScreen()
    expect(view.getByText('Your access to this bank has expired.')).toBeOnTheScreen()
    expect(view.getByText('Reconnect your bank')).toBeOnTheScreen()
    expect(view.getByText('3 accounts')).toBeOnTheScreen()
    expect(view.getByText('12 new transactions')).toBeOnTheScreen()
  })

  it('gives a rate-limited run the next attempt time', async () => {
    const view = await renderScreen(loaded([
      row({
        error: { actionKey: 'bank-sync.actions.wait', messageKey: 'bank-sync.errors.rate-limited' },
        result: 'failed',
        retryAt: '2026-07-21T11:05:00.000Z',
      }),
    ]))

    expect(view.getByText('The bank limited how often we can sync.')).toBeOnTheScreen()
    expect(view.getByText(/Next attempt/)).toBeOnTheScreen()
  })

  it('says so when the connection has no runs yet', async () => {
    const view = await renderScreen(loaded([]))
    expect(view.getByText('No syncs yet.')).toBeOnTheScreen()
  })

  it('offers a retry when the history could not be loaded', async () => {
    const view = await renderScreen({ status: 'error' })
    expect(view.getByText('Could not load sync history.')).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Retry' })).toBeOnTheScreen()
  })
})
