import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { Alert } from 'react-native'

import { initMobileI18n } from '@/lib/i18n'

import { activityCalendarFilters, formatPortfolioActivityTimestamp, PortfolioActivityScreen } from './portfolio-activity-screen'
import { mapPortfolioDividendIncome } from './portfolio-activity-view-model'
import { DividendIncomeBody, PortfolioMetricsSection } from './portfolio-sections'

async function provider(node: React.ReactNode) {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>)
}

/** Edit and delete live in the row's "…" menu. */
async function openRowMenu(view: Awaited<ReturnType<typeof provider>>, item: 'Edit' | 'Delete') {
  await fireEvent.press(view.getByRole('button', { name: 'Actions for AAPL' }))
  await fireEvent.press(view.getByRole('menuitem', { name: item }))
}

const callbacks = { onBack: jest.fn(), onApplyFilters: jest.fn(), onRefresh: jest.fn(), onLogout: jest.fn() }
const transaction = { amount: 20.25, cashCurrency: null as string | null, currency: 'EUR', id: 'transaction:1', itemType: 'TRANSACTION' as const, name: 'Apple', notes: null, portfolioId: 3, portfolioName: 'Broker', quantity: 2.5, split: null, ticker: 'AAPL', timestamp: '2026-07-19T10:00:00.000Z', transactionKey: 41, type: 'BUY', typeLabel: 'Buy', unitPrice: 8.1 }
const split = { amount: null, cashCurrency: null, currency: null, id: 'split:1', itemType: 'STOCK_SPLIT' as const, name: 'Apple', notes: null, portfolioId: 3, portfolioName: 'Broker', quantity: null, split: { denominator: 1, numerator: 4, ratio: 4 }, ticker: 'AAPL', timestamp: '2026-07-18T00:00:00.000Z', transactionKey: null, type: 'STOCK_SPLIT', typeLabel: 'Stock split', unitPrice: null }
const incompleteSplit = { ...split, id: 'split:incomplete', split: { denominator: null, numerator: 4, ratio: 4 } }

