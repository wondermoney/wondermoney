import { fireEvent, render, within } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { formatCurrency } from '@/lib/formatters/financial'
import { initMobileI18n } from '@/lib/i18n'

import { InstallmentPlanCreateScreen, type InstallmentPlanCreateScreenProps } from './installment-plan-create-screen'
import { suggestionLinks } from './installments-contract'
import { suggestionFixture } from './test-fixtures'

jest.mock('@/components/ui/date-field', () => ({
  ...jest.requireActual('@/components/ui/date-field'),
  DateField: jest.requireActual('@/features/transactions/test-date-field').DateField,
}))

async function renderScreen(props: Partial<InstallmentPlanCreateScreenProps> = {}, language = 'en') {
  const i18n = await initMobileI18n(language)
  const onSubmit = jest.fn()
  const view = await render(
    <I18nextProvider i18n={i18n}>
      <InstallmentPlanCreateScreen accountId={7} currency="EUR" failure={null} onClose={jest.fn()} onSubmit={onSubmit} pending={false} {...props} />
    </I18nextProvider>,
  )
  return { view, onSubmit }
}

const euro = (value: number) => formatCurrency(value, { locale: 'en', currency: 'EUR' })

describe('InstallmentPlanCreateScreen', () => {
  it('previews the API’s split, which adds up to the total exactly, and creates the plan', async () => {
    const { view, onSubmit } = await renderScreen()
    const save = view.getByRole('button', { name: 'Create plan' })
    expect(save).toBeDisabled()
    await fireEvent.changeText(view.getByLabelText('Total'), '100')
    await fireEvent.changeText(view.getByLabelText('Description'), '  Laptop ')
    await fireEvent.changeText(view.getByLabelText('Purchase date'), '2026-09-01')
    await fireEvent.changeText(view.getByLabelText('Installments'), '3')
    const preview = within(view.getByTestId('installment-plan-preview'))
    expect(preview.getByText('Installments 1 to 2 of 3')).toBeOnTheScreen()
    expect(within(view.getByTestId('installment-plan-preview-run')).getByLabelText(euro(33.33))).toBeOnTheScreen()
    expect(preview.getByText('Installment 3 of 3')).toBeOnTheScreen()
    expect(within(view.getByTestId('installment-plan-preview-last')).getByLabelText(euro(33.34))).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Create plan' }))
    expect(onSubmit).toHaveBeenCalledWith({ accountKey: 7, description: 'Laptop', purchaseDate: '2026-09-01', totalAmount: 100, installmentCount: 3 })
  })

  it('shows one preview row when every installment is the same', async () => {
    const { view } = await renderScreen()
    await fireEvent.changeText(view.getByLabelText('Total'), '1200')
    await fireEvent.changeText(view.getByLabelText('Installments'), '12')
    expect(view.getByText('Installments 1 to 12 of 12')).toBeOnTheScreen()
    expect(view.queryByTestId('installment-plan-preview-last')).not.toBeOnTheScreen()
  })

  it('reads the total in the app’s language', async () => {
    const { view, onSubmit } = await renderScreen({}, 'pt-PT')
    await fireEvent.changeText(view.getByLabelText('Total'), '1.234,56')
    await fireEvent.changeText(view.getByLabelText('Descrição'), 'Sofá')
    await fireEvent.changeText(view.getByLabelText('Prestações'), '2')
    await fireEvent.press(view.getByRole('button', { name: 'Criar plano' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ totalAmount: 1234.56, installmentCount: 2 }))
  })

  it('refuses a count outside 2–120 or a total with fractions of a cent', async () => {
    const { view } = await renderScreen()
    await fireEvent.changeText(view.getByLabelText('Description'), 'Laptop')
    await fireEvent.changeText(view.getByLabelText('Total'), '10.005')
    expect(view.getByText('Enter an amount above zero with at most two decimals.')).toBeOnTheScreen()
    await fireEvent.changeText(view.getByLabelText('Total'), '10')
    await fireEvent.changeText(view.getByLabelText('Installments'), '1')
    expect(view.getByText('Enter a number from 2 to 120.')).toBeOnTheScreen()
    expect(view.queryByTestId('installment-plan-preview')).not.toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Create plan' })).toBeDisabled()
    await fireEvent.changeText(view.getByLabelText('Installments'), '121')
    expect(view.getByRole('button', { name: 'Create plan' })).toBeDisabled()
  })

  it('opens filled from a suggestion and sends its links with the plan', async () => {
    const draft = { ...suggestionFixture, links: suggestionLinks(suggestionFixture) }
    const { view, onSubmit } = await renderScreen({ draft })
    expect(view.getByRole('header', { name: 'Plan from detected installments' })).toBeOnTheScreen()
    expect(view.getByText('Creating the plan links 2 posted transactions to their installments.')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Create plan' }))
    expect(onSubmit).toHaveBeenCalledWith({
      accountKey: 7,
      description: 'Phone shop',
      purchaseDate: '2026-09-15',
      totalAmount: 300,
      installmentCount: 6,
      links: [{ transactionKey: 901, installmentNumber: 1 }, { transactionKey: 902, installmentNumber: 2 }],
    })
  })

  it('keeps a suggestion’s linked installments inside the schedule', async () => {
    const draft = { ...suggestionFixture, links: [{ transactionKey: 905, installmentNumber: 5 }] }
    const { view } = await renderScreen({ draft })
    await fireEvent.changeText(view.getByLabelText('Installments'), '4')
    expect(view.getByText('A detected transaction is installment 5, so the plan needs at least that many.')).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Create plan' })).toBeDisabled()
  })

  it('says why creating failed and when a suggestion is gone', async () => {
    const { view } = await renderScreen({ failure: 'conflict', suggestionUnavailable: true })
    expect(view.getByTestId('installment-plan-create-failure')).toHaveTextContent('One of these transactions is already linked to another installment.')
    expect(view.getByTestId('installment-suggestion-unavailable')).toHaveTextContent(/no longer available/)
  })
})
