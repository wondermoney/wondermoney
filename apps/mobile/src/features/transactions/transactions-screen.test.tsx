import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { TransactionsScreen } from './transactions-screen'
import { mapTransactions } from './transactions-view-model'
import { nullishTransactionFixture, transactionFixture } from './test-fixtures'

/**
 * The merchant/account/category/type filters and the custom range now sit
 * behind a "More filters" chip, so the screen opens on the list instead of on
 * a screenful of controls. Tests drive that chip the way a person would.
 */
async function openFilters(view: Awaited<ReturnType<typeof renderLoaded>>['view']) {
  const chip = view.queryByRole('button', { name: /More filters|\d+ filters?/ })
  if (chip) await fireEvent.press(chip)
}


const renderLoaded = async (transactions = [transactionFixture], filters: React.ComponentProps<typeof TransactionsScreen>['filters'] = {}) => {
  const i18n = await initMobileI18n('en')
  const mark = jest.fn().mockResolvedValue('success')
  const changeFilters = jest.fn()
  const bulkReview = jest.fn().mockResolvedValue('success')
  const assignCategory = jest.fn().mockResolvedValue('success')
  const setHidden = jest.fn().mockResolvedValue('success')
  const editAmount = jest.fn().mockResolvedValue('success')
  const categories = { status: 'loaded' as const, categories: [{ id: 7, name: 'Groceries', system: true, color: '#DDEEFF', glyph: '◇', children: [{ id: 8, name: 'Cafes', system: true, color: null, glyph: '□', children: [] }] }] }
  const screen = (pending = false) => <I18nextProvider i18n={i18n}><TransactionsScreen state={{ status: 'loaded', transactions: mapTransactions({ transactions }), refreshing: false }} filters={filters} categories={categories} pending={pending} onBack={jest.fn()} onFiltersChange={changeFilters} onRefresh={jest.fn()} onMarkReviewed={mark} onBulkReview={bulkReview} onAssignCategory={assignCategory} onSetHidden={setHidden} onEditAmount={editAmount} /></I18nextProvider>
  const view = await render(screen())
  return { view, mark, bulkReview, assignCategory, setHidden, editAmount, changeFilters, i18n, screen }
}