describe('portfolio activity and analytics presentation', () => {
  it('formats timestamps by locale and validates real calendar boundaries', () => {
    expect(formatPortfolioActivityTimestamp('2026-07-19T10:00:00.000Z', 'en-GB', 'Unavailable')).toContain('19 Jul 2026')
    expect(activityCalendarFilters('2026-07-01', '2026-07-31')).toEqual({ fromDate: '2026-07-01T00:00:00.000Z', toDate: '2026-07-31T23:59:59.999Z' })
    expect(activityCalendarFilters('2026-02-30', '')).toBeNull()
    expect(activityCalendarFilters('2026-08-01', '2026-07-01')).toBeNull()
  })

  it('announces transaction context and labels stock splits explicitly read only', async () => {
    const view = await provider(<PortfolioActivityScreen state={{ status: 'loaded', rows: [transaction, split] }} aggregate filters={{}} {...callbacks} />)
    expect(view.getByText(/up to 50 newest results/i)).toBeOnTheScreen()
    expect(view.getByText(/Stock split, read only/i)).toBeOnTheScreen()
    const rows = view.getAllByTestId('portfolio-activity-row')
    expect(rows[0]?.props.accessibilityLabel).toMatch(/^Buy, AAPL · Apple.*Quantity 2.5.*€20.25.*Broker/)
    expect(rows[1]?.props.accessibilityLabel).toMatch(/Stock split.*4 for 1.*read only/i)
    // Web's toolbar: the date-range pill and Filters, no "Newest activity first" subtitle.
    expect(view.getByRole('button', { name: 'Date range, All dates' })).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Filters' })).toBeOnTheScreen()
    expect(view.queryByText(/Newest activity first/)).not.toBeOnTheScreen()
  })

  it('names a cash deposit by its currency and its type in sentence case, never by raw keys', async () => {
    const deposit = { ...transaction, id: 'transaction:2', cashCurrency: 'EUR', name: null, ticker: null, quantity: 1, amount: 400, transactionKey: 72, type: 'DEPOSIT', typeLabel: 'Deposit' }
    const view = await provider(<PortfolioActivityScreen state={{ status: 'loaded', rows: [deposit] }} aggregate filters={{}} {...callbacks} />)
    const label = view.getByTestId('portfolio-activity-row').props.accessibilityLabel as string
    expect(label).toMatch(/^Deposit, Cash \(EUR\)/)
    expect(label).not.toMatch(/CURRENCY_|DEPOSIT/)
  })

  it('shows the range on its pill and applies presets, all dates and a custom range from its sheet', async () => {
    const onApplyFilters = jest.fn()
    const view = await provider(<PortfolioActivityScreen state={{ status: 'loaded', rows: [transaction] }} aggregate filters={{ fromDate: '2026-09-06T00:00:00.000Z', toDate: '2026-11-05T23:59:59.999Z' }} {...callbacks} onApplyFilters={onApplyFilters} />)
    await fireEvent.press(view.getByRole('button', { name: /^Date range, Sep \d, 2026 – Nov \d, 2026$/ }))
    await fireEvent.press(view.getByRole('radio', { name: 'Last 30 days' }))
    expect(onApplyFilters).toHaveBeenLastCalledWith({ fromDate: expect.any(String), toDate: expect.any(String) })
    await fireEvent.press(view.getByRole('button', { name: /^Date range,/ }))
    await fireEvent.press(view.getByRole('radio', { name: 'All dates' }))
    expect(onApplyFilters).toHaveBeenLastCalledWith({}, { all: true })
    await fireEvent.press(view.getByRole('button', { name: /^Date range,/ }))
    await fireEvent.changeText(view.getByLabelText('From date'), '2026-07-01')
    await fireEvent.changeText(view.getByLabelText('To date'), '2026-07-31')
    await fireEvent.press(view.getByRole('button', { name: 'Apply date range' }))
    expect(onApplyFilters).toHaveBeenLastCalledWith({ fromDate: '2026-07-01T00:00:00.000Z', toDate: '2026-07-31T23:59:59.999Z' })
  })

  it('filters the loaded rows by type and ticker from the Filters sheet, with a count and clear all', async () => {
    const deposit = { ...transaction, id: 'transaction:2', cashCurrency: 'EUR', name: null, ticker: null, quantity: 1, amount: 400, transactionKey: 72, type: 'DEPOSIT', typeLabel: 'Deposit' }
    const view = await provider(<PortfolioActivityScreen state={{ status: 'loaded', rows: [transaction, deposit, split] }} aggregate filters={{}} {...callbacks} />)
    expect(view.getAllByTestId('portfolio-activity-row')).toHaveLength(3)
    await fireEvent.press(view.getByRole('button', { name: 'Filters' }))
    await fireEvent.press(view.getByRole('button', { name: /^Transaction type,/ }))
    await fireEvent.press(view.getByRole('radio', { name: 'Deposit' }))
    expect(view.getAllByTestId('portfolio-activity-row')).toHaveLength(1)
    expect(view.getByRole('button', { name: 'Filters, 1 filter' })).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: /^Ticker,/ }))
    await fireEvent.press(view.getByRole('radio', { name: 'AAPL' }))
    expect(view.queryByTestId('portfolio-activity-row')).not.toBeOnTheScreen()
    expect(view.getByText('No activity matches these filters')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Clear all' }))
    expect(view.getAllByTestId('portfolio-activity-row')).toHaveLength(3)
  })

  it('keeps incomplete stock splits visible without implying a ratio', async () => {
    const explicitNull = { ...incompleteSplit, id: 'split:null', split: { denominator: null, numerator: null, ratio: null } }
    const omittedNormalized = { ...incompleteSplit, id: 'split:omitted', split: { denominator: null, numerator: null, ratio: null } }
    const view = await provider(<PortfolioActivityScreen state={{ status: 'loaded', rows: [transaction, incompleteSplit, explicitNull, omittedNormalized, split] }} aggregate filters={{}} {...callbacks} />)
    expect(view.getAllByTestId('portfolio-activity-row')).toHaveLength(5)
    expect(view.getAllByText(/Ratio details unavailable · Stock split, read only/)).toHaveLength(3)
    expect(view.getByText(/4 for 1 · Stock split, read only/)).toBeOnTheScreen()
    const partialLabel = view.getAllByTestId('portfolio-activity-row')[1]?.props.accessibilityLabel as string
    expect(partialLabel).toContain('Ratio details unavailable')
    expect(partialLabel).toContain('Stock split, read only')
    expect(partialLabel).not.toContain('4 for')
    expect(view.getAllByTestId('portfolio-activity-row')[0]?.props.accessibilityLabel).toMatch(/^Buy, /)
  })

  it('has dedicated initial and cached 429 recovery without sign-out', async () => {
    const initial = await provider(<PortfolioActivityScreen state={{ status: 'rate-limited' }} aggregate filters={{}} {...callbacks} />)
    expect(initial.getByRole('alert')).toHaveTextContent(/too many requests/i)
    expect(initial.getByRole('button', { name: 'Try later' })).toBeOnTheScreen()
    expect(initial.queryByRole('button', { name: /sign out/i })).not.toBeOnTheScreen()
    const cached = await provider(<PortfolioActivityScreen state={{ status: 'rate-limited-cached', rows: [transaction] }} aggregate filters={{}} {...callbacks} />)
    expect(cached.getByTestId('portfolio-activity-row')).toBeOnTheScreen()
    expect(cached.getByRole('alert')).toHaveTextContent(/remains visible/i)
  })

  it('says why each withheld metric is missing, never a zero, and notes the missing history', async () => {
    const metrics = { metrics: { annualYield: null, assetAllocation: {}, currentValue: 100, maxDrawdown: null, readiness: { allocation: { status: 'ready' as const }, holdings: { status: 'ready' as const }, performance: { status: 'insufficient_history' as const }, riskMetrics: { status: 'insufficient_history' as const } }, riskLevel: null, sharpeRatio: null, totalReturn: 0, volatility: null } }
    const view = await provider(<PortfolioMetricsSection state={{ status: 'loaded', data: metrics }} locale="en" />)
    expect(view.getByText('Advanced metrics')).toBeOnTheScreen()
    expect(view.getByText(/about a month of daily snapshots/i)).toBeOnTheScreen()
    expect(view.getAllByText('Needs a year of history')).toHaveLength(2)
    expect(view.getByText('Needs 3 months of price history')).toBeOnTheScreen()
    expect(view.queryByText(/0\.0%/)).not.toBeOnTheScreen()
  })

  it('shows drawdown once the API reports it, beside the figures it still withholds', async () => {
    const metrics = { metrics: { annualYield: null, assetAllocation: {}, currentValue: 100, maxDrawdown: 4.2, readiness: { allocation: { status: 'ready' as const }, holdings: { status: 'ready' as const }, performance: { status: 'ready' as const }, riskMetrics: { status: 'ready' as const } }, riskLevel: 'Medium' as const, sharpeRatio: 1.234, totalReturn: 12, volatility: null } }
    const view = await provider(<PortfolioMetricsSection state={{ status: 'loaded', data: metrics }} locale="en" />)
    expect(view.getByText('4.2%')).toBeOnTheScreen()
    expect(view.getByText('1.23')).toBeOnTheScreen()
    expect(view.getByText('Medium')).toBeOnTheScreen()
  })

  it('lists dividends largest first and never invents a currency', async () => {
    const data = mapPortfolioDividendIncome({ byAsset: [{ financialAssetKey: 1, symbol: 'AAPL', totalDividends: 4 }, { financialAssetKey: 2, symbol: 'MSFT', totalDividends: 9 }], totalDividends: 13 }, 'EUR')
    const view = await provider(<DividendIncomeBody data={data} locale="en" />)
    expect(view.getByLabelText('Total dividends, €13.00')).toBeOnTheScreen()
    expect(view.getByText('Dividends by Asset')).toBeOnTheScreen()
    const noCurrency = await provider(<DividendIncomeBody data={mapPortfolioDividendIncome({ byAsset: [{ financialAssetKey: 1, symbol: 'AAPL', totalDividends: 4 }], totalDividends: 4 }, 'eur')} locale="en" />)
    expect(noCurrency.getAllByText(/currency unavailable/).length).toBeGreaterThan(0)
  })

  describe('transaction deletion', () => {
    afterEach(() => jest.restoreAllMocks())

    it('never offers deletion in the aggregate view, even when a handler is provided', async () => {
      const onDeleteTransaction = jest.fn()
      const view = await provider(<PortfolioActivityScreen state={{ status: 'loaded', rows: [transaction] }} aggregate filters={{}} {...callbacks} onDeleteTransaction={onDeleteTransaction} />)
      expect(view.queryByRole('button', { name: /^Actions for/ })).not.toBeOnTheScreen()
    })

    it('never offers deletion on a read-only stock split', async () => {
      const onDeleteTransaction = jest.fn()
      const view = await provider(<PortfolioActivityScreen state={{ status: 'loaded', rows: [split] }} aggregate={false} filters={{}} {...callbacks} onDeleteTransaction={onDeleteTransaction} />)
      expect(view.queryByRole('button', { name: /^Actions for/ })).not.toBeOnTheScreen()
    })

    it('deletes only after explicit confirmation, by the real transaction key', async () => {
      const onDeleteTransaction = jest.fn().mockResolvedValue(undefined)
      jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => { buttons?.[1]?.onPress?.() })
      const view = await provider(<PortfolioActivityScreen state={{ status: 'loaded', rows: [transaction] }} aggregate={false} filters={{}} {...callbacks} onDeleteTransaction={onDeleteTransaction} />)
      await openRowMenu(view, 'Delete')
      await waitFor(() => expect(onDeleteTransaction).toHaveBeenCalledWith(41))
    })

    it('does not delete when the confirmation is cancelled', async () => {
      const onDeleteTransaction = jest.fn().mockResolvedValue(undefined)
      jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => { buttons?.[0]?.onPress?.() })
      const view = await provider(<PortfolioActivityScreen state={{ status: 'loaded', rows: [transaction] }} aggregate={false} filters={{}} {...callbacks} onDeleteTransaction={onDeleteTransaction} />)
      await openRowMenu(view, 'Delete')
      expect(onDeleteTransaction).not.toHaveBeenCalled()
    })

    it('surfaces a scoped failure without disturbing the rest of the row', async () => {
      const onDeleteTransaction = jest.fn().mockRejectedValue(new Error('boom'))
      jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => { buttons?.[1]?.onPress?.() })
      const view = await provider(<PortfolioActivityScreen state={{ status: 'loaded', rows: [transaction] }} aggregate={false} filters={{}} {...callbacks} onDeleteTransaction={onDeleteTransaction} />)
      await openRowMenu(view, 'Delete')
      expect(await view.findByRole('alert')).toHaveTextContent(/could not be deleted/i)
      expect(view.getByText('AAPL')).toBeOnTheScreen()
    })
  })

  describe('transaction editing', () => {
    it('never offers editing in the aggregate view, even when a handler is provided', async () => {
      const view = await provider(<PortfolioActivityScreen state={{ status: 'loaded', rows: [transaction] }} aggregate filters={{}} {...callbacks} onEditTransaction={jest.fn()} />)
      expect(view.queryByRole('button', { name: /^Actions for/ })).not.toBeOnTheScreen()
    })

    it('never offers editing on a read-only stock split', async () => {
      const view = await provider(<PortfolioActivityScreen state={{ status: 'loaded', rows: [split] }} aggregate={false} filters={{}} {...callbacks} onEditTransaction={jest.fn()} />)
      expect(view.queryByRole('button', { name: /^Actions for/ })).not.toBeOnTheScreen()
    })

    it('opens a form prefilled from the row and submits only the fields actually changed', async () => {
      const onEditTransaction = jest.fn().mockResolvedValue(undefined)
      const view = await provider(<PortfolioActivityScreen state={{ status: 'loaded', rows: [transaction] }} aggregate={false} filters={{}} {...callbacks} onEditTransaction={onEditTransaction} />)
      await openRowMenu(view, 'Edit')
      expect(view.getByLabelText('Quantity').props.value).toBe('2.5')
      expect(view.getByLabelText('Unit price').props.value).toBe('8.1')
      expect(view.getByLabelText('Transaction date').props.value).toBe('2026-07-19')
      expect(view.getByLabelText('Notes').props.value).toBe('')
      await fireEvent.changeText(view.getByLabelText('Quantity'), '5')
      await fireEvent.press(view.getByRole('button', { name: 'Save changes' }))
      await waitFor(() => expect(onEditTransaction).toHaveBeenCalledWith(41, { quantity: '5', unitPrice: undefined, transactionDate: undefined, notes: undefined }))
    })

    it('reads the edited numbers in the app language and sends dot decimals', async () => {
      const onEditTransaction = jest.fn().mockResolvedValue(undefined)
      const view = await provider(<PortfolioActivityScreen state={{ status: 'loaded', rows: [transaction] }} aggregate={false} filters={{}} {...callbacks} onEditTransaction={onEditTransaction} />)
      await openRowMenu(view, 'Edit')
      await fireEvent.changeText(view.getByLabelText('Quantity'), '1,000')
      await fireEvent.changeText(view.getByLabelText('Unit price'), '1,234.5')
      await fireEvent.press(view.getByRole('button', { name: 'Save changes' }))
      await waitFor(() => expect(onEditTransaction).toHaveBeenCalledWith(41, { quantity: '1000', unitPrice: '1234.5', transactionDate: undefined, notes: undefined }))
    })

    it('shows an error and does not save a number it cannot read', async () => {
      const onEditTransaction = jest.fn().mockResolvedValue(undefined)
      const view = await provider(<PortfolioActivityScreen state={{ status: 'loaded', rows: [transaction] }} aggregate={false} filters={{}} {...callbacks} onEditTransaction={onEditTransaction} />)
      await openRowMenu(view, 'Edit')
      await fireEvent.changeText(view.getByLabelText('Unit price'), '1.2.3')
      expect(view.getByText('Enter a unit price greater than 0.')).toBeOnTheScreen()
      expect(view.getByRole('button', { name: 'Save changes' })).toBeDisabled()
      await fireEvent.press(view.getByRole('button', { name: 'Save changes' }))
      expect(onEditTransaction).not.toHaveBeenCalled()
    })

    it('closes the form and discards the draft on cancel without submitting', async () => {
      const onEditTransaction = jest.fn().mockResolvedValue(undefined)
      const view = await provider(<PortfolioActivityScreen state={{ status: 'loaded', rows: [transaction] }} aggregate={false} filters={{}} {...callbacks} onEditTransaction={onEditTransaction} />)
      await openRowMenu(view, 'Edit')
      await fireEvent.changeText(view.getByLabelText('Quantity'), '999')
      await fireEvent.press(view.getByRole('button', { name: 'Cancel' }))
      expect(onEditTransaction).not.toHaveBeenCalled()
      expect(view.queryByLabelText('Quantity')).not.toBeOnTheScreen()
      expect(view.getByRole('button', { name: /^Actions for/ })).toBeOnTheScreen()
    })

    it('keeps the form open and shows a scoped failure on a rejected save', async () => {
      const onEditTransaction = jest.fn().mockRejectedValue(new Error('boom'))
      const view = await provider(<PortfolioActivityScreen state={{ status: 'loaded', rows: [transaction] }} aggregate={false} filters={{}} {...callbacks} onEditTransaction={onEditTransaction} />)
      await openRowMenu(view, 'Edit')
      await fireEvent.changeText(view.getByLabelText('Quantity'), '5')
      await fireEvent.press(view.getByRole('button', { name: 'Save changes' }))
      expect(await view.findByRole('alert')).toHaveTextContent(/could not be changed/i)
      expect(view.getByLabelText('Quantity')).toBeOnTheScreen()
    })

    it('sends an explicit null when notes are cleared, distinct from leaving notes untouched', async () => {
      const noted = { ...transaction, id: 'transaction:2', notes: 'Original note' }
      const onEditTransaction = jest.fn().mockResolvedValue(undefined)
      const view = await provider(<PortfolioActivityScreen state={{ status: 'loaded', rows: [noted] }} aggregate={false} filters={{}} {...callbacks} onEditTransaction={onEditTransaction} />)
      await openRowMenu(view, 'Edit')
      await fireEvent.changeText(view.getByLabelText('Notes'), '')
      await fireEvent.press(view.getByRole('button', { name: 'Save changes' }))
      await waitFor(() => expect(onEditTransaction).toHaveBeenCalledWith(41, { quantity: undefined, unitPrice: undefined, transactionDate: undefined, notes: '' }))
    })
  })
})
