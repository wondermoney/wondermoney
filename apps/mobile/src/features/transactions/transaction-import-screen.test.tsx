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
    flow: null,
    bankName: null,
    typeCodes: [],
    templateStatus: 'idle',
    onShareTemplate: jest.fn(),
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
    const { view } = await renderScreen({ phase: 'done', outcome: 'succeeded', format: 'bank', rows: null }, { onReset, onBack })
    expect(view.getByText('Import complete. New transactions were added.')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Import another file' }))
    expect(onReset).toHaveBeenCalled()
    await fireEvent.press(view.getByRole('button', { name: 'Done' }))
    expect(onBack).toHaveBeenCalled()
  })

  it.each(['partial', 'needs_action', 'stale', 'failed'] as const)('shows the %s outcome message', async (outcome) => {
    const { view } = await renderScreen({ phase: 'done', outcome, format: 'bank', rows: null })
    expect(view.getByRole('alert')).toBeOnTheScreen()
  })

  it('explains the generic columns and shares the template for an account without a supported bank', async () => {
    const onShareTemplate = jest.fn()
    const { view } = await renderScreen({ phase: 'idle' }, { selectedAccountId: 7, flow: 'generic', onShareTemplate })
    for (const column of ['date', 'amount', 'merchant', 'internalTransactionId', 'transactionTypeKey', 'description']) {
      expect(view.getByText(new RegExp(`^${column}( \\(optional\\))?$`))).toBeOnTheScreen()
    }
    expect(view.getByRole('button', { name: 'Choose file' })).not.toBeDisabled()
    await fireEvent.press(view.getByRole('button', { name: 'Share template' }))
    expect(onShareTemplate).toHaveBeenCalled()
  })

  it('lists the type codes on request', async () => {
    const { view } = await renderScreen({ phase: 'idle' }, { selectedAccountId: 7, flow: 'generic', typeCodes: [{ code: 3, label: 'Payment' }] })
    expect(view.queryByText('Payment')).not.toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Show type codes' }))
    expect(view.getByText('3')).toBeOnTheScreen()
    expect(view.getByText('Payment')).toBeOnTheScreen()
  })

  it('says when the template could not be shared', async () => {
    const { view } = await renderScreen({ phase: 'idle' }, { selectedAccountId: 7, flow: 'generic', templateStatus: 'error' })
    expect(view.getByRole('alert')).toBeOnTheScreen()
  })

  it('asks for the bank\'s own export for an account at a supported bank, without the generic columns', async () => {
    const { view } = await renderScreen({ phase: 'idle' }, { selectedAccountId: 7, flow: 'bank', bankName: 'Millennium BCP' })
    expect(view.getByText(/Millennium BCP/)).toBeOnTheScreen()
    expect(view.queryByTestId('transaction-import-generic-format')).not.toBeOnTheScreen()
    expect(view.queryByRole('button', { name: 'Share template' })).not.toBeOnTheScreen()
  })

  it('shows a safe message and no file picker for a format this build does not know', async () => {
    const { view } = await renderScreen({ phase: 'idle' }, { selectedAccountId: 7, flow: 'unknown' })
    expect(view.getByRole('alert')).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Choose file' })).toBeDisabled()
    expect(view.queryByTestId('transaction-import-generic-format')).not.toBeOnTheScreen()
  })

  it('says how many rows of a partial generic import could not be imported', async () => {
    const { view } = await renderScreen({ phase: 'done', outcome: 'partial', format: 'generic', rows: { failed: 1, total: 2 } })
    expect(view.getByText(/^1 of 2 rows couldn't be imported/)).toBeOnTheScreen()
  })

  it('gives no row count for a bank import', async () => {
    const { view } = await renderScreen({ phase: 'done', outcome: 'partial', format: 'bank', rows: { failed: 1, total: 2 } })
    expect(view.queryByText(/rows couldn't be imported/)).not.toBeOnTheScreen()
  })

  it('shows a failure reason and retries via onReset', async () => {
    const onReset = jest.fn()
    const { view } = await renderScreen({ phase: 'error', reason: 'unsupported-bank' }, { onReset })
    expect(view.getByText('This bank format is not supported yet.')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Try again' }))
    expect(onReset).toHaveBeenCalled()
  })
})
