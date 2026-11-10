import { render, within } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { LoanDetailScreen } from './loan-detail-screen'
import { loansResponseSchema } from './loans-contract'
import { LoansScreen } from './loans-screen'
import { mapLoan, mapLoans, mapRepayments } from './loans-view-model'
import { loanFixture, repaymentFixture } from './test-fixtures'

const renderScreen = async (node: React.ReactElement) => {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>)
}

describe('loan screens', () => {
  it('leads the list with web\'s four totals from the overview, and shows none without it', async () => {
    const loans = mapLoans({ loans: [loanFixture] })
    const overview = { currency: 'EUR', interestFeesThisMonth: 0, monthlyRepaymentTotal: 742.18, netWorthImpact: -168_382.33, repaymentsNeedingReviewCount: 0, totalOutstandingDebt: 168_382.33 }
    const view = await renderScreen(<LoansScreen state={{ status: 'loaded', loans }} overview={overview} onOpenLoan={jest.fn()} onRefresh={jest.fn()} onCreateLoan={jest.fn()} />)
    expect(view.getByRole('header', { name: 'Loans' })).toBeOnTheScreen()
    expect(view.getByText('Track loans, repayment plans, and balances in one place.')).toBeOnTheScreen()
    const summary = view.getByTestId('loans-summary')
    // Outstanding debt is the one headline; the month's figures follow as columns.
    expect(within(summary).getAllByText(/^(Outstanding debt|Monthly repayments|Interest & fees|Net worth impact)$/).map((node) => node.props.children)).toEqual(['Outstanding debt', 'Monthly repayments', 'Interest & fees', 'Net worth impact'])
    expect(within(summary).queryByText('Need review')).not.toBeOnTheScreen()
    view.unmount()
    const without = await renderScreen(<LoansScreen state={{ status: 'loaded', loans }} onOpenLoan={jest.fn()} onRefresh={jest.fn()} onCreateLoan={jest.fn()} />)
    expect(without.queryByTestId('loans-summary')).not.toBeOnTheScreen()
  })

  it('shows each loan\'s type and provider, progress, next payment and rate', async () => {
    const view = await renderScreen(<LoansScreen state={{ status: 'loaded', loans: mapLoans({ loans: [loanFixture] }) }} onOpenLoan={jest.fn()} onRefresh={jest.fn()} onCreateLoan={jest.fn()} />)
    expect(view.getByText('Mortgage, Example lender')).toBeOnTheScreen()
    expect(view.getByText('18% repaid')).toBeOnTheScreen()
    expect(view.getByText(/Next payment Aug 5, 2026 · Rate 4\.25%/)).toBeOnTheScreen()
  })

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
    expect(empty.getByText('No loans yet')).toBeOnTheScreen()
    expect(empty.getByRole('button', { name: 'Add loan' })).toBeOnTheScreen()
    // Matches web's data-forward preview: an empty list still shows an example loan.
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

  it('shows the contract term and says when the payment no longer clears the loan by maturity', async () => {
    const loan = mapLoan({ ...loanFixture, maturityDate: '2052-01-01T00:00:00.000Z', remainingTermMonthsEstimated: 382, termMonths: 360 }, new Date('2026-11-05T10:00:00.000Z'))
    const view = await renderScreen(<LoanDetailScreen state={{ status: 'loaded', loan, history: { status: 'loaded', repayments: [] } }} onBack={jest.fn()} onRefresh={jest.fn()} />)
    expect(view.getByText('Remaining term')).toBeOnTheScreen()
    expect(view.getByText('302 months')).toBeOnTheScreen()
    expect(view.queryByText('382 months')).not.toBeOnTheScreen()
    expect(view.getByTestId('loan-payoff-beyond-contract')).toHaveTextContent(/382 months/)
  })

  it('does not offer a dead retry for an invalid route id', async () => {
    const view = await renderScreen(<LoanDetailScreen state={{ status: 'invalid-id' }} onBack={jest.fn()} onRefresh={jest.fn()} />)
    expect(view.queryByRole('button', { name: 'Retry' })).not.toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Back to loans' })).toBeOnTheScreen()
  })
})

describe('loan screens with values this build does not know', () => {
  it('renders a loan whose type, status and frequency are new to this build', async () => {
    const response = loansResponseSchema.parse({ loans: [{ ...loanFixture, type: 'CREDIT_LINE', status: 'IN_ARREARS', paymentFrequency: 'WEEKLY', regularPaymentAmount: 100, extra: true }] })
    const view = await renderScreen(<LoansScreen state={{ status: 'loaded', loans: mapLoans(response) }} onOpenLoan={jest.fn()} onRefresh={jest.fn()} onBack={jest.fn()} onCreateLoan={jest.fn()} />)
    expect(view.getByText('Other, Example lender')).toBeOnTheScreen()
    expect(view.getByText('Status unavailable')).toBeOnTheScreen()
    expect(view.getByText(/on an unknown schedule/)).toBeOnTheScreen()
  })
})
