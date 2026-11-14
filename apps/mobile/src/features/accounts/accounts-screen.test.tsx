import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { formatCurrency } from '@/lib/formatters/financial'
import { initMobileI18n } from '@/lib/i18n'
import { touchHeight } from '@/test/touch-target'

import { accountsResponseSchema } from './accounts-contract'
import { AccountsScreen, type AccountsData, type AccountsInsights } from './accounts-screen'
import { mapAccounts } from './accounts-view-model'
import { estimatedTransactionFixture, transactionFixture, unconvertedTransactionFixture } from '@/features/transactions/test-fixtures'
import { mapTransactions } from '@/features/transactions/transactions-view-model'

// The charts draw on a Skia canvas this jest environment can't host; a stand-in keeps the
// screen's own logic under test (see portfolio-performance-chart.test.tsx).
jest.mock('victory-native', () => ({
  CartesianChart: (props: { children: (args: { points: Record<string, unknown>; chartBounds: { bottom: number } }) => React.ReactNode }) =>
    props.children({ points: { balance: [], gain: [], loss: [] }, chartBounds: { bottom: 0 } }),
  Area: () => null,
  Bar: () => null,
  Line: () => null,
}))

const data: AccountsData = {
  accounts: [
    { accountId: 1, accountName: 'Current account', institutionDisplayName: 'Bank One', isOwnedByViewer: true, isPrivate: false, source: 'open_banking', csvImportFormat: null, originalBalance: 0, originalCurrencyCode: 'EUR', primaryCurrencyCode: 'EUR', convertedBalance: 0, refreshedAt: '2026-07-17T10:00:00Z' },
    { accountId: 2, accountName: null, institutionDisplayName: null, isOwnedByViewer: true, isPrivate: true, source: 'manual', csvImportFormat: null, originalBalance: null, originalCurrencyCode: 'EUR', primaryCurrencyCode: 'EUR', convertedBalance: null, refreshedAt: null },
    { accountId: 3, accountName: 'Yen savings', institutionDisplayName: 'Bank Two', isOwnedByViewer: false, ownerFirstName: 'Ana', isPrivate: false, source: 'open_banking', csvImportFormat: null, originalBalance: 1200, originalCurrencyCode: 'JPY', primaryCurrencyCode: 'EUR', convertedBalance: 7.2, refreshedAt: 'invalid' },
  ],
}

const complete: AccountsData = {
  accounts: [
    { ...data.accounts[0]!, convertedBalance: 1000, originalBalance: 1000 },
    { ...data.accounts[2]!, convertedBalance: 7.2 },
  ],
}

const insights: AccountsInsights = {
  timeframe: 'YTD',
  metrics: { status: 'loaded', summary: { inflowCurrent: 300, inflowPast: 100, outflowCurrent: 120, outflowPast: 60, inflowPct: 2, outflowPct: 1, netSavings: 180, netSavingsPast: 40, savingsRate: 0.6 } },
  categories: { status: 'loaded', data: [{ id: 4, name: 'Groceries', amount: -75, currency: 'EUR', transactionCount: 3 }] },
  balance: { status: 'loaded', data: [] },
  transactions: { status: 'loaded', data: [] },
  cashflow: { status: 'loaded', data: [] },
}

async function renderScreen(state: React.ComponentProps<typeof AccountsScreen>['state'], extra: Partial<React.ComponentProps<typeof AccountsScreen>> = {}) {
  const i18n = await initMobileI18n('en')
  const refresh = jest.fn()
  const logout = jest.fn()
  const selectAccount = jest.fn()
  const createAccount = jest.fn()
  const view = await render(<I18nextProvider i18n={i18n}><AccountsScreen state={state} onRefresh={refresh} onLogout={logout} onSelectAccount={selectAccount} onCreateAccount={createAccount} onViewTransactions={jest.fn()} {...extra} /></I18nextProvider>)
  return { view, refresh, logout, selectAccount, createAccount }
}