describe('TransactionsScreen', () => {
  it('shows localized scan information and progressively discloses read-only detail', async () => {
    const { view, mark } = await renderLoaded()
    expect(view.getByText('Corner shop')).toBeOnTheScreen()
    expect(view.getByText('Groceries · Needs review')).toBeOnTheScreen()
    expect(view.getAllByText('Credit').length).toBeGreaterThan(0)
    await fireEvent.press(view.getByRole('button', { name: /Corner shop/ }))
    expect(view.getByText('CARD PURCHASE 1234')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Mark as reviewed' }))
    expect(mark).toHaveBeenCalledWith(41)
  })
  it('never exposes review mutation for negative synthetic initial balances', async () => {
    const { view } = await renderLoaded([{ ...transactionFixture, transactionKey: -9, description: 'Initial balance', transactionMerchantKey: undefined, reviewed: true }])
    await fireEvent.press(view.getByRole('button', { name: /Initial balance/ }))
    expect(view.queryByRole('button', { name: 'Mark as reviewed' })).not.toBeOnTheScreen()
    expect(view.queryByRole('button', { name: 'Edit amount' })).not.toBeOnTheScreen()
    expect(view.queryByRole('checkbox')).not.toBeOnTheScreen()
  })

  it('offers create, import, and scan-receipt actions when handlers are provided, and omits them when not', async () => {
    const i18n = await initMobileI18n('en')
    const onCreate = jest.fn()
    const onImport = jest.fn()
    const onScanReceipt = jest.fn()
    const view = await render(<I18nextProvider i18n={i18n}><TransactionsScreen state={{ status: 'loaded', transactions: mapTransactions({ transactions: [transactionFixture] }), refreshing: false }} filters={{}} onBack={jest.fn()} onCreate={onCreate} onImport={onImport} onScanReceipt={onScanReceipt} onFiltersChange={jest.fn()} onRefresh={jest.fn()} onMarkReviewed={jest.fn()} /></I18nextProvider>)
    await fireEvent.press(view.getByRole('button', { name: 'Add transaction' }))
    expect(onCreate).toHaveBeenCalled()
    await fireEvent.press(view.getByRole('button', { name: 'Import transactions' }))
    expect(onImport).toHaveBeenCalled()
    await fireEvent.press(view.getByRole('button', { name: 'Scan receipt' }))
    expect(onScanReceipt).toHaveBeenCalled()

    const bare = await render(<I18nextProvider i18n={i18n}><TransactionsScreen state={{ status: 'loaded', transactions: mapTransactions({ transactions: [transactionFixture] }), refreshing: false }} filters={{}} onBack={jest.fn()} onFiltersChange={jest.fn()} onRefresh={jest.fn()} onMarkReviewed={jest.fn()} /></I18nextProvider>)
    expect(bare.queryByRole('button', { name: 'Add transaction' })).not.toBeOnTheScreen()
    expect(bare.queryByRole('button', { name: 'Import transactions' })).not.toBeOnTheScreen()
    expect(bare.queryByRole('button', { name: 'Scan receipt' })).not.toBeOnTheScreen()
  })

  describe('edit amount', () => {
    it('does not offer amount editing when the handler is not provided', async () => {
      const i18n = await initMobileI18n('en')
      const view = await render(<I18nextProvider i18n={i18n}><TransactionsScreen state={{ status: 'loaded', transactions: mapTransactions({ transactions: [transactionFixture] }), refreshing: false }} filters={{}} onBack={jest.fn()} onFiltersChange={jest.fn()} onRefresh={jest.fn()} onMarkReviewed={jest.fn()} /></I18nextProvider>)
      await fireEvent.press(view.getByRole('button', { name: /Corner shop/ }))
      expect(view.queryByRole('button', { name: 'Edit amount' })).not.toBeOnTheScreen()
    })

    it('opens a prefilled editor, submits the trimmed draft, and closes on success', async () => {
      const { view, editAmount } = await renderLoaded()
      await fireEvent.press(view.getByRole('button', { name: /Corner shop/ }))
      await fireEvent.press(view.getByRole('button', { name: 'Edit amount' }))
      const input = view.getByLabelText('Transaction amount')
      expect(input.props.value).toBe('12.5')
      const descriptionInput = view.getByLabelText('Transaction description')
      expect(descriptionInput.props.value).toBe('Card purchase')
      await fireEvent.changeText(input, '9.99')
      await fireEvent.changeText(descriptionInput, 'Corner shop groceries')
      await fireEvent.press(view.getByRole('button', { name: 'Save amount' }))
      expect(editAmount).toHaveBeenCalledWith(41, '9.99', 'Corner shop groceries')
      expect(view.queryByLabelText('Transaction amount')).not.toBeOnTheScreen()
      expect(view.getByRole('button', { name: 'Edit amount' })).toBeOnTheScreen()
    })

    it('discards the draft on cancel without submitting', async () => {
      const { view, editAmount } = await renderLoaded()
      await fireEvent.press(view.getByRole('button', { name: /Corner shop/ }))
      await fireEvent.press(view.getByRole('button', { name: 'Edit amount' }))
      await fireEvent.changeText(view.getByLabelText('Transaction amount'), '1')
      await fireEvent.press(view.getByRole('button', { name: 'Cancel' }))
      expect(editAmount).not.toHaveBeenCalled()
      expect(view.queryByLabelText('Transaction amount')).not.toBeOnTheScreen()
      expect(view.queryByLabelText('Transaction description')).not.toBeOnTheScreen()
    })

    it('keeps the editor open and surfaces the result banner on a rejected edit', async () => {
      const { view, editAmount } = await renderLoaded()
      editAmount.mockResolvedValueOnce('error')
      await fireEvent.press(view.getByRole('button', { name: /Corner shop/ }))
      await fireEvent.press(view.getByRole('button', { name: 'Edit amount' }))
      await fireEvent.changeText(view.getByLabelText('Transaction amount'), '999999')
      await fireEvent.press(view.getByRole('button', { name: 'Save amount' }))
      expect(view.getByLabelText('Transaction amount')).toBeOnTheScreen()
      expect(view.getByRole('alert')).toBeOnTheScreen()
    })
  })

  it('selects only loaded persisted rows and assigns a category from the shared category model', async () => {
    const { view, assignCategory } = await renderLoaded()
    await fireEvent.press(view.getByRole('checkbox', { name: 'Select Corner shop' }))
    expect(view.getByText('1 transaction selected')).toBeOnTheScreen()
    expect(view.getByText(/only positive persisted transactions in this loaded server window/)).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Choose category' }))
    await fireEvent.press(view.getByRole('menuitem', { name: 'Assign Cafes' }))
    expect(assignCategory).toHaveBeenCalledWith([41], 8)
    expect(view.queryByText('1 transaction selected')).not.toBeOnTheScreen()
  })

  it('preserves selection after ambiguous failure and confirms a large category change with count and category', async () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({ ...transactionFixture, transactionKey: index + 1, description: `Row ${index}`, transactionMerchantKey: undefined }))
    const { view, assignCategory } = await renderLoaded(rows)
    assignCategory.mockResolvedValueOnce('network').mockResolvedValueOnce('success')
    for (let index = 0; index < 10; index += 1) await fireEvent.press(view.getByRole('checkbox', { name: `Select Row ${index}` }))
    await fireEvent.press(view.getByRole('button', { name: 'Choose category' }))
    await fireEvent.press(view.getByRole('menuitem', { name: 'Assign Groceries' }))
    expect(view.getByText('Assign Groceries to 10 selected transactions? This also marks them as reviewed.')).toBeOnTheScreen()
    expect(assignCategory).not.toHaveBeenCalled()
    await fireEvent.press(view.getByRole('checkbox', { name: 'Select Row 9' }))
    expect(view.getByText('10 transactions selected')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Assign category' }))
    expect(assignCategory).toHaveBeenCalledWith([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 7)
    expect(view.getByText('10 transactions selected')).toBeOnTheScreen()
    expect(view.getByRole('alert', { name: /uncertain network result/ })).toBeOnTheScreen()
  })

  it('confirms a large review with its frozen count and sorted id set', async () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({ ...transactionFixture, transactionKey: 20 - index, description: `Review row ${index}`, transactionMerchantKey: undefined }))
    const { view, bulkReview } = await renderLoaded(rows)
    for (let index = 0; index < 10; index += 1) await fireEvent.press(view.getByRole('checkbox', { name: `Select Review row ${index}` }))
    await fireEvent.press(view.getByRole('button', { name: 'Review selected' }))
    expect(view.getByText('Mark 10 selected transactions as reviewed?')).toBeOnTheScreen()
    expect(bulkReview).not.toHaveBeenCalled()
    await fireEvent.press(view.getByRole('checkbox', { name: 'Select Review row 0' }))
    expect(view.getByText('10 transactions selected')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Cancel' }))
    expect(view.queryByText('Mark 10 selected transactions as reviewed?')).not.toBeOnTheScreen()
    await fireEvent.press(view.getByRole('checkbox', { name: 'Select Review row 0' }))
    expect(view.getByText('9 transactions selected')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('checkbox', { name: 'Select Review row 0' }))
    await fireEvent.press(view.getByRole('button', { name: 'Review selected' }))
    await fireEvent.press(view.getByRole('button', { name: 'Mark as reviewed' }))
    expect(bulkReview).toHaveBeenCalledWith([11, 12, 13, 14, 15, 16, 17, 18, 19, 20])
    expect(view.queryByText('10 transactions selected')).not.toBeOnTheScreen()
  })

  it('offers only a hide button for an all-visible selection and only an unhide button for an all-hidden selection', async () => {
    const rows = [transactionFixture, { ...transactionFixture, transactionKey: 42, transactionMerchantKey: { name: 'Hidden shop' }, hidden: true }]
    const { view, setHidden } = await renderLoaded(rows)
    await fireEvent.press(view.getByRole('checkbox', { name: 'Select Corner shop' }))
    expect(view.getByRole('button', { name: 'Hide selected' })).toBeOnTheScreen()
    expect(view.queryByRole('button', { name: 'Unhide selected' })).not.toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Hide selected' }))
    expect(setHidden).toHaveBeenCalledWith([41], true)
    await fireEvent.press(view.getByRole('checkbox', { name: 'Select Hidden shop' }))
    expect(view.getByRole('button', { name: 'Unhide selected' })).toBeOnTheScreen()
    expect(view.queryByRole('button', { name: 'Hide selected' })).not.toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Unhide selected' }))
    expect(setHidden).toHaveBeenCalledWith([42], false)
  })

  it('offers neither hide nor unhide button for a mixed visibility selection', async () => {
    const rows = [transactionFixture, { ...transactionFixture, transactionKey: 42, transactionMerchantKey: { name: 'Hidden shop' }, hidden: true }]
    const { view } = await renderLoaded(rows)
    await fireEvent.press(view.getByRole('checkbox', { name: 'Select Corner shop' }))
    await fireEvent.press(view.getByRole('checkbox', { name: 'Select Hidden shop' }))
    expect(view.queryByRole('button', { name: 'Hide selected' })).not.toBeOnTheScreen()
    expect(view.queryByRole('button', { name: 'Unhide selected' })).not.toBeOnTheScreen()
  })

  it('confirms a large hide with its frozen count and sorted id set', async () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({ ...transactionFixture, transactionKey: 20 - index, description: `Hide row ${index}`, transactionMerchantKey: undefined }))
    const { view, setHidden } = await renderLoaded(rows)
    for (let index = 0; index < 10; index += 1) await fireEvent.press(view.getByRole('checkbox', { name: `Select Hide row ${index}` }))
    await fireEvent.press(view.getByRole('button', { name: 'Hide selected' }))
    expect(view.getByText('Hide 10 selected transactions?')).toBeOnTheScreen()
    expect(setHidden).not.toHaveBeenCalled()
    await fireEvent.press(view.getByRole('button', { name: 'Hide transactions' }))
    expect(setHidden).toHaveBeenCalledWith([11, 12, 13, 14, 15, 16, 17, 18, 19, 20], true)
  })

  it('marks a hidden row with reduced emphasis and a hidden label, and toggles the show-hidden filter', async () => {
    const { view, changeFilters } = await renderLoaded([{ ...transactionFixture, hidden: true }])
    expect(view.getByText('Groceries · Needs review · Hidden')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Show hidden transactions' }))
    expect(changeFilters).toHaveBeenCalledWith({ includeHidden: true })
  })

  it('locks all server, local, paging, refresh, selection, and competing bulk controls while pending', async () => {
    const rows = Array.from({ length: 51 }, (_, index) => ({ ...transactionFixture, transactionKey: index + 1, description: `Pending row ${index}`, transactionMerchantKey: undefined }))
    const { view, screen } = await renderLoaded(rows, { limit: 100 })
    await fireEvent.press(view.getByRole('checkbox', { name: 'Select Pending row 50' }))
    await view.rerender(screen(true))
    // The collapsed filters must be open for this to assert they are disabled;
    // a control that is not rendered is not the same as one that is locked.
    await openFilters(view)

    for (const name of ['Back', 'All dates', 'Last 30 days', 'Needs review', 'Load up to 100', 'Load up to 500', 'All accounts', 'Daily account', 'All categories', 'Groceries', 'All types', 'debit', 'Show 1 more loaded results', 'Updating…', 'Choose category', 'Clear selection']) {
      expect(view.getByRole('button', { name })).toBeDisabled()
    }
    expect(view.getByRole('checkbox', { name: 'Select Pending row 50' })).toBeDisabled()
    expect(view.getByLabelText('Filter loaded results by merchant').props.editable).toBe(false)
  })
  it('keeps rows visible and announces unavailable account and financial context', async () => {
    const unavailable = {
      ...nullishTransactionFixture,
      transactionKey: 88,
      transactionTypeKey: { name: 'credit' },
    }
    const { view } = await renderLoaded([unavailable])
    const row = view.getByRole('button', { name: /Account name unavailable, Amount and currency unavailable, Credit/ })
    expect(row).toBeOnTheScreen()
    expect(view.getByText('Account name unavailable · Jul 18, 2026')).toBeOnTheScreen()
    expect(view.getByText('Amount and currency unavailable')).toBeOnTheScreen()
    expect(view.getAllByText('Credit').length).toBeGreaterThan(0)
    await fireEvent.press(row)
    expect(view.getAllByText('Amount and currency unavailable')).toHaveLength(3)
    expect(view.getByText('Amount unavailable')).toBeOnTheScreen()
  })
  it('shows a present amount without inventing a missing currency', async () => {
    const { view } = await renderLoaded([{ ...transactionFixture, transactionKey: 89, appuserCurrencyKey: null }])
    expect(view.getByText(/12\.50 · Currency unavailable/)).toBeOnTheScreen()
    expect(view.getByRole('button', { name: /12\.50 · Currency unavailable, Credit/ })).toBeOnTheScreen()
  })
  it('keeps signed amount, label, and non-color cue consistent when type metadata disagrees', async () => {
    const negativeCredit = { ...transactionFixture, transactionKey: 91, transactionMerchantKey: { name: 'Negative credit metadata' }, appuserSettlementAmount: -25, transactionTypeKey: { name: 'credit' } }
    const positiveDebit = { ...transactionFixture, transactionKey: 92, transactionMerchantKey: { name: 'Positive debit metadata' }, appuserSettlementAmount: 25, transactionTypeKey: { name: 'debit' } }
    const { view } = await renderLoaded([negativeCredit, positiveDebit])
    expect(view.getByRole('button', { name: /Negative credit metadata.*-€25\.00, Debit/ })).toBeOnTheScreen()
    expect(view.getByRole('button', { name: /Positive debit metadata.*\+€25\.00, Credit/ })).toBeOnTheScreen()
  })
  it('filters only the loaded window by merchant, account, category and type', async () => {
    const second = { ...transactionFixture, transactionKey: 90, accountKey: { ...transactionFixture.accountKey, accountKey: 8, accountName: 'Savings' }, transactionMerchantKey: { name: 'Book shop' }, appuserTransactionCategories: [{ categoryKey: 9, name: 'Books', isSystemCategory: true }], transactionTypeKey: { name: 'credit' } }
    const { view } = await renderLoaded([transactionFixture, second])
    await openFilters(view)
    await fireEvent.changeText(view.getByLabelText('Filter loaded results by merchant'), 'book')
    expect(view.getByText('Book shop')).toBeOnTheScreen()
    expect(view.queryByText('Corner shop')).not.toBeOnTheScreen()
    await fireEvent.changeText(view.getByLabelText('Filter loaded results by merchant'), '')
    await fireEvent.press(view.getByRole('button', { name: 'Savings' }))
    await fireEvent.press(view.getByRole('button', { name: 'Books' }))
    await fireEvent.press(view.getByRole('button', { name: 'credit' }))
    expect(view.getByText('Book shop')).toBeOnTheScreen()
    expect(view.queryByText('Corner shop')).not.toBeOnTheScreen()
  })
  it.each([[0, 100], [99, 100], [100, 100], [500, 500]] as const)('states the loaded result boundary honestly for %i of %i', async (count, limit) => {
    const rows = Array.from({ length: count }, (_, index) => ({ ...transactionFixture, transactionKey: index + 1, description: `Row ${index}`, transactionMerchantKey: undefined }))
    const { view } = await renderLoaded(rows, { limit })
    // None of the parametrised counts is 1, so this only ever needs the plural.
    const boundary = `${count} results loaded from a ${limit}-result server window`
    expect(view.getByText(new RegExp(boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeOnTheScreen()
  })
  it('offers user-triggered 500 retrieval and resets loaded filters when server scope changes', async () => {
    const { view, changeFilters, i18n } = await renderLoaded([transactionFixture], { limit: 100 })
    await fireEvent.press(view.getByRole('button', { name: 'Load up to 500' }))
    expect(changeFilters).toHaveBeenCalledWith({ limit: 500 })
    await openFilters(view)
    await fireEvent.changeText(view.getByLabelText('Filter loaded results by merchant'), 'missing')
    expect(view.queryByText('Corner shop')).not.toBeOnTheScreen()
    await view.rerender(<I18nextProvider i18n={i18n}><TransactionsScreen state={{ status: 'loaded', transactions: mapTransactions({ transactions: [transactionFixture] }), refreshing: false }} filters={{ limit: 500 }} onBack={jest.fn()} onFiltersChange={jest.fn()} onRefresh={jest.fn()} onMarkReviewed={jest.fn()} /></I18nextProvider>)
    expect(view.getByText('Corner shop')).toBeOnTheScreen()
  })

  describe('custom date range', () => {
    it('applies a valid custom range as the server date filter', async () => {
      const { view, changeFilters } = await renderLoaded([transactionFixture], { needsReview: true })
      await openFilters(view)
      await fireEvent.changeText(view.getByLabelText('Custom range from date'), '2026-07-01')
      await fireEvent.changeText(view.getByLabelText('Custom range to date'), '2026-07-18')
      await fireEvent.press(view.getByRole('button', { name: 'Apply date range' }))
      expect(changeFilters).toHaveBeenCalledWith({ needsReview: true, fromDate: '2026-07-01T00:00:00.000Z', toDate: '2026-07-18T23:59:59.999Z' })
    })

    it('shows a validation error and does not change filters for an invalid range', async () => {
      const { view, changeFilters } = await renderLoaded([transactionFixture])
      await openFilters(view)
      await fireEvent.changeText(view.getByLabelText('Custom range from date'), '2026-07-18')
      await fireEvent.changeText(view.getByLabelText('Custom range to date'), '2026-07-01')
      await fireEvent.press(view.getByRole('button', { name: 'Apply date range' }))
      expect(view.getByRole('alert', { name: /must not be after/ })).toBeOnTheScreen()
      expect(changeFilters).not.toHaveBeenCalled()
    })
  })

  it.each(['loading', 'error', 'invalid-response', 'not-found', 'invalid-account', 'access-transition'] as const)('handles %s state', async (status) => {
    const i18n = await initMobileI18n('en')
    const view = await render(<I18nextProvider i18n={i18n}><TransactionsScreen state={{ status }} filters={{}} onBack={jest.fn()} onFiltersChange={jest.fn()} onRefresh={jest.fn()} onMarkReviewed={jest.fn()} /></I18nextProvider>)
    if (status === 'access-transition') expect(view.toJSON()).toBeNull()
    else expect(view.toJSON()).not.toBeNull()
  })
})
