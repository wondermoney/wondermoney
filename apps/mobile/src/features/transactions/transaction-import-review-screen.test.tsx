import { fireEvent, render, within } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { TransactionImportReviewScreen, type TransactionImportReviewScreenProps } from './transaction-import-review-screen'
import type { ReviewRowModel } from './transaction-import-review-view-model'

const newRow: ReviewRowModel = { id: 1, sourceRow: 2, title: 'Cafe', amount: -12.5, currency: 'EUR', date: '2026-11-03T00:00:00.000Z', status: 'new', marker: null, decidable: true, included: true, error: null }
const duplicateRow: ReviewRowModel = { ...newRow, id: 2, sourceRow: 3, title: 'Rent', amount: -800, status: 'duplicate', marker: 'duplicate', included: false }
const nearRow: ReviewRowModel = { ...newRow, id: 3, sourceRow: 4, title: 'Grocer', status: 'possible_duplicate', marker: 'possible_duplicate', included: false }
const invalidRow: ReviewRowModel = { ...newRow, id: 4, sourceRow: 5, title: null, amount: null, currency: null, date: null, status: 'invalid', marker: 'invalid', decidable: false, included: false, error: 'Bad date' }

async function renderScreen(overrides: Partial<TransactionImportReviewScreenProps> = {}) {
  const i18n = await initMobileI18n('en')
  const props: TransactionImportReviewScreenProps = {
    locale: 'en',
    fileName: 'statement.csv',
    createdAt: '2026-11-10T10:00:00.000Z',
    stage: { kind: 'review', needsMapping: false },
    loadFailed: false,
    rows: [newRow, duplicateRow, nearRow, invalidRow],
    filter: 'all',
    filters: [{ value: 'all', count: 4 }, { value: 'new', count: 1 }, { value: 'duplicate', count: 1 }, { value: 'possible_duplicate', count: 1 }, { value: 'invalid', count: 1 }],
    page: 1,
    pages: 1,
    toImport: 1,
    canCommit: true,
    busy: false,
    committing: false,
    locked: false,
    failure: null,
    dateOrder: null,
    mapping: null,
    onFilterChange: jest.fn(),
    onPageChange: jest.fn(),
    onDecideRow: jest.fn(),
    onDecideAll: jest.fn(),
    onSaveMapping: jest.fn(),
    onDateOrder: jest.fn(),
    onCommit: jest.fn(),
    onRetryRead: jest.fn(),
    onCancel: jest.fn(),
    onRetryLoad: jest.fn(),
    onDone: jest.fn(),
    onImportAnother: jest.fn(),
    onBack: jest.fn(),
    ...overrides,
  }
  const view = await render(<I18nextProvider i18n={i18n}><TransactionImportReviewScreen {...props} /></I18nextProvider>)
  return { view, props }
}

