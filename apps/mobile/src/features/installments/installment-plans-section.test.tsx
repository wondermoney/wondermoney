import { fireEvent, render, within } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { formatCurrency } from '@/lib/formatters/financial'
import { initMobileI18n } from '@/lib/i18n'

import { InstallmentPlansSection, type InstallmentPlansSectionProps, type InstallmentPlansSectionState } from './installment-plans-section'
import { commitmentFixture, planDetailFixture, suggestionFixture } from './test-fixtures'

const { installments: _rows, ...plan } = planDetailFixture
const loaded: InstallmentPlansSectionState = {
  commitment: { status: 'loaded', data: commitmentFixture },
  plans: { status: 'loaded', data: [plan] },
  suggestions: { status: 'loaded', data: [suggestionFixture] },
}

async function renderSection(state: InstallmentPlansSectionState = loaded, props: Partial<InstallmentPlansSectionProps> = {}) {
  const i18n = await initMobileI18n('en')
  const handlers = { onOpenPlan: jest.fn(), onCreatePlan: jest.fn(), onAcceptSuggestion: jest.fn() }
  const view = await render(<I18nextProvider i18n={i18n}><InstallmentPlansSection locale="en" state={state} {...handlers} {...props} /></I18nextProvider>)
  return { view, ...handlers }
}

const euro = (value: number) => formatCurrency(value, { locale: 'en', currency: 'EUR' })

describe('InstallmentPlansSection', () => {
  it('shows what the card’s plans still have to charge, and the next installment', async () => {
    const { view } = await renderSection()
    expect(view.getByRole('header', { name: 'Installments' })).toBeOnTheScreen()
    expect(view.getByLabelText(`Still to charge, ${euro(75)}, 3 installments to come · 2 active plans, Next: ${euro(25)} on Dec 5, 2026, Laptop 4/4`)).toBeOnTheScreen()
  })

  it('lists the plans, each opening its schedule', async () => {
    const { view, onOpenPlan } = await renderSection()
    const row = view.getByRole('button', { name: `Laptop, Remaining ${euro(25)}, 2 of 4 paid, Next on Dec 5, 2026` })
    await fireEvent.press(row)
    expect(onOpenPlan).toHaveBeenCalledWith(11)
  })

  it('offers each detected suggestion, accepted only when asked', async () => {
    const { view, onAcceptSuggestion, onCreatePlan } = await renderSection()
    const suggestions = within(view.getByTestId('installment-suggestions'))
    expect(suggestions.getByText('Phone shop')).toBeOnTheScreen()
    expect(suggestions.getByText(`6 installments of ${euro(50)}`)).toBeOnTheScreen()
    expect(suggestions.getByText('2 found · purchased Sep 15, 2026')).toBeOnTheScreen()
    expect(onAcceptSuggestion).not.toHaveBeenCalled()
    await fireEvent.press(view.getByRole('button', { name: 'Create plan for Phone shop' }))
    expect(onAcceptSuggestion).toHaveBeenCalledWith('7:phone:6')
    await fireEvent.press(view.getByRole('button', { name: 'Add plan' }))
    expect(onCreatePlan).toHaveBeenCalledTimes(1)
  })

  it('marks a plan with nothing left as paid off and shows no commitment for a card with none', async () => {
    const done = { ...plan, paidCount: 4, paidAmount: 100, remainingCount: 0, remainingAmount: 0, unmatchedCount: 0, nextInstallment: null }
    const { view } = await renderSection({ commitment: { status: 'loaded', data: null }, plans: { status: 'loaded', data: [done] }, suggestions: { status: 'loaded', data: [] } })
    expect(view.getByText('Paid off')).toBeOnTheScreen()
    expect(view.queryByTestId('installment-commitment')).not.toBeOnTheScreen()
    expect(view.queryByTestId('installment-suggestions')).not.toBeOnTheScreen()
  })

  it('says when the card has no plan, and when a part fails to load', async () => {
    const empty = await renderSection({ commitment: { status: 'loaded', data: null }, plans: { status: 'loaded', data: [] }, suggestions: { status: 'loaded', data: [] } })
    expect(empty.view.getByText('No installment plans on this card yet.')).toBeOnTheScreen()
    const failed = await renderSection({ commitment: { status: 'error' }, plans: { status: 'error' }, suggestions: { status: 'error' } })
    expect(failed.view.getByText('Could not load what the installments still have to charge.')).toBeOnTheScreen()
    expect(failed.view.getByText('Could not load the installment plans.')).toBeOnTheScreen()
  })
})
