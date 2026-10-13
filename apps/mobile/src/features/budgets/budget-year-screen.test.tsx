import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { BudgetYearScreen, type BudgetYearViewState } from './budget-year-screen'
import { mapBudgetYear } from './budgets-view-model'
import { budgetYearFixture } from './test-fixtures'

const full = mapBudgetYear(budgetYearFixture)
const toDate = mapBudgetYear({ ...budgetYearFixture, categories: [
  { ...budgetYearFixture.categories[0], category_amount: 600 },
  { ...budgetYearFixture.categories[1], category_amount: 600, category_budgeted_amount: 600 },
] })

const renderScreen = async (state: BudgetYearViewState) => {
  const i18n = await initMobileI18n('en')
  const onRetry = jest.fn()
  const onBack = jest.fn()
  const view = await render(<I18nextProvider i18n={i18n}><BudgetYearScreen state={state} onBack={onBack} onRetry={onRetry} /></I18nextProvider>)
  return { view, onRetry, onBack }
}

describe('BudgetYearScreen', () => {
  it('shows income, expenses, and yearly result stats derived from the full-year totals', async () => {
    const { view } = await renderScreen({ status: 'loaded', year: full, toDate })
    expect(view.getByLabelText(/Total income planned, .*24,000\.00/)).toBeOnTheScreen()
    expect(view.getByLabelText(/Total expenses planned, .*1,200\.00/)).toBeOnTheScreen()
    expect(view.getByLabelText(/Yearly result planned, .*22,800\.00/)).toBeOnTheScreen()
  })

  it('shows a distinct year-to-date row alongside the full-year row', async () => {
    const { view } = await renderScreen({ status: 'loaded', year: full, toDate })
    expect(view.getByText('Year to date')).toBeOnTheScreen()
    expect(view.getByText('Full year')).toBeOnTheScreen()
  })

  it('expands a category to show its children on request', async () => {
    const { view } = await renderScreen({ status: 'loaded', year: full, toDate })
    expect(view.queryByText('Rent')).not.toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Show subcategories for Home' }))
    expect(view.getByText('Rent')).toBeOnTheScreen()
  })

  it('shows a stale banner after a refresh failure while keeping data visible', async () => {
    const { view } = await renderScreen({ status: 'refresh-error', year: full, toDate })
    expect(view.getByRole('alert')).toHaveTextContent(/previously loaded year/i)
    expect(view.getByText('Year to date')).toBeOnTheScreen()
  })

  it('never renders anything during an access transition', async () => {
    const { view } = await renderScreen({ status: 'access-transition' })
    expect(view.toJSON()).toBeNull()
  })

  it.each(['loading', 'error', 'invalid-response', 'not-found', 'invalid-route'] as const)('handles the %s state', async (status) => {
    const { view } = await renderScreen({ status })
    expect(view.toJSON()).not.toBeNull()
  })

  it('does not offer a dead retry for an invalid route', async () => {
    const { view } = await renderScreen({ status: 'invalid-route' })
    expect(view.queryByRole('button', { name: 'Retry' })).not.toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Back to budget' })).toBeOnTheScreen()
  })

  it('explains an empty category list without inventing categories', async () => {
    const empty = mapBudgetYear({ ...budgetYearFixture, categories: [] })
    const { view } = await renderScreen({ status: 'loaded', year: empty, toDate: empty })
    expect(view.getByText('No categories are available for this year')).toBeOnTheScreen()
  })
})
