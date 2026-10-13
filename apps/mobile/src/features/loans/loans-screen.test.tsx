import { render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { LoanDetailScreen } from './loan-detail-screen'
import { LoansScreen } from './loans-screen'
import { mapLoan, mapLoans, mapRepayments } from './loans-view-model'
import { loanFixture, repaymentFixture } from './test-fixtures'

const renderScreen = async (node: React.ReactElement) => {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>)
}

describe('loan screens', () => {
  it('shows mixed currencies only on their own loans without a combined total', async () => {
    const loans = mapLoans({ loans: [loanFixture, { ...loanFixture, loanKey: 8, name: 'US loan', currency: { currencyKey: 2, code: 'USD' }, outstandingPrincipal: 2_000 }] })
    const view = await renderScreen(<LoansScreen state={{ status: 'loaded', loans }} onOpenLoan={jest.fn()} onRefresh={jest.fn()} onBack={jest.fn()} onCreateLoan={jest.fn()} />)
    expect(view.getByText('€180,000.00')).toBeOnTheScreen()
    expect(view.getByText('$2,000.00')).toBeOnTheScreen()
    expect(view.queryByText(/182,000/)).not.toBeOnTheScreen()
    expect(view.getByRole('button', { name: /Home loan.*EUR/ })).toBeOnTheScreen()
    expect(view.getByRole('button', { name: /US loan.*USD/ })).toBeOnTheScreen()
  })

  it('shows truthful empty, stale, invalid, and loading states', async () => {
    const empty = await renderScreen(<LoansScreen state={{ status: 'loaded', loans: [] }} onOpenLoan={jest.fn()} onRefresh={jest.fn()} onBack={jest.fn()} onCreateLoan={jest.fn()} />)
    expect(empty.getByText('No loans')).toBeOnTheScreen()
    // Matches web's data-forward preview — see DESIGN_HISTORY.md's Known
    // Cross-Platform Gaps. This screen used to show no preview at all.
    expect(empty.getByText('Mortgage')).toBeOnTheScreen()
    expect(empty.getByText('Remaining term')).toBeOnTheScreen()
    expect(empty.getByText('28y 4m')).toBeOnTheScreen()
    empty.unmount()
    const stale = await renderScreen(<LoansScreen state={{ status: 'refresh-error', loans: [mapLoan(loanFixture)] }} onOpenLoan={jest.fn()} onRefresh={jest.fn()} onBack={jest.fn()} onCreateLoan={jest.fn()} />)
    expect(stale.getByRole('alert', { name: /previously loaded loans/ })).toBeOnTheScreen(); stale.unmount()
    const invalid = await renderScreen(<LoansScreen state={{ status: 'invalid-response' }} onOpenLoan={jest.fn()} onRefresh={jest.fn()} onBack={jest.fn()} onCreateLoan={jest.fn()} />)
    expect(invalid.getByRole('header', { name: 'Could not verify loan data' })).toBeOnTheScreen(); invalid.unmount()
    const loading = await renderScreen(<LoansScreen state={{ status: 'loading' }} onOpenLoan={jest.fn()} onRefresh={jest.fn()} onBack={jest.fn()} onCreateLoan={jest.fn()} />)
    expect(loading.getByRole('progressbar', { name: 'Loading loans' })).toBeOnTheScreen()
  })

  it('shows optional detail, bounded progress, and all repayment allocations separately', async () => {
    const loan = mapLoan({ ...loanFixture, progressPercentage: 120 })
    const repayments = mapRepayments({ repayments: [repaymentFixture] })
    const view = await renderScreen(<LoanDetailScreen state={{ status: 'loaded', loan, history: { status: 'loaded', repayments } }} onBack={jest.fn()} onRefresh={jest.fn()} />)
    expect(view.getByText('€180,000.00')).toBeOnTheScreen()
    expect(view.getAllByText('Example lender').length).toBeGreaterThan(0)
    expect(view.getByText('Fixed until 2028')).toBeOnTheScreen()
    expect(view.getByLabelText('Principal, €645.00')).toBeOnTheScreen()
    expect(view.getByLabelText('Interest, €300.00')).toBeOnTheScreen()
    expect(view.getByLabelText('Fees, €5.00')).toBeOnTheScreen()
    expect(view.getAllByText('€950.00').length).toBeGreaterThanOrEqual(2)
    expect(view.getByText(/Only principal reduces the loan balance/)).toBeOnTheScreen()
    expect(view.getByText(/transaction currency is not supplied/)).toBeOnTheScreen()
    expect(view.getByTestId('loan-progress').props.style[1].width).toBe('100%')
  })

  it('keeps loan data visible when repayment history is invalid or stale', async () => {
    const loan = mapLoan(loanFixture)
    const invalid = await renderScreen(<LoanDetailScreen state={{ status: 'loaded', loan, history: { status: 'invalid-response' } }} onBack={jest.fn()} onRefresh={jest.fn()} />)
    expect(invalid.getByText('€180,000.00')).toBeOnTheScreen()
    expect(invalid.getByRole('alert', { name: /history received could not be verified/ })).toBeOnTheScreen(); invalid.unmount()
    const stale = await renderScreen(<LoanDetailScreen state={{ status: 'loaded', loan, history: { status: 'refresh-error', repayments: mapRepayments({ repayments: [repaymentFixture] }) } }} onBack={jest.fn()} onRefresh={jest.fn()} />)
    expect(stale.getByRole('alert', { name: /previously loaded repayment history/ })).toBeOnTheScreen()
  })

  it('does not offer a dead retry for an invalid route id', async () => {
    const view = await renderScreen(<LoanDetailScreen state={{ status: 'invalid-id' }} onBack={jest.fn()} onRefresh={jest.fn()} />)
    expect(view.queryByRole('button', { name: 'Retry' })).not.toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Back to loans' })).toBeOnTheScreen()
  })
})