describe('AccountsScreen', () => {
  it('leads with the title and one add action, the period, total balance with change, then the flow stats', async () => {
    const onTimeframeChange = jest.fn()
    const onCreateTransaction = jest.fn()
    const { view } = await renderScreen({ status: 'loaded', data: { ...complete, insights } }, { onTimeframeChange, onCreateTransaction })
    expect(view.getByRole('header', { name: 'Accounts overview' })).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Period, Year to Date' })).toBeOnTheScreen()
    // The floating "+" holds both add actions.
    expect(view.queryByRole('button', { name: 'Add account' })).not.toBeOnTheScreen()
    expect(view.getByTestId('accounts-add').props.accessibilityLabel).toBe('Add')
    await fireEvent.press(view.getByRole('button', { name: 'Add' }))
    expect(view.getByRole('menuitem', { name: /^Add account/ })).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('menuitem', { name: 'Add transaction' }))
    expect(onCreateTransaction).toHaveBeenCalledTimes(1)
    expect(view.getByText('Total balance')).toBeOnTheScreen()
    // The total's change, then each stat's comparison.
    expect(view.getAllByText('vs last period')).toHaveLength(4)
    for (const label of ['Inflow', 'Outflow', 'Savings rate']) expect(view.getByText(label)).toBeOnTheScreen()
    expect(view.getByText('Net savings this period, 60% of inflow')).toBeOnTheScreen()
    const headers = view.getAllByRole('header').map((node) => node.props.children)
    expect(headers).toEqual(expect.arrayContaining(['Spending by category', 'Balance growth', 'Accounts', 'Last transactions', 'Cashflow']))
    expect(headers.indexOf('Spending by category')).toBeLessThan(headers.indexOf('Accounts'))
    expect(headers.indexOf('Accounts')).toBeLessThan(headers.indexOf('Cashflow'))
    expect(view.getByText('Groceries')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Period, Year to Date' }))
    await fireEvent.press(view.getByRole('radio', { name: '1 Month' }))
    expect(onTimeframeChange).toHaveBeenCalledWith('1M')
  })

  it('shows the reader-currency balance per row, the account currency beside it, and a total', async () => {
    const { view, selectAccount } = await renderScreen({ status: 'loaded', data })
    const rows = view.getAllByTestId('account-row')
    const eurZero = formatCurrency(0, { locale: 'en', currency: 'EUR' })
    const yen = formatCurrency(1200, { locale: 'en', currency: 'JPY' })
    const converted = formatCurrency(7.2, { locale: 'en', currency: 'EUR' })
    expect(rows).toHaveLength(3)
    expect(rows[0].props.accessibilityLabel).toMatch(new RegExp(`^Current account, Bank One, ${eurZero.replace('.', '\\.')}`))
    expect(rows[1].props.accessibilityLabel).toBe('Unnamed account, Private, Balance unavailable')
    expect(rows[2].props.accessibilityLabel).toBe(`Yen savings, Shared by Ana, Bank Two, ${converted}, ${yen}`)
    expect(view.getByText(yen)).toBeOnTheScreen()
    expect(view.queryByText(/invalid/i)).not.toBeOnTheScreen()
    // One balance is missing, so the total is unknown rather than smaller.
    expect(view.getAllByText('Unavailable — some balances are missing').length).toBeGreaterThan(0)
    expect(touchHeight(rows[0])).toBeGreaterThanOrEqual(44)
    await fireEvent.press(rows[0])
    expect(selectAccount).toHaveBeenCalledWith(1)
  })

  it('leads an account with no exchange rate with its own balance, marked not converted', async () => {
    const yen = data.accounts[2]!
    const { view } = await renderScreen({ status: 'loaded', data: { accounts: [{ ...yen, convertedBalance: null, fx: { status: 'missing', amount: 1200, currency: 'JPY' } }] } })
    const [row] = view.getAllByTestId('account-row')
    const original = formatCurrency(1200, { locale: 'en', currency: 'JPY' })
    expect(row!.props.accessibilityLabel).toBe(`Yen savings, Shared by Ana, Bank Two, ${original}, Not converted. No exchange rate for JPY yet, so this amount is shown in JPY and left out of totals.`)
    expect(view.getByTestId('account-fx-status')).toHaveTextContent('Not converted')
    expect(view.queryByText('Balance unavailable')).not.toBeOnTheScreen()
  })

  it('marks an account converted at an old rate as estimated, with the rate date', async () => {
    const { view } = await renderScreen({ status: 'loaded', data: { accounts: [{ ...data.accounts[2]!, fx: { status: 'provisional', rateDate: '2026-01-15' } }] } })
    expect(view.getByTestId('account-fx-status')).toHaveTextContent(/Estimated.*Rate of Jan 15, 2026/)
    expect(view.getAllByTestId('account-row')[0]!.props.accessibilityLabel).toMatch(/Estimated\. Converted at the rate from Jan 15, 2026/)
  })

  it('marks nothing on an account converted at a current rate', async () => {
    const { view } = await renderScreen({ status: 'loaded', data: { accounts: [{ ...data.accounts[2]!, fx: { status: 'exact' } }] } })
    expect(view.queryByTestId('account-fx-status')).not.toBeOnTheScreen()
  })

  it('shows a last transaction with no exchange rate in its own currency, marked, and an estimated one with its rate date', async () => {
    const transactions = { status: 'loaded' as const, data: mapTransactions({ transactions: [unconvertedTransactionFixture, estimatedTransactionFixture, transactionFixture] }) }
    const { view } = await renderScreen({ status: 'loaded', data: { ...complete, insights: { ...insights, transactions } } })
    const labels = view.getAllByTestId('transaction-fx-status')
    expect(labels).toHaveLength(2)
    expect(labels[0]).toHaveTextContent('Not converted')
    expect(labels[1]).toHaveTextContent(/Estimated.*Nov 3, 2026/)
    expect(view.getByText(/10,000/)).toBeOnTheScreen()
  })

  it('opens the row menu for edit and delete', async () => {
    const onEditAccount = jest.fn()
    const { view } = await renderScreen({ status: 'loaded', data }, { onEditAccount })
    await fireEvent.press(view.getByRole('button', { name: 'Actions for Current account' }))
    await fireEvent.press(view.getByRole('menuitem', { name: 'Edit' }))
    expect(onEditAccount).toHaveBeenCalledWith(1)
  })

  it('marks an account the caller can only view, and offers only its details from its menu', async () => {
    const onEditAccount = jest.fn()
    const viewOnly: AccountsData = { accounts: [{ ...data.accounts[2]!, myAccess: 'read' }] }
    const { view } = await renderScreen({ status: 'loaded', data: viewOnly }, { onEditAccount })
    expect(view.getByTestId('account-view-only')).toHaveTextContent('View only')
    await fireEvent.press(view.getByRole('button', { name: 'Actions for Yen savings' }))
    expect(view.getAllByRole('menuitem').map((item) => item.props.accessibilityLabel)).toEqual(['Account details'])
  })

  it('adds a manual account from the floating add, and keeps linking a bank and import behind the overflow menu', async () => {
    const onConnectBank = jest.fn()
    const onImportTransactions = jest.fn()
    const { view, createAccount } = await renderScreen({ status: 'loaded', data }, { onConnectBank, onImportTransactions, onCreateTransaction: jest.fn() })
    await fireEvent.press(view.getByRole('button', { name: 'Add' }))
    await fireEvent.press(view.getByRole('menuitem', { name: /^Add account/ }))
    expect(createAccount).toHaveBeenCalledTimes(1)
    await fireEvent.press(view.getByRole('button', { name: 'More actions' }))
    await fireEvent.press(view.getByRole('menuitem', { name: /^Link a bank account/ }))
    expect(onConnectBank).toHaveBeenCalledTimes(1)
    await fireEvent.press(view.getByRole('button', { name: 'More actions' }))
    await fireEvent.press(view.getByRole('menuitem', { name: 'Import transactions' }))
    expect(onImportTransactions).toHaveBeenCalledTimes(1)
  })

  it('has no overflow menu when there is nothing secondary to offer', async () => {
    const { view } = await renderScreen({ status: 'loaded', data })
    expect(view.queryByRole('button', { name: 'More actions' })).not.toBeOnTheScreen()
  })

  it('makes the add action Add account itself when there is nothing else to add', async () => {
    const { view, createAccount } = await renderScreen({ status: 'loaded', data })
    await fireEvent.press(view.getByRole('button', { name: 'Add account' }))
    expect(createAccount).toHaveBeenCalledTimes(1)
    expect(view.queryByRole('menuitem')).not.toBeOnTheScreen()
  })

  it('keeps each insight section independent of the others', async () => {
    const { view } = await renderScreen({ status: 'loaded', data: { ...complete, insights: { ...insights, categories: { status: 'error' }, metrics: { status: 'loading' } } } })
    expect(view.getByText('Could not load this section. Pull down to try again.')).toBeOnTheScreen()
    expect(view.getByText('Yen savings')).toBeOnTheScreen()
  })

  it('renders empty, loading, stale, initial error, and invalid states safely', async () => {
    const empty = await renderScreen({ status: 'loaded', data: { ...data, accounts: [] } })
    expect(empty.view.getByText('No accounts yet')).toBeOnTheScreen()
    await fireEvent.press(empty.view.getByRole('button', { name: 'Add account' }))
    expect(empty.createAccount).toHaveBeenCalledTimes(1)

    const loading = await renderScreen({ status: 'loading' })
    expect(loading.view.getByRole('progressbar', { name: 'Loading accounts' })).toBeOnTheScreen()

    const stale = await renderScreen({ status: 'refresh-error', data })
    expect(stale.view.getByRole('alert', { name: 'Could not refresh. Showing previously loaded balances' })).toBeOnTheScreen()
    expect(stale.view.getByText('Current account')).toBeOnTheScreen()

    for (const status of ['error', 'invalid-response'] as const) {
      const failed = await renderScreen({ status })
      expect(failed.view.queryByText('Current account')).not.toBeOnTheScreen()
      await fireEvent.press(failed.view.getByRole('button', { name: 'Retry' }))
      await fireEvent.press(failed.view.getByRole('button', { name: 'Sign out' }))
      expect(failed.refresh).toHaveBeenCalledTimes(1)
      expect(failed.logout).toHaveBeenCalledTimes(1)
    }
  })

  it('exposes no images to screen readers (marks are decorative) and keeps sign-out in the account menu', async () => {
    const { view } = await renderScreen({ status: 'loaded', data })
    expect(view.queryByRole('image')).not.toBeOnTheScreen()
    expect(view.queryByRole('button', { name: 'Sign out' })).not.toBeOnTheScreen()
  })

  it("leads each account row with its institution's logo, else the institution's letters, else a type glyph", async () => {
    const withLogo = { ...data, accounts: [{ ...data.accounts[0]!, institutionLogoUrl: 'https://cdn.example/bank-one.png' }, data.accounts[1]!, data.accounts[2]!] }
    const { view } = await renderScreen({ status: 'loaded', data: withLogo })
    const marks = view.getAllByTestId('account-mark', { includeHiddenElements: true })
    expect(marks).toHaveLength(3)
    expect(view.getAllByTestId('account-mark-image', { includeHiddenElements: true })).toHaveLength(1)
    expect(view.getByText('BT', { includeHiddenElements: true })).toBeOnTheScreen()
    // The row's own label still names the account; the mark adds nothing to it.
    expect(view.getAllByRole('button', { name: /^Current account, Bank One/ })).toHaveLength(1)
  })

  it('hides all account chrome during an access transition', async () => {
    const { view } = await renderScreen({ status: 'access-transition' })
    expect(view.toJSON()).toBeNull()
  })

  it('keeps primary actions scalable and at least 44dp to the finger', async () => {
    const { view } = await renderScreen({ status: 'loaded', data }, { onCreateTransaction: jest.fn() })
    expect(touchHeight(view.getByRole('button', { name: 'Add' }))).toBeGreaterThanOrEqual(44)
  })

  it('uses pull-to-refresh instead of a persistent refresh button', async () => {
    const { view } = await renderScreen({ status: 'loaded', data, refreshing: true })
    expect(view.queryByRole('button', { name: 'Refresh' })).not.toBeOnTheScreen()
  })

  it('reorders accounts with the up and down buttons and saves the new order', async () => {
    const onReorderAccounts = jest.fn().mockResolvedValue(undefined)
    const { view } = await renderScreen({ status: 'loaded', data }, { onReorderAccounts })

    await fireEvent.press(view.getByRole('button', { name: 'Reorder' }))
    expect(view.getByRole('button', { name: 'Move Current account up' })).toBeDisabled()
    expect(view.getByRole('button', { name: 'Move Yen savings down' })).toBeDisabled()

    await fireEvent.press(view.getByRole('button', { name: 'Move Current account down' }))
    expect(onReorderAccounts).toHaveBeenCalledWith([2, 1, 3])
    // The list follows the new order immediately.
    expect(view.getAllByTestId('account-row')[1]!.props.accessibilityLabel).toMatch(/^Current account/)

    await fireEvent.press(view.getByRole('button', { name: 'Done' }))
    expect(view.queryByRole('button', { name: 'Move Current account up' })).not.toBeOnTheScreen()
  })

  it('puts the order back when the API refuses it', async () => {
    const onReorderAccounts = jest.fn().mockRejectedValue(new Error('refused'))
    const { view } = await renderScreen({ status: 'loaded', data }, { onReorderAccounts })

    await fireEvent.press(view.getByRole('button', { name: 'Reorder' }))
    await fireEvent.press(view.getByRole('button', { name: 'Move Current account down' }))

    await waitFor(() => expect(view.getByText('The new order could not be saved.')).toBeOnTheScreen())
    expect(view.getAllByTestId('account-row')[0]!.props.accessibilityLabel).toMatch(/^Current account/)
  })
})

describe('AccountsScreen with values this build does not know', () => {
  it('renders an account whose source is new to this build', async () => {
    const response = accountsResponseSchema.parse({ accounts: [{
      accountFinancialInstitutionKey: null, accountKey: 4, accountName: 'Imported account', accountOwnerAppuserKey: { currencyKey: { code: 'EUR' } },
      appuserCurrencyBalance: 10, balance: 10, currencyKey: { code: 'EUR' }, isOwnedByViewer: true, isPrivate: false,
      refreshedAt: null, source: 'csv_import', syncState: 'idle', syncStatus: { staleness: 'mystery', lastSyncedAt: 'not a date' },
    }] })
    const { view } = await renderScreen({ status: 'loaded', data: { accounts: mapAccounts(response) } })
    expect(view.getByText('Imported account')).toBeOnTheScreen()
  })
})
