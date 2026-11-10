import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'
import { inTimeZone } from '@/test/time-zone'

import { TransactionsScreen } from './transactions-screen'
import { mapTransactions } from './transactions-view-model'
import { nullishTransactionFixture, transactionFixture } from './test-fixtures'

jest.mock('@/components/ui/date-field', () => jest.requireActual('./test-date-field'))

type View = Awaited<ReturnType<typeof renderLoaded>>['view']

/**
 * Review/hidden toggles, the custom range and the loaded-result filters sit
 * behind one "Filters" control, so the screen opens on the list instead of on
 * a screenful of controls. Tests drive that control the way a person would.
 */
async function openFilters(view: View) {
  const control = view.queryByRole('button', { name: /^Filters$|\d+ filters?/ })
  if (control) await fireEvent.press(control)
}

/** The date range opens a sheet of presets and a custom range, as web's date-range picker does. */
async function openDateRange(view: View) {
  await fireEvent.press(view.getByRole('button', { name: /^Date range,/ }))
}

/** A row's own press target; its "…" menu is named "Actions for …". */
const row = (name: string) => new RegExp(`^${name},`)

/**
 * Row checkboxes only exist in selection mode, which starts from a row's "…"
 * menu (that row comes selected). Unchecking it leaves the mode open with
 * nothing selected, so each test picks its own rows.
 */
async function startSelecting(view: View, rowName = 'Corner shop') {
  expect(view.queryByRole('button', { name: 'Select' })).not.toBeOnTheScreen()
  await fireEvent.press(view.getByRole('button', { name: `Actions for ${rowName}` }))
  await fireEvent.press(view.getByRole('menuitem', { name: 'Select' }))
  expect(view.getByRole('checkbox', { name: `Select ${rowName}` })).toBeChecked()
  await fireEvent.press(view.getByRole('checkbox', { name: `Select ${rowName}` }))
}

/** A select row opens a sheet of radio options. */
async function choose(view: View, field: string, option: string) {
  await fireEvent.press(view.getByRole('button', { name: new RegExp(`^${field},`) }))
  await fireEvent.press(view.getByRole('radio', { name: option }))
}


const renderLoaded = async (transactions = [transactionFixture], filters: React.ComponentProps<typeof TransactionsScreen>['filters'] = {}, extra: Partial<React.ComponentProps<typeof TransactionsScreen>> = {}, language = 'en') => {
  const i18n = await initMobileI18n(language)
  const mark = jest.fn().mockResolvedValue('success')
  const changeFilters = jest.fn()
  const bulkReview = jest.fn().mockResolvedValue('success')
  const assignCategory = jest.fn().mockResolvedValue('success')
  const setHidden = jest.fn().mockResolvedValue('success')
  const editAmount = jest.fn().mockResolvedValue('success')
  const categories = { status: 'loaded' as const, categories: [{ id: 7, name: 'Groceries', system: true, color: '#DDEEFF', glyph: '◇', countsAsSpending: true, children: [{ id: 8, name: 'Cafes', system: true, color: null, glyph: '□', countsAsSpending: true, children: [] }] }] }
  const screen = (pending = false) => <I18nextProvider i18n={i18n}><TransactionsScreen state={{ status: 'loaded', transactions: mapTransactions({ transactions }), refreshing: false }} filters={filters} categories={categories} pending={pending} onBack={jest.fn()} onFiltersChange={changeFilters} onRefresh={jest.fn()} onMarkReviewed={mark} onBulkReview={bulkReview} onAssignCategory={assignCategory} onSetHidden={setHidden} onEditAmount={editAmount} {...extra} /></I18nextProvider>
  const view = await render(screen())
  return { view, mark, bulkReview, assignCategory, setHidden, editAmount, changeFilters, i18n, screen }
}

