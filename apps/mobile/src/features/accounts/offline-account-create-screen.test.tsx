import { fireEvent, render, within } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { OfflineAccountCreateScreen, type OfflineAccountCreateScreenProps } from './offline-account-create-screen'
import { touchHeight } from '@/test/touch-target'

const currencies = [
  { currencyKey: 151, code: 'EUR', description: 'Euro' },
  { currencyKey: 152, code: 'USD', description: 'US Dollar' },
]
const institutions = [{ accountFinancialInstitutionKey: 8, displayName: 'Bank One', logoUrl: null }]

async function setup(overrides: Partial<OfflineAccountCreateScreenProps> = {}) {
  const i18n = await initMobileI18n('en')
  const props: OfflineAccountCreateScreenProps = {
    currencies,
    institutions,
    pending: false,
    unknownGuard: null,
    onBack: jest.fn(),
    onConfirm: jest.fn().mockResolvedValue(null),
    onCheckAccounts: jest.fn().mockResolvedValue(undefined),
    onCreateAnother: jest.fn(),
    ...overrides,
  }
  const view = await render(<I18nextProvider i18n={i18n}><OfflineAccountCreateScreen {...props} /></I18nextProvider>)
  return { view, props }
}

describe('OfflineAccountCreateScreen', () => {
  it('keeps the save disabled until the form is valid and shows an error under a wrong entry', async () => {
    const { view } = await setup()
    const save = () => view.getByRole('button', { name: 'Review account' })
    expect(save()).toBeDisabled()
    await fireEvent.changeText(view.getByLabelText('Account name'), '   ')
    expect(view.getByText('Enter a name of 1-100 characters.')).toBeOnTheScreen()
    await fireEvent.changeText(view.getByLabelText('Opening/current balance'), '-4')
    expect(view.getByText('Enter a positive balance within the supported limit.')).toBeOnTheScreen()
    await fireEvent.changeText(view.getByLabelText('Account name'), 'Cash savings')
    expect(view.queryByText('Enter a name of 1-100 characters.')).not.toBeOnTheScreen()
    await fireEvent.changeText(view.getByLabelText('Opening/current balance'), '10')
    expect(view.queryByText('Enter a positive balance within the supported limit.')).not.toBeOnTheScreen()
    expect(save()).toBeDisabled()
    await fireEvent.press(view.getByRole('button', { name: /^Currency/ }))
    await fireEvent.press(view.getByRole('radio', { name: 'EUR · Euro' }))
    expect(save()).toBeEnabled()
  })

  it('requires explicit currency, positive balance, bounded trimmed name, and no account type', async () => {
    const { view, props } = await setup()
    await fireEvent.changeText(view.getByLabelText('Account name'), '  Cash savings  ')
    await fireEvent.changeText(view.getByLabelText('Opening/current balance'), '25,50')
    expect(view.getByRole('button', { name: 'Review account' })).toBeDisabled()
    await fireEvent.press(view.getByRole('button', { name: /^Currency/ }))
    await fireEvent.press(view.getByRole('radio', { name: 'USD · US Dollar' }))
    await fireEvent.press(view.getByRole('button', { name: /^Financial institution/ }))
    await fireEvent.press(view.getByRole('radio', { name: 'Bank One' }))
    await fireEvent.press(view.getByRole('button', { name: 'Review account' }))
    expect(view.getByRole('header', { name: 'Review account details' })).toBeOnTheScreen()
    expect(view.getByText('Cash savings')).toBeOnTheScreen()
    expect(view.getByText('USD · US Dollar')).toBeOnTheScreen()
    expect(view.getByText('Bank One')).toBeOnTheScreen()
    expect(view.queryByText(/account type/i)).not.toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Create manual account' }))
    expect(props.onConfirm).toHaveBeenCalledWith({ name: 'Cash savings', currentBalance: 25.5, currencyId: 152, financialInstitutionId: 8 })
    expect(Object.isFrozen((props.onConfirm as jest.Mock).mock.calls[0][0])).toBe(true)
  })

  it('shows honest manual, transaction, and cross-currency context during explicit review', async () => {
    const { view } = await setup()
    await fireEvent.changeText(view.getByLabelText('Account name'), 'Cash')
    await fireEvent.changeText(view.getByLabelText('Opening/current balance'), '10')
    await fireEvent.press(view.getByRole('button', { name: /^Currency/ }))
    await fireEvent.press(view.getByRole('radio', { name: 'EUR · Euro' }))
    await fireEvent.press(view.getByRole('button', { name: 'Review account' }))
    expect(view.getByText('Manual maintenance')).toBeOnTheScreen()
    expect(view.getByText(/not a real transaction/i)).toBeOnTheScreen()
    expect(view.getByText(/converted balance may be unavailable/i)).toBeOnTheScreen()
    expect(view.getByText('None')).toBeOnTheScreen()
    expect(view.getByLabelText('Account name: Cash')).toBeOnTheScreen()
    expect(view.getByLabelText('Opening/current balance: €10.00')).toBeOnTheScreen()
    expect(view.getByLabelText('Currency: EUR · Euro')).toBeOnTheScreen()
    expect(view.getByLabelText('Financial institution: None')).toBeOnTheScreen()
  })

  it('filters the institution list without changing the selected institution', async () => {
    const { view } = await setup({
      institutions: [
        ...institutions,
        { accountFinancialInstitutionKey: 9, displayName: 'Credit Union', logoUrl: null },
      ],
    })
    await fireEvent.press(view.getByRole('button', { name: /^Financial institution/ }))
    await fireEvent.press(view.getByRole('radio', { name: 'Bank One' }))
    await fireEvent.press(view.getByRole('button', { name: /^Financial institution/ }))
    await fireEvent.changeText(view.getByLabelText('Search banks'), 'credit')

    expect(view.queryByRole('radio', { name: 'Bank One' })).not.toBeOnTheScreen()
    expect(view.getByRole('radio', { name: 'Credit Union' })).toBeOnTheScreen()
    expect(view.getByRole('radio', { name: 'Credit Union' }).props.accessibilityState).toEqual({ checked: false })
    expect(view.getByRole('radio', { name: 'None' }).props.accessibilityState).toEqual({ checked: false })
    await fireEvent.changeText(view.getByLabelText('Search banks'), '')
    expect(view.getByRole('radio', { name: 'Bank One' }).props.accessibilityState).toEqual({ checked: true })
  })

  it('locks navigation and confirmation while one frozen submission is pending', async () => {
    const back = jest.fn()
    const { view } = await setup({
      pending: true,
      unknownGuard: { payload: { name: 'Cash', currentBalance: 10, currencyId: 151 } },
      onBack: back,
    })
    expect(view.getByRole('button', { name: 'Close' })).toBeDisabled()
    expect(view.queryByRole('button', { name: 'Create manual account' })).not.toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Close' }))
    expect(back).not.toHaveBeenCalled()
  })

  it('preserves reviewed values behind the unknown gate and offers reconciliation without success inference', async () => {
    const check = jest.fn().mockResolvedValue(undefined)
    const clear = jest.fn()
    const { view } = await setup({
      unknownGuard: { payload: { name: 'Cash', currentBalance: 10, currencyId: 151, financialInstitutionId: 8 } },
      onCheckAccounts: check,
      onCreateAnother: clear,
    })
    expect(view.getByRole('alert')).toHaveTextContent(/matching fields do not prove/i)
    expect(view.getByText('Cash')).toBeOnTheScreen()
    expect(view.queryByRole('button', { name: 'Create manual account' })).not.toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Check accounts' }))
    expect(check).toHaveBeenCalledTimes(1)
    await fireEvent.press(view.getByRole('button', { name: 'Create another account' }))
    expect(clear).toHaveBeenCalledTimes(1)
    expect(view.getByLabelText('Account name').props.value).toBe('')
  })

  it('opens as a flow with close and save in the form bar and labelled 44dp rows', async () => {
    const { view, props } = await setup()
    await fireEvent.press(view.getByRole('button', { name: 'Close' }))
    expect(props.onBack).toHaveBeenCalledTimes(1)
    expect(view.getByRole('header', { name: 'Add manual account' })).toBeOnTheScreen()
    const currency = view.getByRole('button', { name: 'Currency, Choose' })
    expect(touchHeight(currency)).toBeGreaterThanOrEqual(44)
    expect(within(currency).getByText('Currency').props.allowFontScaling).not.toBe(false)
    expect(view.getByRole('button', { name: 'Financial institution, None' })).toBeOnTheScreen()
    expect(view.queryByText('Back to Accounts')).not.toBeOnTheScreen()
    await fireEvent.press(currency)
    expect(view.getByRole('radio', { name: 'EUR · Euro' }).props.accessibilityState).toEqual({ checked: false, selected: false })
  })
})
