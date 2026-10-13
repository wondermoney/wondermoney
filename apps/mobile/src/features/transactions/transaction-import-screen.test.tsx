import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { TransactionImportScreen, type TransactionImportScreenProps } from './transaction-import-screen'
import type { TransactionImportPhase } from './use-transaction-import'

const accounts = [{ id: 7, name: 'Daily account' }, { id: 8, name: 'Savings' }]

async function renderScreen(state: TransactionImportPhase, overrides: Partial<TransactionImportScreenProps> = {}) {
  const i18n = await initMobileI18n('en')
  const props: TransactionImportScreenProps = {
    state,
    accounts,
    accountsLoading: false,
    selectedAccountId: null,
    onSelectAccount: jest.fn(),
    onPickFile: jest.fn(),
    onReset: jest.fn(),
    onBack: jest.fn(),
    ...overrides,
  }
  const view = await render(<I18nextProvider i18n={i18n}><TransactionImportScreen {...props} /></I18nextProvider>)
  return { view, props }
}

describe('TransactionImportScreen', () => {
  it('lists accounts, disables choose-file until one is selected, and selects on press', async () => {
    const onSelectAccount = jest.fn()
    const { view } = await renderScreen({ phase: 'idle' }, { onSelectAccount })
    expect(view.getByRole('button', { name: 'Choose file' })).toBeDisabled()
    await fireEvent.press(view.getByRole('button', { name: 'Daily account' }))
    expect(onSelectAccount).toHaveBeenCalledWith(7)
  })

  it('enables choose-file once an account is selected and invokes onPickFile', async () => {
    const onPickFile = jest.fn()
    const { view } = await renderScreen({ phase: 'idle' }, { selectedAccountId: 7, onPickFile })
    const button = view.getByRole('button', { name: 'Choose file' })
    expect(button).not.toBeDisabled()
    await fireEvent.press(button)
    expect(onPickFile).toHaveBeenCalled()
  })

  it('shows a loading indicator while accounts are loading', async () => {
    const { view } = await renderScreen({ phase: 'idle' }, { accountsLoading: true, accounts: [] })
    expect(view.getByRole('progressbar', { name: undefined })).toBeOnTheScreen()
    expect(view.getByText('Loading accounts')).toBeOnTheScreen()
  })

  it('shows a no-accounts message when there is nothing to import into', async () => {
    const { view } = await renderScreen({ phase: 'idle' }, { accounts: [] })
    expect(view.getByText('No accounts are available to import into')).toBeOnTheScreen()
  })

  it.each(['uploading', 'starting', 'processing'] as const)('announces the %s phase and disables back', async (phase) => {
    const { view } = await renderScreen({ phase })
    expect(view.getByRole('progressbar')).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Back' })).toBeDisabled()
  })

  it('shows the succeeded outcome and offers import-another or done', async () => {
    const onReset = jest.fn()
    const onBack = jest.fn()
    const { view } = await renderScreen({ phase: 'done', outcome: 'succeeded' }, { onReset, onBack })
    expect(view.getByText('Import complete. New transactions were added.')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Import another file' }))
    expect(onReset).toHaveBeenCalled()
    await fireEvent.press(view.getByRole('button', { name: 'Done' }))
    expect(onBack).toHaveBeenCalled()
  })

  it.each(['partial', 'needs_action', 'stale', 'failed'] as const)('shows the %s outcome message', async (outcome) => {
    const { view } = await renderScreen({ phase: 'done', outcome })
    expect(view.getByRole('alert')).toBeOnTheScreen()
  })

  it('shows a failure reason and retries via onReset', async () => {
    const onReset = jest.fn()
    const { view } = await renderScreen({ phase: 'error', reason: 'unsupported-bank' }, { onReset })
    expect(view.getByText('This bank format is not supported yet.')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Try again' }))
    expect(onReset).toHaveBeenCalled()
  })
})