describe('TransactionImportReviewScreen', () => {
  it('names the import by its file, or by the day it started', async () => {
    const { view } = await renderScreen()
    expect(view.getByTestId('transaction-import-name')).toHaveTextContent('statement.csv')
    const unnamed = await renderScreen({ fileName: null })
    expect(unnamed.view.getByTestId('transaction-import-name')).toHaveTextContent('Import of Nov 10, 2026')
  })

  it('marks duplicates, near matches and unreadable rows, and includes only new rows by default', async () => {
    const { view } = await renderScreen()
    expect(view.getByText('Nothing is imported until you confirm. New transactions are included; ones already in the account are skipped.')).toBeOnTheScreen()
    expect(view.getByText('New')).toBeOnTheScreen()
    expect(view.getByText('Already in the account')).toBeOnTheScreen()
    expect(view.getByText('Possible duplicate')).toBeOnTheScreen()
    expect(view.getByText("Couldn't be read")).toBeOnTheScreen()
    expect(view.getByText('Bad date')).toBeOnTheScreen()

    expect(view.getByRole('checkbox', { name: 'Import row 2' })).toBeChecked()
    expect(view.getByRole('checkbox', { name: 'Import row 3' })).not.toBeChecked()
    expect(view.getByRole('checkbox', { name: 'Import row 4' })).not.toBeChecked()
    // An unreadable line can never import, so it offers no choice.
    expect(view.queryByRole('checkbox', { name: 'Import row 5' })).not.toBeOnTheScreen()
    expect(view.getByText('Row 5')).toBeOnTheScreen()
  })

  it('includes or skips one row', async () => {
    const onDecideRow = jest.fn()
    const { view } = await renderScreen({ onDecideRow })
    await fireEvent.press(view.getByRole('checkbox', { name: 'Import row 3' }))
    expect(onDecideRow).toHaveBeenLastCalledWith(2, 'import')
    await fireEvent.press(view.getByRole('checkbox', { name: 'Import row 2' }))
    expect(onDecideRow).toHaveBeenLastCalledWith(1, 'skip')
  })

  it('offers the statuses with rows as filters, the current one selected', async () => {
    const onFilterChange = jest.fn()
    const { view } = await renderScreen({ onFilterChange })
    expect(view.getByRole('tab', { name: 'All (4)' })).toBeSelected()
    await fireEvent.press(view.getByRole('tab', { name: 'Already in the account (1)' }))
    expect(onFilterChange).toHaveBeenCalledWith('duplicate')
    expect(view.queryByRole('button', { name: 'Include all' })).not.toBeOnTheScreen()
  })

  it('includes or skips a whole status at once', async () => {
    const onDecideAll = jest.fn()
    const { view } = await renderScreen({ filter: 'duplicate', rows: [duplicateRow], onDecideAll })
    await fireEvent.press(view.getByRole('button', { name: 'Include all' }))
    expect(onDecideAll).toHaveBeenCalledWith('import')
    await fireEvent.press(view.getByRole('button', { name: 'Skip all' }))
    expect(onDecideAll).toHaveBeenCalledWith('skip')
  })

  it('offers no bulk choice on the unreadable rows', async () => {
    const { view } = await renderScreen({ filter: 'invalid', rows: [invalidRow] })
    expect(view.queryByRole('button', { name: 'Include all' })).not.toBeOnTheScreen()
  })

  it('commits only when the commit is pressed, naming how many rows it writes', async () => {
    const onCommit = jest.fn()
    const onDecideRow = jest.fn()
    const { view } = await renderScreen({ onCommit, onDecideRow, toImport: 3 })
    await fireEvent.press(view.getByRole('checkbox', { name: 'Import row 3' }))
    await fireEvent.press(view.getByRole('tab', { name: 'New (1)' }))
    expect(onCommit).not.toHaveBeenCalled()
    await fireEvent.press(view.getByRole('button', { name: 'Import 3 transactions' }))
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('says when nothing would import, and holds the commit while the session cannot commit', async () => {
    const { view } = await renderScreen({ toImport: 0 })
    expect(view.getByRole('button', { name: 'Nothing to import' })).toBeOnTheScreen()
    const blocked = await renderScreen({ canCommit: false, toImport: 1 })
    expect(blocked.view.getByRole('button', { name: 'Import 1 transaction' })).toBeDisabled()
  })

  it('takes no other choice while a write is in flight, and shows the commit busy', async () => {
    const { view } = await renderScreen({ busy: true, committing: true })
    expect(view.getByRole('checkbox', { name: 'Import row 2' })).toBeDisabled()
    expect(view.getByRole('button', { name: 'Cancel import' })).toBeDisabled()
    expect(view.getByRole('button', { name: 'Import 1 transaction' })).toBeBusy()
  })

  it('locks every write on a read-only demo profile and says why', async () => {
    const onDecideRow = jest.fn()
    const { view } = await renderScreen({ locked: true, failure: 'demo', onDecideRow })
    expect(view.getByText('Importing transactions is unavailable in demo mode.')).toBeOnTheScreen()
    expect(view.getByRole('checkbox', { name: 'Import row 2' })).toBeDisabled()
    expect(view.getByRole('button', { name: 'Import 1 transaction' })).toBeDisabled()
  })

  it('cancels the import', async () => {
    const onCancel = jest.fn()
    const { view } = await renderScreen({ onCancel })
    await fireEvent.press(view.getByRole('button', { name: 'Cancel import' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('pages through the rows', async () => {
    const onPageChange = jest.fn()
    const { view } = await renderScreen({ page: 1, pages: 3, onPageChange })
    expect(view.getByText('Page 1 of 3')).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Previous' })).toBeDisabled()
    await fireEvent.press(view.getByRole('button', { name: 'Next' }))
    expect(onPageChange).toHaveBeenCalledWith(2)
  })

  it('asks for an account for each account in the file before saving them', async () => {
    const onSaveMapping = jest.fn()
    const { view } = await renderScreen({
      stage: { kind: 'review', needsMapping: true },
      canCommit: false,
      mapping: { sources: [{ label: 'Checking', rowCount: 3 }, { label: 'Savings', rowCount: 1 }], accounts: [{ id: 7, name: 'Daily account' }, { id: 8, name: 'Reserve' }], initial: { Savings: 8 } },
      onSaveMapping,
    })
    const mapping = within(view.getByTestId('transaction-import-mapping'))
    expect(mapping.getByText('This file holds several accounts. Choose where each one goes.')).toBeOnTheScreen()
    expect(mapping.getByRole('button', { name: 'Save accounts' })).toBeDisabled()
    await fireEvent.press(mapping.getByRole('button', { name: /^Checking \(3 rows\),/ }))
    await fireEvent.press(view.getByRole('radio', { name: 'Daily account' }))
    await fireEvent.press(mapping.getByRole('button', { name: 'Save accounts' }))
    expect(onSaveMapping).toHaveBeenCalledWith({ Checking: 7, Savings: 8 })
  })

  it('asks which order a QIF file\'s dates are in', async () => {
    const onDateOrder = jest.fn()
    const { view } = await renderScreen({ dateOrder: 'day-first', onDateOrder })
    expect(view.getByText(/they were read day first/)).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Month first (01/31/2026)' }))
    expect(onDateOrder).toHaveBeenCalledWith('month-first')
  })

  it('reports commit progress', async () => {
    const { view } = await renderScreen({ stage: { kind: 'importing', stalled: false, imported: 120, total: 500 } })
    const progress = view.getByRole('progressbar', { name: 'Importing… 120 of 500 transactions so far.' })
    expect(progress).toHaveAccessibilityValue({ min: 0, max: 500, now: 120 })
    expect(view.queryByRole('button', { name: /^Import \d/ })).not.toBeOnTheScreen()
    expect(view.queryByRole('checkbox')).not.toBeOnTheScreen()
  })

  it('carries on a commit whose job stopped', async () => {
    const onCommit = jest.fn()
    const { view } = await renderScreen({ stage: { kind: 'importing', stalled: true, imported: 120, total: 500 }, onCommit })
    expect(view.getByText(/The import stopped before it finished/)).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Try again' }))
    expect(onCommit).toHaveBeenCalled()
  })

  it('says a commit request failed and keeps the review', async () => {
    const { view } = await renderScreen({ failure: 'network' })
    expect(view.getByTestId('transaction-import-review-failure')).toHaveTextContent('Check your connection and try again.')
    expect(view.getByRole('button', { name: 'Import 1 transaction' })).not.toBeDisabled()
  })

  it('reads a file again when its read stopped', async () => {
    const onRetryRead = jest.fn()
    const { view } = await renderScreen({ stage: { kind: 'reading', stalled: true }, onRetryRead })
    await fireEvent.press(view.getByRole('button', { name: 'Try again' }))
    expect(onRetryRead).toHaveBeenCalled()
    const reading = await renderScreen({ stage: { kind: 'reading', stalled: false } })
    expect(reading.view.getByRole('progressbar', { name: 'Reading your file…' })).toBeOnTheScreen()
  })

  it('shows how the import ended', async () => {
    const onDone = jest.fn()
    const onImportAnother = jest.fn()
    const { view } = await renderScreen({ stage: { kind: 'done', outcome: 'partial', imported: 3, skipped: 1, failed: 2, detailsDeleted: false }, onDone, onImportAnother })
    expect(view.getByRole('alert')).toHaveTextContent('3 transactions imported, 1 skipped.')
    expect(view.getByText("2 rows couldn't be imported.")).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Done' }))
    expect(onDone).toHaveBeenCalled()
    await fireEvent.press(view.getByRole('button', { name: 'Import another file' }))
    expect(onImportAnother).toHaveBeenCalled()
  })

  it('says the row details are gone seven days after a commit', async () => {
    const { view } = await renderScreen({ stage: { kind: 'done', outcome: 'succeeded', imported: 1, skipped: 0, failed: 0, detailsDeleted: true } })
    expect(view.getByText(/they are deleted 7 days after an import/)).toBeOnTheScreen()
  })

  it('says an import expired and offers a fresh start', async () => {
    const onImportAnother = jest.fn()
    const { view } = await renderScreen({ stage: { kind: 'expired' }, onImportAnother })
    expect(view.getByText('This import expired before it was finished. Start again with the file.')).toBeOnTheScreen()
    expect(view.queryByRole('checkbox')).not.toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Import another file' }))
    expect(onImportAnother).toHaveBeenCalled()
  })

  it('sends a file with categories to map to the web, offering only to cancel it', async () => {
    const onCancel = jest.fn()
    const { view } = await renderScreen({ stage: { kind: 'needs-web' }, onCancel })
    expect(view.getByText(/import the file on the web/)).toBeOnTheScreen()
    expect(view.queryByRole('button', { name: /^Import \d/ })).not.toBeOnTheScreen()
    expect(view.queryByRole('checkbox')).not.toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Cancel import' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('says a file could not be read', async () => {
    const { view } = await renderScreen({ stage: { kind: 'read-failed' } })
    expect(view.getByText(/We couldn't read this file/)).toBeOnTheScreen()
  })

  it('retries a session that did not load', async () => {
    const onRetryLoad = jest.fn()
    const { view } = await renderScreen({ stage: null, loadFailed: true, onRetryLoad })
    await fireEvent.press(view.getByRole('button', { name: 'Try again' }))
    expect(onRetryLoad).toHaveBeenCalled()
  })
})