describe('TransactionsScreen', () => {
  it('shows localized scan information and progressively discloses read-only detail', async () => {
    const { view, mark } = await renderLoaded()
    expect(view.getByText('Corner shop')).toBeOnTheScreen()
    // Web's ledger row: account · short date, then the category, then the review state.
    expect(view.getByText(/^Daily account · Jul 18/)).toBeOnTheScreen()
    expect(view.getByText('Groceries')).toBeOnTheScreen()
    expect(view.getByText('Needs review')).toBeOnTheScreen()
    expect(view.getByText('July 2026')).toBeOnTheScreen()
    expect(view.getByRole('button', { name: /Corner shop.*Credit/ })).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: row('Corner shop') }))
    expect(view.getByText('CARD PURCHASE 1234')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Mark as reviewed' }))
    expect(mark).toHaveBeenCalledWith(41)
  })
  it('never exposes review mutation for negative synthetic initial balances', async () => {
    const { view } = await renderLoaded([{ ...transactionFixture, transactionKey: -9, description: 'Initial balance', transactionMerchantKey: undefined, reviewed: true }])
    await fireEvent.press(view.getByRole('button', { name: row('Initial balance') }))
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
    // Adding is the floating button; import and scan sit behind the title row's overflow menu.
    expect(view.getByTestId('transactions-create')).toHaveProp('accessibilityLabel', 'Add transaction')
    await fireEvent.press(view.getByRole('button', { name: 'Add transaction' }))
    expect(onCreate).toHaveBeenCalled()
    await fireEvent.press(view.getByRole('button', { name: 'Import or scan' }))
    await fireEvent.press(view.getByRole('menuitem', { name: 'Import transactions' }))
    expect(onImport).toHaveBeenCalled()
    await fireEvent.press(view.getByRole('button', { name: 'Import or scan' }))
    await fireEvent.press(view.getByRole('menuitem', { name: 'Scan receipt' }))
    expect(onScanReceipt).toHaveBeenCalled()

    const bare = await render(<I18nextProvider i18n={i18n}><TransactionsScreen state={{ status: 'loaded', transactions: mapTransactions({ transactions: [transactionFixture] }), refreshing: false }} filters={{}} onBack={jest.fn()} onFiltersChange={jest.fn()} onRefresh={jest.fn()} onMarkReviewed={jest.fn()} /></I18nextProvider>)
    expect(bare.queryByRole('button', { name: 'Add transaction' })).not.toBeOnTheScreen()
    expect(bare.queryByRole('button', { name: 'Import or scan' })).not.toBeOnTheScreen()
    expect(bare.queryByRole('button', { name: 'Import transactions' })).not.toBeOnTheScreen()
    expect(bare.queryByRole('button', { name: 'Scan receipt' })).not.toBeOnTheScreen()
  })

  it('opens a row menu from the "…" control with the row actions', async () => {
    const { view, mark, editAmount } = await renderLoaded()
    await fireEvent.press(view.getByRole('button', { name: 'Actions for Corner shop' }))
    await fireEvent.press(view.getByRole('menuitem', { name: 'Mark as reviewed' }))
    expect(mark).toHaveBeenCalledWith(41)
    await fireEvent.press(view.getByRole('button', { name: 'Actions for Corner shop' }))
    await fireEvent.press(view.getByRole('menuitem', { name: 'Edit amount' }))
    expect(view.getByLabelText('Transaction amount')).toBeOnTheScreen()
    expect(editAmount).not.toHaveBeenCalled()
    await fireEvent.press(view.getByRole('button', { name: 'Actions for Corner shop' }))
    // Selection mode starts from the row's menu; there is no toolbar toggle beside Filters.
    await fireEvent.press(view.getByRole('menuitem', { name: 'Select' }))
    expect(view.getByRole('checkbox', { name: 'Select Corner shop' })).toBeChecked()
  })

  it('leads with one row of figures and one review line that sends "Review them" to the needs-review filter', async () => {
    const lead = { flows: { status: 'loaded' as const, value: { moneyIn: 8724, moneyOut: 5778.93 } }, reviewCount: { status: 'loaded' as const, value: 7 } }
    const { view, changeFilters } = await renderLoaded([transactionFixture], { limit: 100 }, { lead, leadCurrency: 'EUR', total: 95, freshness: { kind: 'updated', at: new Date(Date.now() - 86_400_000).toISOString() } })
    expect(view.getByText('Balances updated 1 day ago')).toBeOnTheScreen()
    expect(view.getByText('Transactions in view')).toBeOnTheScreen()
    expect(view.getByText('95')).toBeOnTheScreen()
    expect(view.getByText('Money in')).toBeOnTheScreen()
    expect(view.getByText('Money out')).toBeOnTheScreen()
    expect(view.getByText('7 need review')).toBeOnTheScreen()
    expect(view.queryByText(/cover every account over the date range/)).not.toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Review them' }))
    expect(changeFilters).toHaveBeenCalledWith({ limit: 100, needsReview: true })
  })

  it('drops the review line when nothing needs review', async () => {
    const lead = { flows: { status: 'loaded' as const, value: { moneyIn: 0, moneyOut: 0 } }, reviewCount: { status: 'loaded' as const, value: 0 } }
    const { view } = await renderLoaded([transactionFixture], {}, { lead, leadCurrency: 'EUR', total: 1 })
    expect(view.getByTestId('transactions-lead')).toBeOnTheScreen()
    expect(view.queryByRole('button', { name: 'Review them' })).not.toBeOnTheScreen()
    expect(view.queryByText(/need review/)).not.toBeOnTheScreen()
  })

  it('draws no lead on one account\'s list, and names the account in the back link only', async () => {
    const lead = { flows: { status: 'loading' as const }, reviewCount: { status: 'loading' as const } }
    const { view } = await renderLoaded([transactionFixture], {}, { lead, perAccount: true, accountName: 'Daily account' })
    expect(view.queryByTestId('transactions-lead')).not.toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Back' })).toBeOnTheScreen()
    // The back link carries the name; no subtitle repeats it.
    expect(view.getAllByText('Daily account')).toHaveLength(1)
  })

  describe('edit amount', () => {
    it('does not offer amount editing when the handler is not provided', async () => {
      const i18n = await initMobileI18n('en')
      const view = await render(<I18nextProvider i18n={i18n}><TransactionsScreen state={{ status: 'loaded', transactions: mapTransactions({ transactions: [transactionFixture] }), refreshing: false }} filters={{}} onBack={jest.fn()} onFiltersChange={jest.fn()} onRefresh={jest.fn()} onMarkReviewed={jest.fn()} /></I18nextProvider>)
      await fireEvent.press(view.getByRole('button', { name: row('Corner shop') }))
      expect(view.queryByRole('button', { name: 'Edit amount' })).not.toBeOnTheScreen()
    })

    it('opens a prefilled editor, submits the trimmed draft, and closes on success', async () => {
      const { view, editAmount } = await renderLoaded()
      await fireEvent.press(view.getByRole('button', { name: row('Corner shop') }))
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

    it('pre-fills and reads the amount in the app language', async () => {
      const { view, editAmount, i18n } = await renderLoaded([transactionFixture], {}, {}, 'pt-PT')
      await fireEvent.press(view.getByRole('button', { name: row('Corner shop') }))
      await fireEvent.press(view.getByRole('button', { name: i18n.t('transactions.editAmount') }))
      const input = view.getByLabelText(i18n.t('transactions.editAmountInput'))
      expect(input.props.value).toBe('12,5')
      await fireEvent.changeText(input, '-1.234,56')
      await fireEvent.press(view.getByRole('button', { name: i18n.t('transactions.saveAmount') }))
      expect(editAmount).toHaveBeenCalledWith(41, '-1234.56', 'Card purchase')
    })

    it('shows an error and does not submit an amount it cannot read', async () => {
      const { view, editAmount } = await renderLoaded()
      await fireEvent.press(view.getByRole('button', { name: row('Corner shop') }))
      await fireEvent.press(view.getByRole('button', { name: 'Edit amount' }))
      await fireEvent.changeText(view.getByLabelText('Transaction amount'), '1.2.3')
      expect(view.getByText('Enter a number, like 12.50 or -12.50.')).toBeOnTheScreen()
      expect(view.getByRole('button', { name: 'Save amount' })).toBeDisabled()
      await fireEvent.press(view.getByRole('button', { name: 'Save amount' }))
      expect(editAmount).not.toHaveBeenCalled()
    })

    it('discards the draft on cancel without submitting', async () => {
      const { view, editAmount } = await renderLoaded()
      await fireEvent.press(view.getByRole('button', { name: row('Corner shop') }))
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
      await fireEvent.press(view.getByRole('button', { name: row('Corner shop') }))
      await fireEvent.press(view.getByRole('button', { name: 'Edit amount' }))
      await fireEvent.changeText(view.getByLabelText('Transaction amount'), '999999')
      await fireEvent.press(view.getByRole('button', { name: 'Save amount' }))
      expect(view.getByLabelText('Transaction amount')).toBeOnTheScreen()
      expect(view.getByRole('alert')).toBeOnTheScreen()
    })
  })

  it('leads each row with its mark, which the checkbox replaces while selecting', async () => {
    const { view } = await renderLoaded()
    const hidden = { includeHiddenElements: true }
    expect(view.getByTestId('transaction-mark', hidden)).toBeOnTheScreen()
    await startSelecting(view)
    expect(view.queryByTestId('transaction-mark', hidden)).not.toBeOnTheScreen()
    expect(view.getByRole('checkbox', { name: 'Select Corner shop' })).toBeOnTheScreen()
  })

  it('shows row checkboxes only in selection mode', async () => {
    const { view } = await renderLoaded()
    expect(view.queryByRole('checkbox')).not.toBeOnTheScreen()
    await startSelecting(view)
    expect(view.getByRole('checkbox', { name: 'Select Corner shop' })).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Done' }))
    expect(view.queryByRole('checkbox')).not.toBeOnTheScreen()
  })

  it('selects only loaded persisted rows and assigns a category from the shared category model', async () => {
    const { view, assignCategory } = await renderLoaded()
    await startSelecting(view)
    await fireEvent.press(view.getByRole('checkbox', { name: 'Select Corner shop' }))
    expect(view.getByText('1 transaction selected')).toBeOnTheScreen()
    expect(view.getByText(/Opening balances can't be changed/)).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Choose category' }))
    await fireEvent.press(view.getByRole('menuitem', { name: 'Assign Cafes' }))
    expect(assignCategory).toHaveBeenCalledWith([41], 8)
    expect(view.queryByText('1 transaction selected')).not.toBeOnTheScreen()
  })

  it('preserves selection after ambiguous failure and confirms a large category change with count and category', async () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({ ...transactionFixture, transactionKey: index + 1, description: `Row ${index}`, transactionMerchantKey: undefined }))
    const { view, assignCategory } = await renderLoaded(rows)
    await startSelecting(view, 'Row 0')
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
    await startSelecting(view, 'Review row 0')
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
    await startSelecting(view)
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
    await startSelecting(view)
    await fireEvent.press(view.getByRole('checkbox', { name: 'Select Corner shop' }))
    await fireEvent.press(view.getByRole('checkbox', { name: 'Select Hidden shop' }))
    expect(view.queryByRole('button', { name: 'Hide selected' })).not.toBeOnTheScreen()
    expect(view.queryByRole('button', { name: 'Unhide selected' })).not.toBeOnTheScreen()
  })

  it('confirms a large hide with its frozen count and sorted id set', async () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({ ...transactionFixture, transactionKey: 20 - index, description: `Hide row ${index}`, transactionMerchantKey: undefined }))
    const { view, setHidden } = await renderLoaded(rows)
    await startSelecting(view, 'Hide row 0')
    for (let index = 0; index < 10; index += 1) await fireEvent.press(view.getByRole('checkbox', { name: `Select Hide row ${index}` }))
    await fireEvent.press(view.getByRole('button', { name: 'Hide selected' }))
    expect(view.getByText('Hide 10 selected transactions?')).toBeOnTheScreen()
    expect(setHidden).not.toHaveBeenCalled()
    await fireEvent.press(view.getByRole('button', { name: 'Hide transactions' }))
    expect(setHidden).toHaveBeenCalledWith([11, 12, 13, 14, 15, 16, 17, 18, 19, 20], true)
  })

  it('marks a hidden row with reduced emphasis and a hidden label, and toggles the show-hidden filter', async () => {
    const { view, changeFilters } = await renderLoaded([{ ...transactionFixture, hidden: true }])
    expect(view.getByText('Hidden')).toBeOnTheScreen()
    await openFilters(view)
    await fireEvent(view.getByRole('switch', { name: 'Show hidden transactions' }), 'valueChange', true)
    expect(changeFilters).toHaveBeenCalledWith({ includeHidden: true })
  })

  it('locks all server, local, paging, refresh, selection, and competing bulk controls while pending', async () => {
    const rows = Array.from({ length: 51 }, (_, index) => ({ ...transactionFixture, transactionKey: 51 - index, description: `Pending row ${50 - index}`, transactionMerchantKey: undefined }))
    const { view, screen } = await renderLoaded(rows, { limit: 100 }, { perAccount: true, accountName: 'Daily account' })
    await startSelecting(view, 'Pending row 50')
    await fireEvent.press(view.getByRole('checkbox', { name: 'Select Pending row 50' }))
    await view.rerender(screen(true))
    // The collapsed filters must be open for this to assert they are disabled;
    // a control that is not rendered is not the same as one that is locked.
    await openFilters(view)

    for (const name of ['Back', 'Done', 'Show 1 more', 'Updating…', 'Choose category', 'Clear selection']) {
      expect(view.getByRole('button', { name })).toBeDisabled()
    }
    for (const name of ['Needs review', 'Show hidden transactions']) {
      expect(view.getByRole('switch', { name })).toBeDisabled()
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
    expect(view.getByText(/^Account name unavailable · Jul 18/)).toBeOnTheScreen()
    expect(view.getByText('Amount and currency unavailable')).toBeOnTheScreen()
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
    await choose(view, 'Account', 'Savings')
    await choose(view, 'Category', 'Books')
    await choose(view, 'Type', 'credit')
    expect(view.getByText('Book shop')).toBeOnTheScreen()
    expect(view.queryByText('Corner shop')).not.toBeOnTheScreen()
  })
  it('counts the loaded transactions in plain words', async () => {
    const rows = Array.from({ length: 99 }, (_, index) => ({ ...transactionFixture, transactionKey: index + 1, description: `Row ${index}`, transactionMerchantKey: undefined }))
    const { view } = await renderLoaded(rows, { limit: 100 })
    expect(view.getByText('99 transactions')).toBeOnTheScreen()
    expect(view.queryByRole('button', { name: 'Load more' })).not.toBeOnTheScreen()
  })
  it('says how many of the matching transactions are showing when the server reports more', async () => {
    // 100 persisted rows plus a synthetic opening balance arrive as 101 from a 100-row request.
    // Web counts the opening balance as a row on the page and in the server's total, so mobile does too.
    const rows = [
      ...Array.from({ length: 100 }, (_, index) => ({ ...transactionFixture, transactionKey: index + 1, description: `Row ${index}`, transactionMerchantKey: undefined })),
      { ...transactionFixture, transactionKey: -1, description: 'Initial balance', transactionMerchantKey: undefined },
    ]
    const { view } = await renderLoaded(rows, { limit: 100 }, { total: 342, hasMore: true })
    expect(view.getByText('Showing 101 of 342')).toBeOnTheScreen()
  })
  it('shows the date range on its control and switches presets from its sheet', async () => {
    const { view, changeFilters } = await renderLoaded([transactionFixture], { limit: 100, fromDate: '2026-09-06T00:00:00.000Z', toDate: '2026-11-05T23:59:59.999Z' })
    expect(view.getByRole('button', { name: /^Date range, Sep \d, 2026 – Nov \d, 2026$/ })).toBeOnTheScreen()
    await openDateRange(view)
    await fireEvent.press(view.getByRole('radio', { name: 'Last 30 days' }))
    expect(changeFilters).toHaveBeenCalledWith(expect.objectContaining({ limit: 100, fromDate: expect.any(String), toDate: expect.any(String) }))
    await openDateRange(view)
    await fireEvent.press(view.getByRole('radio', { name: 'All dates' }))
    expect(changeFilters).toHaveBeenLastCalledWith({ limit: 100 })
  })
  it('offers user-triggered 500 retrieval and resets loaded filters when server scope changes', async () => {
    const { view, changeFilters, i18n } = await renderLoaded([transactionFixture], { limit: 100 }, { hasMore: true })
    await fireEvent.press(view.getByRole('button', { name: 'Load more' }))
    expect(changeFilters).toHaveBeenCalledWith({ limit: 500 })
    await openFilters(view)
    await fireEvent.changeText(view.getByLabelText('Filter loaded results by merchant'), 'missing')
    expect(view.queryByText('Corner shop')).not.toBeOnTheScreen()
    await view.rerender(<I18nextProvider i18n={i18n}><TransactionsScreen state={{ status: 'loaded', transactions: mapTransactions({ transactions: [transactionFixture] }), refreshing: false }} filters={{ limit: 500 }} onBack={jest.fn()} onFiltersChange={jest.fn()} onRefresh={jest.fn()} onMarkReviewed={jest.fn()} /></I18nextProvider>)
    expect(view.getByText('Corner shop')).toBeOnTheScreen()
  })

  describe('custom date range', () => {
    describe.each([
      ['America/New_York', '2026-07-01T04:00:00.000Z', '2026-07-19T03:59:59.999Z'],
      ['Asia/Tokyo', '2026-06-30T15:00:00.000Z', '2026-07-18T14:59:59.999Z'],
    ])('in %s', (zone, fromDate, toDate) => {
      inTimeZone(zone)

      it('applies a valid custom range as the server date filter, from local calendar days', async () => {
        const { view, changeFilters } = await renderLoaded([transactionFixture], { needsReview: true })
        await openDateRange(view)
        await fireEvent.changeText(view.getByLabelText('Custom range from date'), '2026-07-01')
        await fireEvent.changeText(view.getByLabelText('Custom range to date'), '2026-07-18')
        await fireEvent.press(view.getByRole('button', { name: 'Apply date range' }))
        expect(changeFilters).toHaveBeenCalledWith({ needsReview: true, fromDate, toDate })
      })

      it('reopens a custom range on the local days it was picked as', async () => {
        const { view } = await renderLoaded([transactionFixture], { fromDate, toDate })
        await openDateRange(view)
        expect(view.getByLabelText('Custom range from date').props.value).toBe('2026-07-01')
        expect(view.getByLabelText('Custom range to date').props.value).toBe('2026-07-18')
      })
    })

    it('shows a validation error and does not change filters for an invalid range', async () => {
      const { view, changeFilters } = await renderLoaded([transactionFixture])
      await openDateRange(view)
      await fireEvent.changeText(view.getByLabelText('Custom range from date'), '2026-07-18')
      await fireEvent.changeText(view.getByLabelText('Custom range to date'), '2026-07-01')
      await fireEvent.press(view.getByRole('button', { name: 'Apply date range' }))
      expect(view.getByRole('alert', { name: /must not be after/ })).toBeOnTheScreen()
      expect(changeFilters).not.toHaveBeenCalled()
    })
  })

  describe.each(['America/New_York', 'Asia/Tokyo'])('a date-only bank booking, for a viewer in %s', (zone) => {
    inTimeZone(zone)

    it('is listed on its own date and in its own month', async () => {
      const booking = { ...transactionFixture, transactionDate: '2026-08-01T00:00:00.000Z' }
      const { view } = await renderLoaded([booking])
      expect(view.getByText(/^Daily account · Aug 1(, 2026)?$/)).toBeOnTheScreen()
      expect(view.getByText('August 2026')).toBeOnTheScreen()
      expect(view.getByRole('button', { name: /^Corner shop,.*, Aug 1, 2026$/ })).toBeOnTheScreen()
    })
  })

  describe('a transaction with a real time, in New York', () => {
    inTimeZone('America/New_York')

    it('is listed on its local day', async () => {
      const late = { ...transactionFixture, transactionDate: '2026-08-01T02:30:00.000Z' }
      const { view } = await renderLoaded([late])
      expect(view.getByText(/^Daily account · Jul 31(, 2026)?$/)).toBeOnTheScreen()
      expect(view.getByText('July 2026')).toBeOnTheScreen()
    })
  })

  describe('tags', () => {
    const trip = { tagKey: 5, name: 'Trip to Porto', color: '#ef4444' }
    const work = { tagKey: 6, name: 'Work', color: '#94a3b8' }
    const tagged = { ...transactionFixture, tags: [trip] }
    const tagProps = (extra: Partial<React.ComponentProps<typeof TransactionsScreen>> = {}) => ({
      tags: { status: 'loaded' as const, tags: [trip, work] },
      onSetTags: jest.fn().mockResolvedValue('success'),
      onCreateTag: jest.fn(),
      ...extra,
    })

    it('shows a row\'s tags as chips in the list and in its details', async () => {
      const { view } = await renderLoaded([tagged], {}, tagProps())
      expect(view.getByLabelText('Tags: Trip to Porto')).toBeOnTheScreen()
      await fireEvent.press(view.getByRole('button', { name: row('Corner shop') }))
      expect(view.getAllByLabelText('Tags: Trip to Porto')).toHaveLength(2)
    })

    it('replaces a transaction\'s tags from its details', async () => {
      const extra = tagProps()
      const { view } = await renderLoaded([tagged], {}, extra)
      await fireEvent.press(view.getByRole('button', { name: row('Corner shop') }))
      await fireEvent.press(view.getByRole('button', { name: 'Edit tags' }))
      expect(view.getByRole('checkbox', { name: 'Trip to Porto' })).toBeChecked()
      await fireEvent.press(view.getByRole('checkbox', { name: 'Work' }))
      await fireEvent.press(view.getByRole('button', { name: 'Save tags' }))
      expect(extra.onSetTags).toHaveBeenCalledWith(41, [5, 6])
    })

    it('keeps the picker open with the reason when the change is refused', async () => {
      const extra = tagProps({ onSetTags: jest.fn().mockResolvedValue('demo') })
      const { view } = await renderLoaded([tagged], {}, extra)
      await fireEvent.press(view.getByRole('button', { name: 'Actions for Corner shop' }))
      await fireEvent.press(view.getByRole('menuitem', { name: 'Edit tags' }))
      await fireEvent.press(view.getByRole('button', { name: 'Save tags' }))
      expect(await view.findByText(/Demo profiles are read-only/)).toBeOnTheScreen()
      expect(view.getByRole('button', { name: 'Save tags' })).toBeOnTheScreen()
    })

    it('filters by tag on the server from the filters sheet', async () => {
      const { view, changeFilters } = await renderLoaded([tagged], { fromDate: '2026-07-01T00:00:00.000Z' }, tagProps())
      await openFilters(view)
      await fireEvent.press(view.getByRole('checkbox', { name: 'Filter by Work' }))
      expect(changeFilters).toHaveBeenCalledWith({ fromDate: '2026-07-01T00:00:00.000Z', tagIds: [6] })
    })

    it('counts an active tag filter and clears it with the rest', async () => {
      const { view, changeFilters } = await renderLoaded([tagged], { tagIds: [5] }, tagProps())
      expect(view.getByRole('button', { name: '1 filter' })).toBeOnTheScreen()
      await openFilters(view)
      expect(view.getByRole('checkbox', { name: 'Filter by Trip to Porto' })).toBeChecked()
      await fireEvent.press(view.getByRole('button', { name: 'Clear all' }))
      expect(changeFilters).toHaveBeenCalledWith({ fromDate: undefined, toDate: undefined, limit: undefined })
    })

    it('hides tag controls when the server has no tags to offer', async () => {
      const { view } = await renderLoaded([transactionFixture], {}, { tags: { status: 'error' }, onSetTags: jest.fn(), onCreateTag: jest.fn() })
      await fireEvent.press(view.getByRole('button', { name: row('Corner shop') }))
      expect(view.queryByRole('button', { name: 'Edit tags' })).not.toBeOnTheScreen()
      await openFilters(view)
      expect(view.queryByRole('checkbox', { name: /Filter by/ })).not.toBeOnTheScreen()
    })
  })

  it.each(['loading', 'error', 'invalid-response', 'not-found', 'invalid-account', 'access-transition'] as const)('handles %s state', async (status) => {
    const i18n = await initMobileI18n('en')
    const view = await render(<I18nextProvider i18n={i18n}><TransactionsScreen state={{ status }} filters={{}} onBack={jest.fn()} onFiltersChange={jest.fn()} onRefresh={jest.fn()} onMarkReviewed={jest.fn()} /></I18nextProvider>)
    if (status === 'access-transition') expect(view.toJSON()).toBeNull()
    else expect(view.toJSON()).not.toBeNull()
  })

  describe('transfers', () => {
    const outgoing = { ...transactionFixture, appuserSettlementAmount: -50, settlementAmount: -50, transactionTypeKey: { name: 'PAYMENT' } }
    const destinations = { accounts: [{ key: 7, name: 'Daily account' }, { key: 8, name: 'Savings pot' }], portfolios: [{ key: 3, name: 'ETFs' }], goals: [] }

    it('marks money going out as a transfer to the portfolio it was sent to', async () => {
      const setTransfer = jest.fn().mockResolvedValue('success')
      const { view } = await renderLoaded([outgoing], {}, { onSetTransfer: setTransfer, transferDestinations: destinations })
      await fireEvent.press(view.getByRole('button', { name: 'Actions for Corner shop' }))
      await fireEvent.press(view.getByRole('menuitem', { name: 'Mark as transfer' }))
      // Its own account is not somewhere it can be sent.
      expect(view.queryByRole('radio', { name: 'Daily account' })).not.toBeOnTheScreen()
      expect(view.getByRole('radio', { name: 'Savings pot' })).toBeOnTheScreen()
      await fireEvent.press(view.getByRole('radio', { name: 'ETFs' }))
      expect(setTransfer).toHaveBeenCalledWith({ transactionId: 41, direction: 'debit', transfer: true, destination: { type: 'portfolio', key: 3 } })
    })

    it('marks money coming in as a transfer straight away, and undoes a transfer back to its direction', async () => {
      const setTransfer = jest.fn().mockResolvedValue('success')
      const incomingTransfer = { ...transactionFixture, transactionTypeKey: { name: 'TRANSFER_IN' } }
      const { view } = await renderLoaded([{ ...transactionFixture, transactionTypeKey: { name: 'DEPOSIT' } }], {}, { onSetTransfer: setTransfer, transferDestinations: destinations })
      await fireEvent.press(view.getByRole('button', { name: 'Actions for Corner shop' }))
      await fireEvent.press(view.getByRole('menuitem', { name: 'Mark as transfer' }))
      expect(setTransfer).toHaveBeenCalledWith({ transactionId: 41, direction: 'credit', transfer: true })

      const second = await renderLoaded([incomingTransfer], {}, { onSetTransfer: setTransfer, transferDestinations: destinations })
      await fireEvent.press(second.view.getByRole('button', { name: 'Actions for Corner shop' }))
      expect(second.view.queryByRole('menuitem', { name: 'Where it went' })).not.toBeOnTheScreen()
      await fireEvent.press(second.view.getByRole('menuitem', { name: 'Not a transfer' }))
      expect(setTransfer).toHaveBeenLastCalledWith({ transactionId: 41, direction: 'credit', transfer: false })
    })

    it('shows where a transfer went in its details', async () => {
      const marked = { ...outgoing, transactionTypeKey: { name: 'TRANSFER_OUT' }, transferDestination: { type: 'goal' as const, key: 2, name: 'Holiday' } }
      const { view } = await renderLoaded([marked], {}, { onSetTransfer: jest.fn(), transferDestinations: destinations })
      await fireEvent.press(view.getByRole('button', { name: row('Corner shop') }))
      expect(view.getByText('To Holiday')).toBeOnTheScreen()
    })
  })
})
