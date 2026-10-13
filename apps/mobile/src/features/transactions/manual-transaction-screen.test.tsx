import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { ManualTransactionScreen, type ManualTransactionScreenProps } from './manual-transaction-screen'

const account = { accountId: 7, accountName: 'Everyday', institutionDisplayName: null, isOwnedByViewer: true, isPrivate: false, originalBalance: 100, convertedBalance: 100, originalCurrencyCode: 'EUR', primaryCurrencyCode: 'EUR', refreshedAt: null, source: 'manual' as const }
const baseProps: ManualTransactionScreenProps = {
  accounts: [account],
  categories: [{ id: 4, name: 'Food', system: true, color: null, glyph: '□', children: [] }],
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

const completeRequiredFields = async (view: Awaited<ReturnType<typeof renderScreen>>['view']) => {
  await fireEvent.press(view.getByRole('radio', { name: 'Payment' }))
  await fireEvent.changeText(view.getByLabelText('Settlement amount'), '12.50')
  await fireEvent.press(view.getByRole('radio', { name: /EUR/ }))
  await fireEvent.press(view.getByRole('radio', { name: 'Cafe' }))
}

describe('manual transaction screen', () => {
  it('moves from form to an explicit localized review and submits the frozen payload once', async () => {
    const submit = jest.fn().mockResolvedValue(undefined)
    const { view } = await renderScreen({ onSubmit: submit })
    await completeRequiredFields(view)
    await fireEvent.press(view.getByRole('radio', { name: 'Food' }))
    await fireEvent.changeText(view.getByLabelText('Description (optional)'), '  Lunch  ')
    await fireEvent.press(view.getByRole('button', { name: 'Review transaction' }))
    expect(view.getByRole('header', { name: 'Review before recording' })).toBeOnTheScreen()
    expect(view.getByText(/This will subtract/)).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Confirm and record' }))
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ accountId: 7, payload: expect.objectContaining({ transactionTypeId: '3', settlementAmount: '12.50', settlementCurrencyId: '151', transactionMerchantId: 9, categoryId: '4', description: 'Lunch' }) }))
    view.unmount()
  })

  it('distinguishes search errors from no matches and requires an explicit create intent while search is unavailable', async () => {
    const { view: unavailable } = await renderScreen({ merchants: [], merchantSearchStatus: 'error' })
    await fireEvent.changeText(unavailable.getByLabelText('Merchant name or search'), 'New shop')
    expect(unavailable.getByRole('alert')).toHaveTextContent(/search is unavailable/i)
    expect(unavailable.queryByText(/No existing merchants match/)).toBeNull()
    expect(unavailable.getByText('Review transaction').parent?.props.accessibilityState.disabled).toBe(true)
    await fireEvent.press(unavailable.getByRole('button', { name: 'Create new merchant' }))
    expect(unavailable.getByText('Review transaction').parent?.props.accessibilityState.disabled).toBe(false)
    unavailable.unmount()

    const { view: noMatches } = await renderScreen({ merchants: [], merchantSearchStatus: 'loaded' })
    await fireEvent.changeText(noMatches.getByLabelText('Merchant name or search'), 'Unique shop')
    expect(noMatches.getByText(/No existing merchants match/)).toBeOnTheScreen()
    expect(noMatches.queryByRole('alert')).toBeNull()
    expect(noMatches.getByText('Review transaction').parent?.props.accessibilityState.disabled).toBe(false)
    noMatches.unmount()
  })

  it('preserves a selected existing merchant across loading and transient search failure', async () => {
    const { view, rerender } = await renderScreen()
    await fireEvent.press(view.getByRole('radio', { name: 'Cafe' }))
    await fireEvent.changeText(view.getByLabelText('Merchant name or search'), 'another')
    await rerender({ merchants: [], merchantSearchStatus: 'loading' })
    expect(view.getByText('Selected existing merchant: Cafe')).toBeOnTheScreen()
    expect(view.getByText('Review transaction').parent?.props.accessibilityState.disabled).toBe(false)
    await rerender({ merchants: [], merchantSearchStatus: 'error' })
    expect(view.getByRole('radio', { name: 'Cafe' }).props.accessibilityState.checked).toBe(true)
    expect(view.getByText('Selected existing merchant: Cafe')).toBeOnTheScreen()
    view.unmount()
  })

  it('marks only the active submit control busy while other disabled controls remain not busy', async () => {
    const { view, rerender } = await renderScreen()
    await completeRequiredFields(view)
    await fireEvent.press(view.getByRole('button', { name: 'Review transaction' }))
    await rerender({ pending: true })
    expect(view.getByText('Recording…').parent?.props.accessibilityState).toMatchObject({ disabled: true, busy: true })
    expect(view.getByText('Edit details').parent?.props.accessibilityState).toMatchObject({ disabled: true, busy: false })
    expect(view.getByText('Back').parent?.props.accessibilityState).toMatchObject({ disabled: true, busy: false })
    view.unmount()
  })

  it('exposes accessible controls in Spanish and keeps ordinary disabled controls not busy', async () => {
    const { view } = await renderScreen({ pending: true }, 'es')
    expect(view.getByText('Volver').parent?.props.accessibilityState.disabled).toBe(true)
    expect(view.getByText('Volver').parent?.props.accessibilityState.busy).toBe(false)
    expect(view.getByText('Revisar transacción').parent?.props.accessibilityState.disabled).toBe(true)
    expect(view.getByText('Revisar transacción').parent?.props.accessibilityState.busy).toBe(false)
    expect(view.getByLabelText('Importe de liquidación')).toBeOnTheScreen()
    view.unmount()
  })
})
