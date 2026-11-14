import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { ManualTransactionScreen, type ManualTransactionScreenProps } from './manual-transaction-screen'

// DateField is a native picker; a text input stands in so the form stays drivable here.
jest.mock('@/components/ui/date-field', () => jest.requireActual('./test-date-field'))

/** Opens a select row's sheet and picks one option. */
const choose = async (view: Awaited<ReturnType<typeof render>>, field: string, option: string | RegExp) => {
  await fireEvent.press(view.getByRole('button', { name: new RegExp(`^${field.replace(/[()]/g, '\\$&')},`) }))
  await fireEvent.press(view.getByRole('radio', { name: option }))
}

const account = { accountId: 7, accountName: 'Everyday', institutionDisplayName: null, isOwnedByViewer: true, isPrivate: false, originalBalance: 100, convertedBalance: 100, originalCurrencyCode: 'EUR', primaryCurrencyCode: 'EUR', refreshedAt: null, source: 'manual' as const, csvImportFormat: null }
const baseProps: ManualTransactionScreenProps = {
  accounts: [account],
  categories: [{ id: 4, name: 'Food', system: true, color: null, glyph: '□', countsAsSpending: true, children: [] }],
  types: [{ transactionTypeKey: 3, name: 'payment' }],
  currencies: [{ currencyKey: 151, code: 'EUR', description: 'Euro' }],
  merchants: [{ transactionMerchantKey: 9, name: 'Cafe' }],
  merchantSearchStatus: 'loaded',
  initialAccountId: 7,
  loading: false,
  metadataError: false,
  pending: false,
  outcome: null,
  onMerchantSearch: jest.fn(),
  onBack: jest.fn(),
  onEdit: jest.fn(),
  onSubmit: jest.fn().mockResolvedValue(undefined),
  onInspect: jest.fn(),
}

const renderScreen = async (overrides: Partial<ManualTransactionScreenProps> = {}, language = 'en') => {
  const i18n = await initMobileI18n(language)
  const props = { ...baseProps, ...overrides }
  const view = await render(<I18nextProvider i18n={i18n}><ManualTransactionScreen {...props} /></I18nextProvider>)
  const rerender = async (next: Partial<ManualTransactionScreenProps>) => view.rerender(<I18nextProvider i18n={i18n}><ManualTransactionScreen {...props} {...next} /></I18nextProvider>)
  return { view, props, i18n, rerender }
}

/** Everything but the merchant: the type starts on the kind's default, the currency on the account's. */
const fillAmount = async (view: Awaited<ReturnType<typeof renderScreen>>['view'], value = '12.50') => {
  await fireEvent.changeText(view.getByLabelText('Settlement amount'), value)
}

const completeRequiredFields = async (view: Awaited<ReturnType<typeof renderScreen>>['view']) => {
  await choose(view, 'Transaction type', 'Payment')
  await fillAmount(view)
  await choose(view, 'Settlement currency', /EUR/)
  await choose(view, 'Existing merchant', 'Cafe')
}

