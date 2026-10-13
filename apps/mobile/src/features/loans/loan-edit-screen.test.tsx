import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { Alert } from 'react-native'

import { ApiError } from '@/lib/api/errors'
import { initMobileI18n } from '@/lib/i18n'

import { createLoanMetadataChanges, LoanEditScreen, type LoanEditModel } from './loan-edit-screen'

const model: LoanEditModel = {
  id: 7,
  name: 'Home loan',
  providerName: null,
  notes: 'Original note',
  includeInNetWorth: true,
  type: 'MORTGAGE',
  openingPrincipalBalance: 250_000,
  openingBalanceDate: '2026-01-01',
  regularPaymentAmount: 1200,
  annualInterestRateBps: 450,   // 4.5%, stored as basis points
  termMonths: 360,
}
const currentFromModel = { name: model.name, providerName: model.providerName ?? '', notes: model.notes ?? '', type: model.type, openingPrincipalBalance: String(model.openingPrincipalBalance), openingBalanceDate: model.openingBalanceDate, regularPaymentAmount: String(model.regularPaymentAmount), annualInterestRateBps: model.annualInterestRateBps === null ? '' : String(model.annualInterestRateBps / 100), termMonths: String(model.termMonths) }

const renderEditor = async (overrides: Partial<React.ComponentProps<typeof LoanEditScreen>> = {}, language = 'en') => {
  const i18n = await initMobileI18n(language)
  const props: React.ComponentProps<typeof LoanEditScreen> = { state: { status: 'loaded', model }, onBack: jest.fn(), onRetry: jest.fn(), onSaveLoan: jest.fn().mockResolvedValue(undefined), onRefreshAuthoritative: jest.fn().mockResolvedValue(model), pending: false, refreshRequired: false, ...overrides }
  return { props, view: await render(<I18nextProvider i18n={i18n}><LoanEditScreen {...props} /></I18nextProvider>) }
}

