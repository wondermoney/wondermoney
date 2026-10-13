import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { Alert } from 'react-native'

import { initMobileI18n } from '@/lib/i18n'

import { activityCalendarFilters, formatPortfolioActivityTimestamp, PortfolioActivityScreen } from './portfolio-activity-screen'
import { PortfolioAnalyticsPanel } from './portfolio-analytics-panel'
import { mapPortfolioAnalytics } from './portfolio-activity-view-model'
import { themeTokens } from '@/theme/tokens'

async function provider(node: React.ReactNode) {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>)
}

const callbacks = { onBack: jest.fn(), onApplyFilters: jest.fn(), onRefresh: jest.fn(), onLogout: jest.fn() }
const transaction = { amount: 20.25, currency: 'EUR', id: 'transaction:1', itemType: 'TRANSACTION' as const, name: 'Apple', notes: null, portfolioId: 3, portfolioName: 'Broker', quantity: 2.5, split: null, ticker: 'AAPL', timestamp: '2026-07-19T10:00:00.000Z', transactionKey: 41, type: 'BUY', unitPrice: 8.1 }
const split = { amount: null, currency: null, id: 'split:1', itemType: 'STOCK_SPLIT' as const, name: 'Apple', notes: null, portfolioId: 3, portfolioName: 'Broker', quantity: null, split: { denominator: 1, numerator: 4, ratio: 4 }, ticker: 'AAPL', timestamp: '2026-07-18T00:00:00.000Z', transactionKey: null, type: 'STOCK_SPLIT', unitPrice: null }
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
    expect(rows[0]?.props.accessibilityLabel).toMatch(/BUY, AAPL · Apple.*Quantity 2.5.*€20.25.*Broker/)
    expect(rows[1]?.props.accessibilityLabel).toMatch(/Stock split.*4 for 1.*read only/i)
    expect(view.getByLabelText('From date')).toBeOnTheScreen()
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
    expect(view.getAllByTestId('portfolio-activity-row')[0]?.props.accessibilityLabel).toContain('BUY')
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

  it('renders analytics percentage points, validated currency, and honest not-ready risk', async () => {
    const metrics = { metrics: { annualYield: null, assetAllocation: {}, currentValue: 100, maxDrawdown: null, readiness: { allocation: { status: 'ready' as const }, holdings: { status: 'ready' as const }, performance: { status: 'insufficient_history' as const }, riskMetrics: { status: 'insufficient_history' as const } }, riskLevel: null, sharpeRatio: null, totalReturn: 0, volatility: null } }
    const data = mapPortfolioAnalytics({ byType: [{ percentage: 12.5, type: 'Stock', value: 100 }], byAssetClass: [], unclassifiedHoldings: [] }, { byAsset: [{ financialAssetKey: 1, symbol: 'AAPL', totalDividends: 4 }], totalDividends: 4 }, metrics, 'EUR')
    const view = await provider(<PortfolioAnalyticsPanel state={{ status: 'loaded', data }} locale="en" palette={themeTokens.colors.light} onEnable={jest.fn()} onRetry={jest.fn()} />)
    expect(view.getByText('+12.5%')).toBeOnTheScreen()
    expect(view.queryByText(/1,250/)).not.toBeOnTheScreen()
    expect(view.getByText(/dashboard currency EUR/)).toBeOnTheScreen()
    expect(view.getByText(/insufficient history/i)).toBeOnTheScreen()
    expect(view.getAllByText('Unavailable').length).toBeGreaterThanOrEqual(4)
    const unavailable = mapPortfolioAnalytics({ byType: [], byAssetClass: [], unclassifiedHoldings: [] }, { byAsset: [], totalDividends: 4 }, metrics, 'eur')
    const noCurrency = await provider(<PortfolioAnalyticsPanel state={{ status: 'loaded', data: unavailable }} locale="en" palette={themeTokens.colors.light} onEnable={jest.fn()} onRetry={jest.fn()} />)
    expect(noCurrency.getByText(/Currency unavailable. The dividend endpoint/)).toBeOnTheScreen()
  })

  it('requires an explicit press before analytics leaves its dormant panel', async () => {
    const enable = jest.fn()
    const view = await provider(<PortfolioAnalyticsPanel state={{ status: 'idle' }} locale="en" palette={themeTokens.colors.light} onEnable={enable} onRetry={jest.fn()} />)
    await fireEvent.press(view.getByRole('button', { name: 'Load analytics' }))
    expect(enable).toHaveBeenCalledTimes(1)
  })

  describe('transaction deletion', () => {
    afterEach(() => jest.restoreAllMocks())

    it('never offers deletion in the aggregate view, even when a handler is provided', async () => {
      const onDeleteTransaction = jest.fn()
      const view = await provider(<PortfolioActivityScreen state={{ status: 'loaded', rows: [transaction] }} aggregate filters={{}} {...callbacks} onDeleteTransaction={onDeleteTransaction} />)
      expect(view.queryByRole('button', { name: 'Delete' })).not.toBeOnTheScreen()
    })

    it('never offers deletion on a read-only stock split', async () => {
      const onDeleteTransaction = jest.fn()
      const view = await provider(<PortfolioActivityScreen state={{ status: 'loaded', rows: [split] }} aggregate={false} filters={{}} {...callbacks} onDeleteTransaction={onDeleteTransaction} />)
      expect(view.queryByRole('button', { name: 'Delete' })).not.toBeOnTheScreen()
    })

    it('deletes only after explicit confirmation, by the real transaction key', async () => {
      const onDeleteTransaction = jest.fn().mockResolvedValue(undefined)
      jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => { buttons?.[1]?.onPress?.() })
      const view = await provider(<PortfolioActivityScreen state={{ status: 'loaded', rows: [transaction] }} aggregate={false} filters={{}} {...callbacks} onDeleteTransaction={onDeleteTransaction} />)
      await fireEvent.press(view.getByRole('button', { name: 'Delete' }))
      await waitFor(() => expect(onDeleteTransaction).toHaveBeenCalledWith(41))
    })

    it('does not delete when the confirmation is cancelled', async () => {
      const onDeleteTransaction = jest.fn().mockResolvedValue(undefined)
      jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => { buttons?.[0]?.onPress?.() })
      const view = await provider(<PortfolioActivityScreen state={{ status: 'loaded', rows: [transaction] }} aggregate={false} filters={{}} {...callbacks} onDeleteTransaction={onDeleteTransaction} />)
      await fireEvent.press(view.getByRole('button', { name: 'Delete' }))
      expect(onDeleteTransaction).not.toHaveBeenCalled()
    })

    it('surfaces a scoped failure without disturbing the rest of the row', async () => {
      const onDeleteTransaction = jest.fn().mockRejectedValue(new Error('boom'))
      jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => { buttons?.[1]?.onPress?.() })
      const view = await provider(<PortfolioActivityScreen state={{ status: 'loaded', rows: [transaction] }} aggregate={false} filters={{}} {...callbacks} onDeleteTransaction={onDeleteTransaction} />)
      await fireEvent.press(view.getByRole('button', { name: 'Delete' }))
      expect(await view.findByRole('alert')).toHaveTextContent(/could not be deleted/i)
      expect(view.getByText('AAPL · Apple')).toBeOnTheScreen()
    })
  })

  describe('transaction editing', () => {
    it('never offers editing in the aggregate view, even when a handler is provided', async () => {
      const view = await provider(<PortfolioActivityScreen state={{ status: 'loaded', rows: [transaction] }} aggregate filters={{}} {...callbacks} onEditTransaction={jest.fn()} />)
      expect(view.queryByRole('button', { name: 'Edit' })).not.toBeOnTheScreen()
    })

    it('never offers editing on a read-only stock split', async () => {
      const view = await provider(<PortfolioActivityScreen state={{ status: 'loaded', rows: [split] }} aggregate={false} filters={{}} {...callbacks} onEditTransaction={jest.fn()} />)
      expect(view.queryByRole('button', { name: 'Edit' })).not.toBeOnTheScreen()
    })

    it('opens a form prefilled from the row and submits only the fields actually changed', async () => {
      const onEditTransaction = jest.fn().mockResolvedValue(undefined)
      const view = await provider(<PortfolioActivityScreen state={{ status: 'loaded', rows: [transaction] }} aggregate={false} filters={{}} {...callbacks} onEditTransaction={onEditTransaction} />)
      await fireEvent.press(view.getByRole('button', { name: 'Edit' }))
      expect(view.getByLabelText('Quantity').props.value).toBe('2.5')
      expect(view.getByLabelText('Unit price').props.value).toBe('8.1')
      expect(view.getByLabelText('Transaction date').props.value).toBe('2026-07-19')
      expect(view.getByLabelText('Notes').props.value).toBe('')
      await fireEvent.changeText(view.getByLabelText('Quantity'), '5')
      await fireEvent.press(view.getByRole('button', { name: 'Save changes' }))
      await waitFor(() => expect(onEditTransaction).toHaveBeenCalledWith(41, { quantity: '5', unitPrice: undefined, transactionDate: undefined, notes: undefined }))
    })

    it('closes the form and discards the draft on cancel without submitting', async () => {
      const onEditTransaction = jest.fn().mockResolvedValue(undefined)
      const view = await provider(<PortfolioActivityScreen state={{ status: 'loaded', rows: [transaction] }} aggregate={false} filters={{}} {...callbacks} onEditTransaction={onEditTransaction} />)
      await fireEvent.press(view.getByRole('button', { name: 'Edit' }))
      await fireEvent.changeText(view.getByLabelText('Quantity'), '999')
      await fireEvent.press(view.getByRole('button', { name: 'Cancel' }))
      expect(onEditTransaction).not.toHaveBeenCalled()
      expect(view.queryByLabelText('Quantity')).not.toBeOnTheScreen()
      expect(view.getByRole('button', { name: 'Edit' })).toBeOnTheScreen()
    })

    it('keeps the form open and shows a scoped failure on a rejected save', async () => {
      const onEditTransaction = jest.fn().mockRejectedValue(new Error('boom'))
      const view = await provider(<PortfolioActivityScreen state={{ status: 'loaded', rows: [transaction] }} aggregate={false} filters={{}} {...callbacks} onEditTransaction={onEditTransaction} />)
      await fireEvent.press(view.getByRole('button', { name: 'Edit' }))
      await fireEvent.changeText(view.getByLabelText('Quantity'), '5')
      await fireEvent.press(view.getByRole('button', { name: 'Save changes' }))
      expect(await view.findByRole('alert')).toHaveTextContent(/could not be changed/i)
      expect(view.getByLabelText('Quantity')).toBeOnTheScreen()
    })

    it('sends an explicit null when notes are cleared, distinct from leaving notes untouched', async () => {
      const noted = { ...transaction, id: 'transaction:2', notes: 'Original note' }
      const onEditTransaction = jest.fn().mockResolvedValue(undefined)
      const view = await provider(<PortfolioActivityScreen state={{ status: 'loaded', rows: [noted] }} aggregate={false} filters={{}} {...callbacks} onEditTransaction={onEditTransaction} />)
      await fireEvent.press(view.getByRole('button', { name: 'Edit' }))
      await fireEvent.changeText(view.getByLabelText('Notes'), '')
      await fireEvent.press(view.getByRole('button', { name: 'Save changes' }))
      await waitFor(() => expect(onEditTransaction).toHaveBeenCalledWith(41, { quantity: undefined, unitPrice: undefined, transactionDate: undefined, notes: '' }))
    })
  })
})
