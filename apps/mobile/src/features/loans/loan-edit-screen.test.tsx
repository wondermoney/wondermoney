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
    expect(view.getByRole('button', { name: 'Loan type, Mortgage' })).toBeOnTheScreen()
    expect(view.getByLabelText('Opening principal balance').props.value).toBe('250000')
    expect(view.getByLabelText('Start date').props.value).toBe('2026-01-01')
    expect(view.getByLabelText('Monthly installment (optional)').props.value).toBe('1200')
    expect(view.getByLabelText('Annual interest rate, % (optional)').props.value).toBe('4.5')
    expect(view.getByLabelText('Term, months (optional)').props.value).toBe('360')
    await fireEvent.changeText(view.getByLabelText('Opening principal balance'), '260000')
    await fireEvent.press(view.getByRole('button', { name: 'Loan type, Mortgage' }))
    await fireEvent.press(view.getByRole('radio', { name: 'Personal loan' }))
    await fireEvent.press(view.getByRole('button', { name: 'Save details' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ type: 'PERSONAL_LOAN', openingPrincipalBalance: 260_000 }))
  })

  it('diffs the secured asset: a new choice sends its key, clearing sends null, and an unchanged link sends nothing', () => {
    expect(createLoanMetadataChanges({ ...model, securedAssetKey: null }, { ...currentFromModel, securedAssetKey: 9 })).toEqual({ securedAssetKey: 9 })
    expect(createLoanMetadataChanges({ ...model, securedAssetKey: 9 }, { ...currentFromModel, securedAssetKey: null })).toEqual({ securedAssetKey: null })
    expect(createLoanMetadataChanges({ ...model, securedAssetKey: 9 }, { ...currentFromModel, securedAssetKey: 9 })).toBeNull()
    expect(createLoanMetadataChanges(model, { ...currentFromModel, securedAssetKey: null })).toBeNull()
  })

  it('lists the assets under Secured against and saves the chosen one', async () => {
    const save = jest.fn().mockResolvedValue(undefined)
    const { view } = await renderEditor({ onSaveLoan: save, securedAssets: [{ key: 2, name: 'Car' }, { key: 9, name: 'Family home' }] })
    await fireEvent.press(view.getByRole('button', { name: 'Secured against, None' }))
    expect(view.getAllByRole('radio').map((option) => option.props.accessibilityLabel)).toEqual(['None', 'Car', 'Family home'])
    await fireEvent.press(view.getByRole('radio', { name: 'Family home' }))
    expect(view.getByRole('button', { name: 'Secured against, Family home' })).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Save details' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ securedAssetKey: 9 }))
    // Saved: choosing it again is no change.
    await waitFor(() => expect(view.getByRole('button', { name: 'Save details' })).toBeDisabled())
  })

  it('unlinks the asset with None, sending null', async () => {
    const save = jest.fn().mockResolvedValue(undefined)
    const { view } = await renderEditor({ onSaveLoan: save, state: { status: 'loaded', model: { ...model, securedAssetKey: 9 } }, securedAssets: [{ key: 9, name: 'Family home' }] })
    await fireEvent.press(view.getByRole('button', { name: 'Secured against, Family home' }))
    await fireEvent.press(view.getByRole('radio', { name: 'None' }))
    await fireEvent.press(view.getByRole('button', { name: 'Save details' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ securedAssetKey: null }))
  })

  it('leaves Secured against out when there is no asset to offer and none linked', async () => {
    const { view } = await renderEditor()
    expect(view.queryByRole('button', { name: /^Secured against,/ })).not.toBeOnTheScreen()
  })

  it('pre-fills and reads numbers in the app language', async () => {
    const save = jest.fn().mockResolvedValue(undefined)
    const i18n = await initMobileI18n('pt-PT')
    const { view } = await renderEditor({ onSaveLoan: save }, 'pt-PT')
    const rate = view.getByLabelText(i18n.t('loanEdit.interestRateOptional'))
    expect(rate.props.value).toBe('4,5')
    await fireEvent.changeText(view.getByLabelText(i18n.t('loanCreate.principal')), '1.234,56')
    await fireEvent.press(view.getByRole('button', { name: i18n.t('loanEdit.saveDetails') }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ openingPrincipalBalance: 1234.56 }))
  })

  it('keeps Save disabled for a principal it cannot read', async () => {
    const save = jest.fn()
    const { view } = await renderEditor({ onSaveLoan: save })
    await fireEvent.changeText(view.getByLabelText('Opening principal balance'), '1.2.3')
    expect(view.getByRole('button', { name: 'Save details' })).toBeDisabled()
  })

  it('opens on an existing loan with no field errors and the principal in the loan\'s currency', async () => {
    const { view } = await renderEditor({ state: { status: 'loaded', model: { ...model, currencyCode: 'EUR' } } })
    expect(view.getByText('€')).toBeOnTheScreen()
    expect(view.queryByText(/Enter a valid start date/)).not.toBeOnTheScreen()
    expect(view.queryByRole('alert')).not.toBeOnTheScreen()
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
    expect(await view.findByRole('alert')).toHaveTextContent(/enter a name/i)
    expect(view.getByRole('button', { name: 'Save details' })).toBeDisabled()
    await fireEvent.press(view.getByRole('button', { name: 'Save details' }))
    expect(save).not.toHaveBeenCalled()
  })

  it('flags an out-of-range rate under its row and keeps Save disabled', async () => {
    const { view } = await renderEditor()
    await fireEvent.changeText(view.getByLabelText('Annual interest rate, % (optional)'), '150')
    expect(view.getByText('Enter a rate from 0 to 100.')).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Save details' })).toBeDisabled()
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
    await fireEvent.press(view.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(back).toHaveBeenCalled())
    const pending = await renderEditor({ pending: true })
    expect(pending.view.getByLabelText('Name').props.editable).toBe(false)
    expect(pending.view.getByLabelText('Provider').props.editable).toBe(false)
    expect(pending.view.getByLabelText('Notes').props.editable).toBe(false)
    expect(pending.view.getByRole('switch').props.disabled).toBe(true)
    expect(pending.view.getByRole('button', { name: 'Close' })).toBeDisabled()
    expect(pending.view.getByRole('button', { name: 'Saving…' })).toBeDisabled()
  })

  it.each(['pt-PT', 'es'])('provides translated, labelled controls in %s', async (language) => {
    const { view } = await renderEditor({}, language)
    expect(view.getAllByRole('button').length).toBeGreaterThanOrEqual(2)
    expect(view.getByRole('switch')).toBeOnTheScreen()
    expect(view.getAllByLabelText(/Nome|Nombre|Entidade|Entidad|Notas/).length).toBeGreaterThan(0)
  })
})
