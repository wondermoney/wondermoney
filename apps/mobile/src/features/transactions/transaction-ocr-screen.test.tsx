import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { TransactionOcrScreen, type TransactionOcrScreenProps } from './transaction-ocr-screen'
import type { TransactionOcrPhase } from './use-transaction-ocr'

const accounts = [{ accountId: 7, accountName: 'Daily account', institutionDisplayName: null, isOwnedByViewer: true, isPrivate: false, originalBalance: 100, convertedBalance: 100, originalCurrencyCode: 'EUR', primaryCurrencyCode: 'EUR', refreshedAt: null, source: 'manual' as const }]
const types = [{ transactionTypeKey: 3, name: 'card_payment' }]
const currencies = [{ currencyKey: 2, code: 'EUR', description: null }]

const scan = {
  transactionOcrImportId: 5,
  transactionInfo: { settlementAmount: 12.5, settlementCurrencyId: 2, transactionDate: '2026-07-18T10:00:00.000Z', transactionMerchantId: 9, transactionMerchantName: 'Corner shop' },
}

async function renderScreen(state: TransactionOcrPhase, overrides: Partial<TransactionOcrScreenProps> = {}) {
  const i18n = await initMobileI18n('en')
  const props: TransactionOcrScreenProps = {
    state,
    accounts,
    types,
    currencies,
    metadataLoading: false,
    onPickFile: jest.fn(),
    onConfirm: jest.fn(),
    onReject: jest.fn(),
    onReset: jest.fn(),
    onBack: jest.fn(),
    ...overrides,
  }
  const view = await render(<I18nextProvider i18n={i18n}><TransactionOcrScreen {...props} /></I18nextProvider>)
  return { view, props }
}

describe('TransactionOcrScreen', () => {
  it('offers a choose-file button when idle', async () => {
    const onPickFile = jest.fn()
    const { view } = await renderScreen({ phase: 'idle' }, { onPickFile })
    await fireEvent.press(view.getByRole('button', { name: 'Choose receipt' }))
    expect(onPickFile).toHaveBeenCalled()
  })

  it('shows a scanning indicator', async () => {
    const { view } = await renderScreen({ phase: 'scanning' })
    expect(view.getByRole('progressbar')).toBeOnTheScreen()
  })

  it('prefills the review form from the scan and keeps confirm disabled until account/type/currency are chosen', async () => {
    const { view } = await renderScreen({ phase: 'review', scan })
    expect(view.getByLabelText('Date').props.value).toBe('2026-07-18')
    expect(view.getByLabelText('Amount').props.value).toBe('12.5')
    expect(view.getByLabelText('Merchant').props.value).toBe('Corner shop')
    expect(view.getByRole('button', { name: 'Confirm and record' })).toBeDisabled()

    await fireEvent.press(view.getByRole('button', { name: 'Daily account' }))
    await fireEvent.press(view.getByRole('button', { name: 'Card payment' }))
    await fireEvent.press(view.getByRole('button', { name: 'EUR' }))
    expect(view.getByRole('button', { name: 'Confirm and record' })).not.toBeDisabled()
  })

  it('submits existingMerchantId when the merchant name is left unedited', async () => {
    const onConfirm = jest.fn()
    const { view } = await renderScreen({ phase: 'review', scan }, { onConfirm })
    await fireEvent.press(view.getByRole('button', { name: 'Daily account' }))
    await fireEvent.press(view.getByRole('button', { name: 'Card payment' }))
    await fireEvent.press(view.getByRole('button', { name: 'EUR' }))
    await fireEvent.press(view.getByRole('button', { name: 'Confirm and record' }))
    expect(onConfirm).toHaveBeenCalledWith({
      accountId: 7,
      transactionTypeId: 3,
      transactionDate: '2026-07-18',
      settlementAmount: '12.5',
      settlementCurrencyId: 2,
      existingMerchantId: 9,
    })
  })

  it('submits newMerchantName when the merchant name is edited', async () => {
    const onConfirm = jest.fn()
    const { view } = await renderScreen({ phase: 'review', scan }, { onConfirm })
    await fireEvent.press(view.getByRole('button', { name: 'Daily account' }))
    await fireEvent.press(view.getByRole('button', { name: 'Card payment' }))
    await fireEvent.press(view.getByRole('button', { name: 'EUR' }))
    await fireEvent.changeText(view.getByLabelText('Merchant'), 'Corner shop groceries')
    await fireEvent.press(view.getByRole('button', { name: 'Confirm and record' }))
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ newMerchantName: 'Corner shop groceries' }))
  })

  it('discards a reviewed scan via onReject', async () => {
    const onReject = jest.fn()
    const { view } = await renderScreen({ phase: 'review', scan }, { onReject })
    await fireEvent.press(view.getByRole('button', { name: 'Discard' }))
    expect(onReject).toHaveBeenCalled()
  })

  it('shows an inline confirm error without losing prefilled values', async () => {
    const { view } = await renderScreen({ phase: 'review', scan, confirmError: 'network' })
    expect(view.getByRole('alert')).toBeOnTheScreen()
    expect(view.getByLabelText('Amount').props.value).toBe('12.5')
  })

  it('shows the succeeded outcome and offers scan-another or done', async () => {
    const onReset = jest.fn()
    const onBack = jest.fn()
    const { view } = await renderScreen({ phase: 'succeeded' }, { onReset, onBack })
    expect(view.getByText('Transaction recorded.')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Scan another receipt' }))
    expect(onReset).toHaveBeenCalled()
    await fireEvent.press(view.getByRole('button', { name: 'Done' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('shows a scan failure reason and retries via onReset', async () => {
    const onReset = jest.fn()
    const { view } = await renderScreen({ phase: 'error', reason: 'network' }, { onReset })
    expect(view.getByText('Check your connection and try again.')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Try again' }))
    expect(onReset).toHaveBeenCalled()
  })
})