describe('manual transaction screen', () => {
  it('moves from form to an explicit localized review and submits the frozen payload once', async () => {
    const submit = jest.fn().mockResolvedValue(undefined)
    const { view } = await renderScreen({ onSubmit: submit })
    await completeRequiredFields(view)
    await choose(view, 'Category (optional)', 'Food')
    await fireEvent.changeText(view.getByLabelText('Description (optional)'), '  Lunch  ')
    await fireEvent.press(view.getByRole('button', { name: 'Review transaction' }))
    expect(view.getByRole('header', { name: 'Review before recording' })).toBeOnTheScreen()
    expect(view.getByText(/This will subtract/)).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Confirm and record' }))
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ accountId: 7, payload: expect.objectContaining({ transactionTypeId: '3', settlementAmount: '12.50', settlementCurrencyId: '151', transactionMerchantId: 9, categoryId: '4', description: 'Lunch' }) }))
    view.unmount()
  })

  it('evaluates an arithmetic expression typed into the amount', async () => {
    const submit = jest.fn().mockResolvedValue(undefined)
    const { view } = await renderScreen({ onSubmit: submit })
    await choose(view, 'Transaction type', 'Payment')
    await fireEvent.changeText(view.getByLabelText('Settlement amount'), '12.40+3.15')
    expect(view.getByText('= 15.55')).toBeOnTheScreen()
    await choose(view, 'Settlement currency', /EUR/)
    await choose(view, 'Existing merchant', 'Cafe')
    await fireEvent.press(view.getByRole('button', { name: 'Review transaction' }))
    await fireEvent.press(view.getByRole('button', { name: 'Confirm and record' }))
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ settlementAmount: '15.55' }) }))
    view.unmount()
  })

  it('tags a new transaction, creating a tag inline, and shows the tags in the review', async () => {
    const submit = jest.fn().mockResolvedValue(undefined)
    const onCreateTag = jest.fn().mockResolvedValue({ tag: { tagKey: 12, name: 'Holiday', color: '#94a3b8' } })
    const { view } = await renderScreen({ onSubmit: submit, onCreateTag, tags: { status: 'loaded', tags: [{ tagKey: 5, name: 'Trip', color: '#ef4444' }] } })
    await completeRequiredFields(view)
    await fireEvent.press(view.getByRole('button', { name: 'Tags (optional), None' }))
    await fireEvent.press(view.getByRole('checkbox', { name: 'Trip' }))
    await fireEvent.changeText(view.getByLabelText('New tag'), 'Holiday')
    await fireEvent.press(view.getByRole('button', { name: 'Create \u201cHoliday\u201d' }))
    expect(await view.findByRole('checkbox', { name: 'Holiday' })).toBeChecked()
    await fireEvent.press(view.getByRole('button', { name: 'Done' }))
    expect(view.getByRole('button', { name: 'Tags (optional), Trip, Holiday' })).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Review transaction' }))
    expect(view.getByText('Trip, Holiday')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Confirm and record' }))
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ tagIds: [5, 12] }) }))
    view.unmount()
  })

  it('offers no Tags row while the tag list is unavailable', async () => {
    const { view } = await renderScreen({ onCreateTag: jest.fn(), tags: { status: 'error' } })
    expect(view.queryByRole('button', { name: /^Tags \(optional\)/ })).toBeNull()
    view.unmount()
  })

  it('distinguishes search errors from no matches and requires an explicit create intent while search is unavailable', async () => {
    const { view: unavailable } = await renderScreen({ merchants: [], merchantSearchStatus: 'error' })
    await fireEvent.changeText(unavailable.getByLabelText('Merchant name or search'), 'New shop')
    expect(unavailable.getByRole('alert')).toHaveTextContent(/search is unavailable/i)
    expect(unavailable.queryByText(/No existing merchants match/)).toBeNull()
    expect(unavailable.getByRole('button', { name: 'Review transaction' }).props.accessibilityState.disabled).toBe(true)
    await fillAmount(unavailable)
    expect(unavailable.getByRole('button', { name: 'Review transaction' }).props.accessibilityState.disabled).toBe(true)
    await fireEvent.press(unavailable.getByRole('button', { name: 'Create new merchant' }))
    expect(unavailable.getByRole('button', { name: 'Review transaction' }).props.accessibilityState.disabled).toBe(false)
    unavailable.unmount()

    const { view: noMatches } = await renderScreen({ merchants: [], merchantSearchStatus: 'loaded' })
    await fillAmount(noMatches)
    await fireEvent.changeText(noMatches.getByLabelText('Merchant name or search'), 'Unique shop')
    expect(noMatches.getByText(/No existing merchants match/)).toBeOnTheScreen()
    expect(noMatches.queryByRole('alert')).toBeNull()
    expect(noMatches.getByRole('button', { name: 'Review transaction' }).props.accessibilityState.disabled).toBe(false)
    noMatches.unmount()
  })

  it('preserves a selected existing merchant across loading and transient search failure', async () => {
    const { view, rerender } = await renderScreen()
    await fillAmount(view)
    await choose(view, 'Existing merchant', 'Cafe')
    await fireEvent.changeText(view.getByLabelText('Merchant name or search'), 'another')
    await rerender({ merchants: [], merchantSearchStatus: 'loading' })
    expect(view.getByText('Selected existing merchant: Cafe')).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Review transaction' }).props.accessibilityState.disabled).toBe(false)
    await rerender({ merchants: [], merchantSearchStatus: 'error' })
    expect(view.getByRole('button', { name: 'Existing merchant, Cafe' })).toBeOnTheScreen()
    expect(view.getByText('Selected existing merchant: Cafe')).toBeOnTheScreen()
    view.unmount()
  })

  it('marks only the active submit control busy while other disabled controls remain not busy', async () => {
    const { view, rerender } = await renderScreen()
    await completeRequiredFields(view)
    await fireEvent.press(view.getByRole('button', { name: 'Review transaction' }))
    await rerender({ pending: true })
    expect(view.getByRole('button', { name: 'Recording…' }).props.accessibilityState).toMatchObject({ disabled: true, busy: true })
    expect(view.getByRole('button', { name: 'Edit details' }).props.accessibilityState).toMatchObject({ disabled: true, busy: false })
    expect(view.getByRole('button', { name: 'Close' }).props.accessibilityState).toMatchObject({ disabled: true, busy: false })
    view.unmount()
  })

  it('exposes accessible controls in Spanish and keeps ordinary disabled controls not busy', async () => {
    const { view } = await renderScreen({ pending: true }, 'es')
    expect(view.getByRole('button', { name: 'Cerrar' }).props.accessibilityState.disabled).toBe(true)
    expect(view.getByRole('button', { name: 'Cerrar' }).props.accessibilityState.busy).toBe(false)
    expect(view.getByRole('button', { name: 'Revisar transacción' }).props.accessibilityState.disabled).toBe(true)
    expect(view.getByRole('button', { name: 'Revisar transacción' }).props.accessibilityState.busy).toBe(false)
    expect(view.getByLabelText('Importe de liquidación')).toBeOnTheScreen()
    view.unmount()
  })

  it('leads with the kind, maps it onto the server types, and keeps the save disabled until the form is valid', async () => {
    const types = [
      { transactionTypeKey: 3, name: 'payment' },
      { transactionTypeKey: 4, name: 'card_payment' },
      { transactionTypeKey: 5, name: 'deposit' },
      { transactionTypeKey: 6, name: 'transfer_out' },
    ]
    const submit = jest.fn().mockResolvedValue(undefined)
    const { view } = await renderScreen({ types, onSubmit: submit })
    // Expense opens on card payment; the currency follows the account (EUR).
    expect(view.getByRole('tab', { name: 'Expense' })).toBeSelected()
    expect(view.getByRole('button', { name: 'Transaction type, Card payment' })).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Settlement currency, EUR · Euro' })).toBeOnTheScreen()
    const save = () => view.getByRole('button', { name: 'Review transaction' })
    expect(save().props.accessibilityState.disabled).toBe(true)

    await fireEvent.press(view.getByRole('tab', { name: 'Income' }))
    expect(view.getByRole('button', { name: 'Transaction type, Deposit' })).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('tab', { name: 'Transfer' }))
    expect(view.getByRole('button', { name: 'Transaction type, Transfer out' })).toBeOnTheScreen()

    // A wrong amount says so under the figure; a comma is a decimal point.
    await fillAmount(view, '0')
    expect(view.getByText('Enter an amount greater than zero, without a sign.')).toBeOnTheScreen()
    await fillAmount(view, '12,5')
    expect(view.queryByText('Enter an amount greater than zero, without a sign.')).toBeNull()
    await choose(view, 'Existing merchant', 'Cafe')
    expect(save().props.accessibilityState.disabled).toBe(false)
    await fireEvent.press(save())
    await fireEvent.press(view.getByRole('button', { name: 'Confirm and record' }))
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ transactionTypeId: '6', settlementAmount: '12.5', settlementCurrencyId: '151' }) }))
    view.unmount()
  })

  it.each([
    ['pt-PT', '1.234,56', '1234.56'],
    ['es', '1.000', '1000'],
    ['en', '1.000', '1.000'],
    ['en', '1,000', '1000'],
  ])('reads the amount in %s: %s is %s', async (language, typed, expected) => {
    const submit = jest.fn().mockResolvedValue(undefined)
    const { view, i18n } = await renderScreen({ onSubmit: submit }, language)
    await fireEvent.changeText(view.getByLabelText(i18n.t('transactionCreate.amount')), typed)
    await choose(view, i18n.t('transactionCreate.existingMerchant'), 'Cafe')
    await fireEvent.press(view.getByRole('button', { name: i18n.t('transactionCreate.review') }))
    await fireEvent.press(view.getByRole('button', { name: i18n.t('transactionCreate.confirm') }))
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ settlementAmount: expected }) }))
    view.unmount()
  })

  it('shows an error instead of reviewing an amount it cannot read', async () => {
    const { view, i18n } = await renderScreen({}, 'pt-PT')
    await fireEvent.changeText(view.getByLabelText(i18n.t('transactionCreate.amount')), '1.2.3')
    expect(view.getByText(i18n.t('transactionCreate.errors.amount'))).toBeOnTheScreen()
    await choose(view, i18n.t('transactionCreate.existingMerchant'), 'Cafe')
    expect(view.getByRole('button', { name: i18n.t('transactionCreate.review') }).props.accessibilityState.disabled).toBe(true)
    view.unmount()
  })

  it('fills the form from a template, dates it today and creates nothing', async () => {
    const submit = jest.fn().mockResolvedValue(undefined)
    const savings = { ...account, accountId: 8, accountName: 'Savings' }
    const template = {
      transactionTemplateKey: 4,
      name: 'Weekly groceries',
      direction: 'out' as const,
      amount: 12.5,
      description: 'Market',
      notes: 'Cash',
      position: 0,
      account: { accountKey: 8, accountName: 'Savings' },
      category: { categoryKey: 4, name: 'Food' },
      transactionMerchant: { transactionMerchantKey: 9, name: 'Cafe' },
    }
    const { view, i18n } = await renderScreen({
      accounts: [account, savings],
      onSubmit: submit,
      templates: [template],
      templatesStatus: 'loaded',
    })

    await fireEvent.press(view.getByRole('button', { name: i18n.t('transactionTemplates.use', { name: template.name }) }))

    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    expect(view.getByLabelText(i18n.t('transactionCreate.amount')).props.value).toBe('12.5')
    expect(view.getByLabelText(i18n.t('transactionCreate.date')).props.value).toBe(today)
    expect(view.getByLabelText(i18n.t('transactionCreate.descriptionOptional')).props.value).toBe('Market')
    expect(view.getByTestId('transaction-create-notes').props.value).toBe('Cash')
    expect(view.getByRole('button', { name: `${i18n.t('transactionCreate.account')}, Savings` })).toBeOnTheScreen()
    expect(view.getByRole('button', { name: `${i18n.t('transactionCreate.type')}, Payment` })).toBeOnTheScreen()
    expect(submit).not.toHaveBeenCalled()
    view.unmount()
  })
})
