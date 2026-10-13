import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { StatementImportScreen, type StatementImportAccountsState, type StatementImportScreenProps } from '../statement-import-screen'
import type { StatementImportPhase } from '../use-statement-import'

const baseProps = {
  onBack: jest.fn(),
  onPickFile: jest.fn(),
  onReset: jest.fn(),
  onRetryAccounts: jest.fn(),
  onSelectAccount: jest.fn(),
}

const loadedAccounts: StatementImportAccountsState = { status: 'loaded', accounts: [{ accountId: 1, name: 'Checking' }, { accountId: 2, name: null }] }

async function renderScreen(overrides: Partial<StatementImportScreenProps> & { state: StatementImportPhase; accountsState: StatementImportAccountsState; selectedAccountId: null | number }) {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}><StatementImportScreen {...baseProps} {...overrides} /></I18nextProvider>)
}

describe('StatementImportScreen', () => {
  afterEach(() => jest.clearAllMocks())

  it('shows an account loading state', async () => {
    const view = await renderScreen({ state: { phase: 'idle' }, accountsState: { status: 'loading' }, selectedAccountId: null })
    expect(view.getByText('Loading your accounts')).toBeOnTheScreen()
  })

  it('offers a retry when the account list fails', async () => {
    const onRetryAccounts = jest.fn()
    const view = await renderScreen({ state: { phase: 'idle' }, accountsState: { status: 'error' }, selectedAccountId: null, onRetryAccounts })
    await fireEvent.press(view.getByRole('button', { name: 'Retry' }))
    expect(onRetryAccounts).toHaveBeenCalledTimes(1)
  })

  it('lists accounts to pick from and disables Choose file until one is selected', async () => {
    const view = await renderScreen({ state: { phase: 'idle' }, accountsState: loadedAccounts, selectedAccountId: null })
    expect(view.getByRole('radio', { name: 'Checking' })).toBeOnTheScreen()
    expect(view.getByRole('radio', { name: 'Unnamed account' })).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Choose a CSV file' })).toBeDisabled()
  })

  it('enables Choose file once an account is selected and triggers the picker', async () => {
    const onPickFile = jest.fn()
    const view = await renderScreen({ state: { phase: 'idle' }, accountsState: loadedAccounts, selectedAccountId: 1, onPickFile })
    const button = view.getByRole('button', { name: 'Choose a CSV file' })
    expect(button).not.toBeDisabled()
    await fireEvent.press(button)
    expect(onPickFile).toHaveBeenCalledTimes(1)
  })

  it('selects an account when its row is pressed', async () => {
    const onSelectAccount = jest.fn()
    const view = await renderScreen({ state: { phase: 'idle' }, accountsState: loadedAccounts, selectedAccountId: null, onSelectAccount })
    await fireEvent.press(view.getByRole('radio', { name: 'Checking' }))
    expect(onSelectAccount).toHaveBeenCalledWith(1)
  })

  it('shows a busy indicator while uploading or processing', async () => {
    const view = await renderScreen({ state: { phase: 'uploading' }, accountsState: loadedAccounts, selectedAccountId: 1 })
    expect(view.getByRole('progressbar')).toBeOnTheScreen()
    expect(view.getByText('Uploading your statement…')).toBeOnTheScreen()
  })

  it('shows the imported count on success', async () => {
    const view = await renderScreen({
      state: { phase: 'succeeded', summary: { duplicateRows: 1, failedRows: 0, importedRows: 9, totalRows: 10 } },
      accountsState: loadedAccounts,
      selectedAccountId: 1,
    })
    expect(view.getByText('Imported 9 transactions.')).toBeOnTheScreen()
  })

  it('falls back to a generic success message without a summary', async () => {
    const view = await renderScreen({ state: { phase: 'succeeded', summary: undefined }, accountsState: loadedAccounts, selectedAccountId: 1 })
    expect(view.getByText('Your statement was imported.')).toBeOnTheScreen()
  })

  it('shows a classified failure message and a retry action', async () => {
    const onReset = jest.fn()
    const view = await renderScreen({ state: { phase: 'failed', reason: 'processing-failed' }, accountsState: loadedAccounts, selectedAccountId: 1, onReset })
    expect(view.getByText('That statement could not be imported. Check the file and try again.')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Try again' }))
    expect(onReset).toHaveBeenCalledTimes(1)
  })
})
