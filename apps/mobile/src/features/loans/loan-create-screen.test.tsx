import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { LoanCreateScreen, type LoanCreateScreenProps } from './loan-create-screen'

const currencies = [{ currencyKey: 1, code: 'EUR', description: 'Euro' }, { currencyKey: 2, code: 'USD', description: 'US Dollar' }]

const renderScreen = async (overrides: Partial<LoanCreateScreenProps> = {}, language = 'en') => {
  const i18n = await initMobileI18n(language)
  const props: LoanCreateScreenProps = { currencies, loading: false, metadataError: false, pending: false, outcome: null, onBack: jest.fn(), onCreate: jest.fn().mockResolvedValue(undefined), ...overrides }
  return { props, view: await render(<I18nextProvider i18n={i18n}><LoanCreateScreen {...props} /></I18nextProvider>) }
}

/** Opens a select row's sheet and picks one option. */
const choose = async (view: Awaited<ReturnType<typeof renderScreen>>['view'], field: string, option: string) => {
  await fireEvent.press(view.getByRole('button', { name: new RegExp(`^${field},`) }))
  await fireEvent.press(view.getByRole('radio', { name: option }))
}

async function fillRequiredFields(view: Awaited<ReturnType<typeof renderScreen>>['view']) {
  await fireEvent.changeText(view.getByLabelText('Name'), 'Home loan')
  await choose(view, 'Loan type', 'Mortgage')
  await choose(view, 'Currency', 'EUR · Euro')
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

  it('secures the new loan against a chosen asset, and leaves the field out for None', async () => {
    const onCreate = jest.fn().mockResolvedValue(undefined)
    const { view } = await renderScreen({ onCreate, securedAssets: [{ key: 9, name: 'Family home' }, { key: 2, name: 'Car' }] })
    await fillRequiredFields(view)
    expect(view.getByRole('button', { name: 'Secured against, None' })).toBeOnTheScreen()
    await choose(view, 'Secured against', 'Family home')
    await fireEvent.press(view.getByRole('button', { name: 'Add loan' }))
    await waitFor(() => expect(onCreate).toHaveBeenLastCalledWith(expect.objectContaining({ securedAssetKey: 9 })))
    await choose(view, 'Secured against', 'None')
    await fireEvent.press(view.getByRole('button', { name: 'Add loan' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(2))
    expect(onCreate.mock.calls[1][0]).not.toHaveProperty('securedAssetKey')
  })

  it('leaves Secured against out when the household has no asset to offer', async () => {
    const { view } = await renderScreen()
    expect(view.queryByRole('button', { name: /^Secured against,/ })).not.toBeOnTheScreen()
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

  it('keeps Add loan disabled until every required field is valid, without flagging empty fields', async () => {
    const onCreate = jest.fn()
    const { view } = await renderScreen({ onCreate })
    expect(view.getByRole('button', { name: 'Add loan' })).toBeDisabled()
    expect(view.queryByText('Enter a name for this loan.')).not.toBeOnTheScreen()
    expect(view.queryByText('Choose a loan type.')).not.toBeOnTheScreen()
    await fillRequiredFields(view)
    expect(view.getByRole('button', { name: 'Add loan' })).toBeEnabled()
    await fireEvent.changeText(view.getByLabelText('Start date'), '')
    expect(view.getByRole('button', { name: 'Add loan' })).toBeDisabled()
    await fireEvent.press(view.getByRole('button', { name: 'Add loan' }))
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('shows an error under a row whose value is entered and wrong', async () => {
    const { view } = await renderScreen()
    await fillRequiredFields(view)
    await fireEvent.changeText(view.getByLabelText('Start date'), '2026-13-40')
    expect(view.getByText('Enter a valid start date (YYYY-MM-DD).')).toBeOnTheScreen()
    await fireEvent.changeText(view.getByLabelText('Term, months (optional)'), '1.5')
    expect(view.getByText('Enter a whole number of months greater than 0.')).toBeOnTheScreen()
    await fireEvent.changeText(view.getByLabelText('Annual interest rate, % (optional)'), '120')
    expect(view.getByText('Enter a rate from 0 to 100.')).toBeOnTheScreen()
    await fireEvent.changeText(view.getByLabelText('Opening principal balance'), '0')
    expect(view.getByText('Enter a starting balance greater than 0.')).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Add loan' })).toBeDisabled()
  })

  it('accepts a comma as the decimal point in the principal', async () => {
    const onCreate = jest.fn().mockResolvedValue(undefined)
    const { view } = await renderScreen({ onCreate })
    await fillRequiredFields(view)
    await fireEvent.changeText(view.getByLabelText('Opening principal balance'), '1500,50')
    await fireEvent.press(view.getByRole('button', { name: 'Add loan' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ openingPrincipalBalance: 1500.5 })))
  })

  it.each([
    ['pt-PT', '1.234,56', 1234.56],
    ['es', '1.000', 1000],
    ['en', '1.000', 1],
    ['en', '1,000', 1000],
  ])('reads the principal in %s: %s is %s', async (language, typed, expected) => {
    const onCreate = jest.fn().mockResolvedValue(undefined)
    const i18n = await initMobileI18n(language)
    const { view } = await renderScreen({ onCreate }, language)
    await fireEvent.changeText(view.getByLabelText(i18n.t('loanCreate.name')), 'Home loan')
    await fireEvent.press(view.getByRole('button', { name: new RegExp(`^${i18n.t('loanCreate.type')},`) }))
    await fireEvent.press(view.getByRole('radio', { name: i18n.t('loans.type.MORTGAGE') }))
    await fireEvent.press(view.getByRole('button', { name: new RegExp(`^${i18n.t('loanCreate.currency')},`) }))
    await fireEvent.press(view.getByRole('radio', { name: 'EUR · Euro' }))
    await fireEvent.changeText(view.getByLabelText(i18n.t('loanCreate.startDate')), '2026-01-01')
    await fireEvent.changeText(view.getByLabelText(i18n.t('loanCreate.principal')), typed)
    await fireEvent.press(view.getByRole('button', { name: i18n.t('loanCreate.save') }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ openingPrincipalBalance: expected })))
  })

  it('shows an error instead of saving a principal it cannot read', async () => {
    const onCreate = jest.fn()
    const { view } = await renderScreen({ onCreate })
    await fillRequiredFields(view)
    await fireEvent.changeText(view.getByLabelText('Opening principal balance'), '1.2.3')
    expect(view.getByText('Enter a starting balance greater than 0.')).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Add loan' })).toBeDisabled()
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('closes through the form bar', async () => {
    const onBack = jest.fn()
    const { view } = await renderScreen({ onBack })
    await fireEvent.press(view.getByRole('button', { name: 'Close' }))
    expect(onBack).toHaveBeenCalledTimes(1)
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
    expect(view.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(view.getByRole('button', { name: 'Close' })).toBeDisabled()
  })

  it.each(['pt-PT', 'es'])('renders translated, labelled controls in %s', async (language) => {
    const i18n = await initMobileI18n(language)
    const props: LoanCreateScreenProps = { currencies, loading: false, metadataError: false, pending: false, outcome: null, onBack: jest.fn(), onCreate: jest.fn() }
    const view = await render(<I18nextProvider i18n={i18n}><LoanCreateScreen {...props} /></I18nextProvider>)
    expect(view.getAllByRole('button').length).toBeGreaterThanOrEqual(2)
    expect(view.getByRole('switch')).toBeOnTheScreen()
  })
})