describe('loan metadata editor', () => {
  afterEach(() => jest.restoreAllMocks())

  it('preserves nullable originals and builds only semantically dirty keys', () => {
    expect(createLoanMetadataChanges(model, currentFromModel)).toBeNull()
    expect(createLoanMetadataChanges(model, { ...currentFromModel, name: 'Renamed', notes: '' })).toEqual({ name: 'Renamed', notes: '' })
  })

  it('widens the diff to financial terms, coercing numeric strings and ignoring blanked optionals', () => {
    expect(createLoanMetadataChanges(model, { ...currentFromModel, type: 'PERSONAL_LOAN', openingPrincipalBalance: '300000', openingBalanceDate: '2026-02-01', regularPaymentAmount: '1500', annualInterestRateBps: '5', termMonths: '240' }))
      .toEqual({ type: 'PERSONAL_LOAN', openingPrincipalBalance: 300_000, openingBalanceDate: '2026-02-01', regularPaymentAmount: 1500, annualInterestRateBps: 500, termMonths: 240 })
    expect(createLoanMetadataChanges(model, { ...currentFromModel, regularPaymentAmount: '', annualInterestRateBps: '', termMonths: '' })).toBeNull()
  })

  it('renders the widened financial fields pre-filled and saves an edited principal alongside the loan type', async () => {
    const save = jest.fn().mockResolvedValue(undefined)
    const { view } = await renderEditor({ onSaveLoan: save })
    expect(view.getByLabelText('Loan type')).toBeOnTheScreen()
    expect(view.getByRole('radio', { name: 'Mortgage' }).props.accessibilityState.checked).toBe(true)
    expect(view.getByLabelText('Opening principal balance').props.value).toBe('250000')
    expect(view.getByLabelText('Start date').props.value).toBe('2026-01-01')
    expect(view.getByLabelText('Monthly installment (optional)').props.value).toBe('1200')
    expect(view.getByLabelText('Annual interest rate, % (optional)').props.value).toBe('4.5')
    expect(view.getByLabelText('Term, months (optional)').props.value).toBe('360')
    await fireEvent.changeText(view.getByLabelText('Opening principal balance'), '260000')
    await fireEvent.press(view.getByRole('radio', { name: 'Personal loan' }))
    await fireEvent.press(view.getByRole('button', { name: 'Save details' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ type: 'PERSONAL_LOAN', openingPrincipalBalance: 260_000 }))
  })

  it('uses exact limits, submits a sparse empty-string clear, and clears dirty only after success', async () => {
    const save = jest.fn().mockResolvedValue(undefined)
    const { view } = await renderEditor({ onSaveLoan: save })
    expect(view.getByLabelText('Name').props.maxLength).toBe(255)
    expect(view.getByLabelText('Provider').props.maxLength).toBe(255)
    expect(view.getByLabelText('Notes').props.maxLength).toBe(10_000)
    await fireEvent.changeText(view.getByLabelText('Notes'), '')
    await fireEvent.press(view.getByRole('button', { name: 'Save details' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ notes: '' }))
    await waitFor(() => expect(view.getByRole('button', { name: 'Save details' }).props.accessibilityState.disabled).toBe(true))
  })

  it('rejects an empty required name before transport', async () => {
    const save = jest.fn()
    const { view } = await renderEditor({ onSaveLoan: save })
    await fireEvent.changeText(view.getByLabelText('Name'), '')
    await fireEvent.press(view.getByRole('button', { name: 'Save details' }))
    expect(await view.findByRole('alert')).toHaveTextContent(/enter a name/i)
    expect(save).not.toHaveBeenCalled()
  })

  it('retains all input and explains an ambiguous failure without a retry', async () => {
    const save = jest.fn().mockRejectedValue(new ApiError('network'))
    const { view } = await renderEditor({ onSaveLoan: save })
    await fireEvent.changeText(view.getByLabelText('Provider'), 'New provider')
    await fireEvent.press(view.getByRole('button', { name: 'Save details' }))
    expect(await view.findByRole('alert')).toHaveTextContent(/result is unknown.*not retry automatically/i)
    expect(view.getByLabelText('Provider').props.value).toBe('New provider')
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('freezes the confirmed inclusion target and writes only its explicit boolean', async () => {
    const save = jest.fn().mockResolvedValue(undefined)
    const { view } = await renderEditor({ onSaveLoan: save })
    const control = view.getByRole('switch', { name: 'Include this liability in estimated net worth' })
    await fireEvent(control, 'valueChange', false)
    expect(view.getByText(/exclude this liability.*not the debt itself/i)).toBeOnTheScreen()
    await fireEvent(control, 'valueChange', true)
    await fireEvent.press(view.getByRole('button', { name: 'Confirm change' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ includeInNetWorth: false }))
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('keeps stale cached inclusion read-only and rebases it only from authoritative refresh', async () => {
    const fresh = { ...model, includeInNetWorth: false }
    const refresh = jest.fn().mockResolvedValue(fresh)
    const save = jest.fn()
    const rendered = await renderEditor({ state: { status: 'refresh-error', model }, onRefreshAuthoritative: refresh, onSaveLoan: save })
    const control = rendered.view.getByRole('switch', { name: 'Include this liability in estimated net worth' })
    expect(control.props.value).toBe(true)
    expect(control.props.disabled).toBe(true)
    expect(rendered.view.getByRole('button', { name: 'Refresh loan data' })).toBeOnTheScreen()
    await fireEvent(control, 'valueChange', false)
    expect(rendered.view.queryByRole('button', { name: 'Confirm change' })).toBeNull()
    expect(save).not.toHaveBeenCalled()

    await fireEvent.press(rendered.view.getByRole('button', { name: 'Refresh loan data' }))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(rendered.view.getByRole('switch').props.value).toBe(false)
    await rendered.view.rerender(<I18nextProvider i18n={await initMobileI18n('en')}><LoanEditScreen {...rendered.props} state={{ status: 'loaded', model: fresh }} /></I18nextProvider>)
    expect(rendered.view.getByRole('switch').props.disabled).toBe(false)
    expect(rendered.view.getByRole('switch').props.value).toBe(false)
  })

  it('preserves the intended target and gates every write until authoritative refresh after ambiguity', async () => {
    const save = jest.fn().mockRejectedValue(new ApiError('network'))
    const refresh = jest.fn().mockResolvedValue(model)
    const rendered = await renderEditor({ onSaveLoan: save, onRefreshAuthoritative: refresh })
    const control = rendered.view.getByRole('switch', { name: 'Include this liability in estimated net worth' })
    await fireEvent(control, 'valueChange', false)
    await fireEvent.press(rendered.view.getByRole('button', { name: 'Confirm change' }))
    expect(await rendered.view.findByText(/result is unknown/i)).toBeOnTheScreen()
    expect(control.props.value).toBe(false)

    await rendered.view.rerender(<I18nextProvider i18n={await initMobileI18n('en')}><LoanEditScreen {...rendered.props} refreshRequired /></I18nextProvider>)
    expect(rendered.view.getByRole('switch', { name: 'Include this liability in estimated net worth' }).props.disabled).toBe(true)
    expect(rendered.view.getByRole('button', { name: 'Save details' }).props.accessibilityState.disabled).toBe(true)
    await fireEvent.press(rendered.view.getByRole('button', { name: 'Refresh loan data' }))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('retains draft and frozen target behind an invalid-response barrier, then rebases on refresh', async () => {
    const save = jest.fn().mockRejectedValue(new ApiError('invalid-response'))
    const refresh = jest.fn().mockResolvedValue(model)
    const rendered = await renderEditor({ onSaveLoan: save, onRefreshAuthoritative: refresh })
    await fireEvent.changeText(rendered.view.getByLabelText('Provider'), 'Draft lender')
    await fireEvent(rendered.view.getByRole('switch'), 'valueChange', false)
    await fireEvent.press(rendered.view.getByRole('button', { name: 'Confirm change' }))
    expect(await rendered.view.findByText(/response could not be verified/i)).toBeOnTheScreen()

    await rendered.view.rerender(<I18nextProvider i18n={await initMobileI18n('en')}><LoanEditScreen {...rendered.props} refreshRequired /></I18nextProvider>)
    expect(rendered.view.getByLabelText('Provider').props.value).toBe('Draft lender')
    expect(rendered.view.getByRole('switch').props.value).toBe(false)
    expect(rendered.view.getByRole('button', { name: 'Save details' }).props.accessibilityState.disabled).toBe(true)
    expect(rendered.view.getByRole('button', { name: 'Confirm change' }).props.accessibilityState.disabled).toBe(true)
    await fireEvent.press(rendered.view.getByRole('button', { name: 'Save details' }))
    await fireEvent.press(rendered.view.getByRole('button', { name: 'Confirm change' }))
    expect(save).toHaveBeenCalledTimes(1)

    await fireEvent.press(rendered.view.getByRole('button', { name: 'Refresh loan data' }))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    await rendered.view.rerender(<I18nextProvider i18n={await initMobileI18n('en')}><LoanEditScreen {...rendered.props} refreshRequired={false} /></I18nextProvider>)
    expect(rendered.view.getByLabelText('Provider').props.value).toBe('Draft lender')
    expect(rendered.view.getByRole('switch').props.value).toBe(false)
    expect(rendered.view.getByRole('button', { name: 'Save details' }).props.accessibilityState.disabled).toBe(false)
    expect(rendered.view.getByRole('button', { name: 'Confirm change' }).props.accessibilityState.disabled).toBe(false)
  })

  it('guards discard and locks fields, navigation and actions while pending', async () => {
    const back = jest.fn()
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => { buttons?.[1]?.onPress?.() })
    const { view } = await renderEditor({ onBack: back })
    await fireEvent.changeText(view.getByLabelText('Provider'), 'Unsaved')
    await fireEvent.press(view.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(back).toHaveBeenCalled())
    const pending = await renderEditor({ pending: true })
    expect(pending.view.getByLabelText('Name').props.editable).toBe(false)
    expect(pending.view.getByLabelText('Provider').props.editable).toBe(false)
    expect(pending.view.getByLabelText('Notes').props.editable).toBe(false)
    expect(pending.view.getByRole('switch').props.disabled).toBe(true)
    expect(pending.view.getByRole('button', { name: 'Cancel' }).props.accessibilityState.disabled).toBe(true)
    expect(pending.view.getByRole('button', { name: 'Back' }).props.accessibilityState.disabled).toBe(true)
  })

  it.each(['pt-PT', 'es'])('provides translated, labelled controls in %s', async (language) => {
    const { view } = await renderEditor({}, language)
    expect(view.getAllByRole('button').length).toBeGreaterThanOrEqual(3)
    expect(view.getByRole('switch')).toBeOnTheScreen()
    expect(view.getAllByLabelText(/Nome|Nombre|Entidade|Entidad|Notas/).length).toBeGreaterThan(0)
  })
})
