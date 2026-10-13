import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { LoanCreateScreen, type LoanCreateScreenProps } from './loan-create-screen'

const currencies = [{ currencyKey: 1, code: 'EUR', description: 'Euro' }, { currencyKey: 2, code: 'USD', description: 'US Dollar' }]

const renderScreen = async (overrides: Partial<LoanCreateScreenProps> = {}) => {
  const i18n = await initMobileI18n('en')
  const props: LoanCreateScreenProps = { currencies, loading: false, metadataError: false, pending: false, outcome: null, onBack: jest.fn(), onCreate: jest.fn().mockResolvedValue(undefined), ...overrides }
  return { props, view: await render(<I18nextProvider i18n={i18n}><LoanCreateScreen {...props} /></I18nextProvider>) }
}

async function fillRequiredFields(view: Awaited<ReturnType<typeof renderScreen>>['view']) {
  await fireEvent.changeText(view.getByLabelText('Name'), 'Home loan')
  await fireEvent.press(view.getByRole('radio', { name: 'Mortgage' }))
  await fireEvent.press(view.getByRole('radio', { name: 'EUR · Euro' }))
  await fireEvent.changeText(view.getByLabelText('Opening principal balance'), '250000')
  await fireEvent.changeText(view.getByLabelText('Start date'), '2026-01-01')
}

describe('LoanCreateScreen', () => {
  it('submits the full required payload once every required field is filled', async () => {
    const onCreate = jest.fn().mockResolvedValue(undefined)
    const { view } = await renderScreen({ onCreate })
    await fillRequiredFields(view)
    await fireEvent.press(view.getByRole('button', { name: 'Add loan' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({
      name: 'Home loan',
      type: 'MORTGAGE',
      currencyKey: 1,
      openingPrincipalBalance: 250_000,
      openingBalanceDate: '2026-01-01',
      includeInNetWorth: true,
    }))
  })

  it('includes trimmed optional fields only when filled', async () => {
    const onCreate = jest.fn().mockResolvedValue(undefined)
    const { view } = await renderScreen({ onCreate })
    await fillRequiredFields(view)
    await fireEvent.changeText(view.getByLabelText('Provider (optional)'), 'Wonder Bank')
    await fireEvent.changeText(view.getByLabelText('Monthly installment (optional)'), '1200')
    await fireEvent.changeText(view.getByLabelText('Annual interest rate, % (optional)'), '4.5')
    await fireEvent.changeText(view.getByLabelText('Term, months (optional)'), '360')
    await fireEvent.changeText(view.getByLabelText('Notes (optional)'), 'Fixed rate')
    await fireEvent.press(view.getByRole('button', { name: 'Add loan' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      providerName: 'Wonder Bank', regularPaymentAmount: 1200, annualInterestRateBps: 450, termMonths: 360, notes: 'Fixed rate',
    })))
  })

  it('shows a per-field error under each missing required field and never calls onCreate', async () => {
    const onCreate = jest.fn()
    const { view } = await renderScreen({ onCreate })
    // Start date defaults to today, so it's the one required field that's
    // already valid on a fresh, untouched form — everything else is empty.
    await fireEvent.press(view.getByRole('button', { name: 'Add loan' }))
    expect(await view.findByText('Enter a name for this loan.')).toBeOnTheScreen()
    expect(view.getByText('Choose a loan type.')).toBeOnTheScreen()
    expect(view.getByText('Choose a currency.')).toBeOnTheScreen()
    expect(view.getByText('Enter a starting balance greater than 0.')).toBeOnTheScreen()
    expect(view.queryByText('Enter a valid start date (YYYY-MM-DD).')).not.toBeOnTheScreen()
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('shows the start-date error once it is cleared', async () => {
    const onCreate = jest.fn()
    const { view } = await renderScreen({ onCreate })
    await fillRequiredFields(view)
    await fireEvent.changeText(view.getByLabelText('Start date'), '')
    await fireEvent.press(view.getByRole('button', { name: 'Add loan' }))
    expect(await view.findByText('Enter a valid start date (YYYY-MM-DD).')).toBeOnTheScreen()
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('lets the net worth switch be toggled off before submitting', async () => {
    const onCreate = jest.fn().mockResolvedValue(undefined)
    const { view } = await renderScreen({ onCreate })
    await fillRequiredFields(view)
    await fireEvent(view.getByRole('switch'), 'valueChange', false)
    await fireEvent.press(view.getByRole('button', { name: 'Add loan' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ includeInNetWorth: false })))
  })

  it('surfaces a server-side outcome as a distinct alert', async () => {
    const { view } = await renderScreen({ outcome: 'invalid' })
    expect(view.getByRole('alert')).toHaveTextContent(/rejected these values/i)
  })

  it('shows loading and metadata-error states before the currencies list resolves', async () => {
    const loading = await renderScreen({ loading: true })
    expect(loading.view.getByRole('progressbar')).toBeOnTheScreen()
    const failed = await renderScreen({ loading: false, metadataError: true })
    expect(failed.view.getByRole('alert')).toHaveTextContent(/Could not load currencies/i)
  })

  it('locks every field and the submit action while pending', async () => {
    const { view } = await renderScreen({ pending: true })
    expect(view.getByLabelText('Name').props.editable).toBe(false)
    expect(view.getByRole('button', { name: 'Saving…' }).props.accessibilityState.disabled).toBe(true)
  })

  it.each(['pt-PT', 'es'])('renders translated, labelled controls in %s', async (language) => {
    const i18n = await initMobileI18n(language)
    const props: LoanCreateScreenProps = { currencies, loading: false, metadataError: false, pending: false, outcome: null, onBack: jest.fn(), onCreate: jest.fn() }
    const view = await render(<I18nextProvider i18n={i18n}><LoanCreateScreen {...props} /></I18nextProvider>)
    expect(view.getAllByRole('button').length).toBeGreaterThanOrEqual(2)
    expect(view.getByRole('switch')).toBeOnTheScreen()
  })
})
