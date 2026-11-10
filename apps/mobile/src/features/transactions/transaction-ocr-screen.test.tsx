import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { TransactionOcrScreen, type TransactionOcrScreenProps } from './transaction-ocr-screen'
import type { TransactionOcrPhase } from './use-transaction-ocr'

jest.mock('@/components/ui/date-field', () => jest.requireActual('./test-date-field'))

/** Each choice is a select row that opens a sheet of radio options. */
async function chooseAccountTypeAndCurrency(view: Awaited<ReturnType<typeof render>>) {
  for (const [field, option] of [['Account', 'Daily account'], ['Type', 'Card payment'], ['Currency', 'EUR']] as const) {
    await fireEvent.press(view.getByRole('button', { name: new RegExp(`^${field},`) }))
    await fireEvent.press(view.getByRole('radio', { name: option }))
  }
}

const accounts = [{ accountId: 7, accountName: 'Daily account', institutionDisplayName: null, isOwnedByViewer: true, isPrivate: false, originalBalance: 100, convertedBalance: 100, originalCurrencyCode: 'EUR', primaryCurrencyCode: 'EUR', refreshedAt: null, source: 'manual' as const, csvImportFormat: null }]
const types = [{ transactionTypeKey: 3, name: 'card_payment' }]
const currencies = [{ currencyKey: 2, code: 'EUR', description: null }]

const scan = {
  transactionOcrImportId: 5,
  transactionInfo: { settlementAmount: 12.5, settlementCurrencyId: 2, transactionDate: '2026-07-18T10:00:00.000Z', transactionMerchantId: 9, transactionMerchantName: 'Corner shop' },
}

async function renderScreen(state: TransactionOcrPhase, overrides: Partial<TransactionOcrScreenProps> = {}, language = 'en') {
  const i18n = await initMobileI18n(language)
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
    verificationResend: 'idle',
    onResendVerification: jest.fn(),
    ...overrides,
  }
  const view = await render(<I18nextProvider i18n={i18n}><TransactionOcrScreen {...props} /></I18nextProvider>)
  return { view, props, t: i18n.t.bind(i18n) }
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

    await chooseAccountTypeAndCurrency(view)
    expect(view.getByRole('button', { name: 'Confirm and record' })).not.toBeDisabled()
  })

  it('submits existingMerchantId when the merchant name is left unedited', async () => {
    const onConfirm = jest.fn()
    const { view } = await renderScreen({ phase: 'review', scan }, { onConfirm })
    await chooseAccountTypeAndCurrency(view)
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

  it('pre-fills and reads the amount in the app language', async () => {
    const onConfirm = jest.fn()
    const { view, t } = await renderScreen({ phase: 'review', scan }, { onConfirm }, 'pt-PT')
    const amount = view.getByLabelText(t('transactionOcr.amount'))
    expect(amount.props.value).toBe('12,5')
    await fireEvent.changeText(amount, '1.234,56')
    for (const [field, option] of [[t('transactionOcr.account'), 'Daily account'], [t('transactionOcr.type'), /./], [t('transactionOcr.currency'), 'EUR']] as const) {
      await fireEvent.press(view.getByRole('button', { name: new RegExp(`^${field},`) }))
      await fireEvent.press(view.getAllByRole('radio', { name: option })[0]!)
    }
    await fireEvent.press(view.getByRole('button', { name: t('transactionOcr.confirm') }))
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ settlementAmount: '1234.56' }))
  })

  it('shows an error and keeps confirm disabled for an amount it cannot read', async () => {
    const onConfirm = jest.fn()
    const { view } = await renderScreen({ phase: 'review', scan }, { onConfirm })
    await chooseAccountTypeAndCurrency(view)
    await fireEvent.changeText(view.getByLabelText('Amount'), '1.2.3')
    expect(view.getByText('Enter an amount greater than zero, without a sign.')).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Confirm and record' })).toBeDisabled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('submits newMerchantName when the merchant name is edited', async () => {
    const onConfirm = jest.fn()
    const { view } = await renderScreen({ phase: 'review', scan }, { onConfirm })
    await chooseAccountTypeAndCurrency(view)
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

  it('explains an unverified email instead of a generic failure, and resends the link', async () => {
    const onResendVerification = jest.fn()
    const onReset = jest.fn()
    const { view, t } = await renderScreen({ phase: 'error', reason: 'unverified' }, { onResendVerification, onReset })
    expect(view.getByTestId('transaction-ocr-verify-email')).toBeOnTheScreen()
    expect(view.queryByText(t('transactionOcr.failures.unverified'))).toBeNull()
    expect(view.queryByTestId('transaction-ocr-verify-email-sent')).toBeNull()
    expect(view.queryByTestId('transaction-ocr-verify-email-failed')).toBeNull()

    await fireEvent.press(view.getByRole('button', { name: t('transactionOcr.verifyEmail.resend') }))
    expect(onResendVerification).toHaveBeenCalledTimes(1)
    await fireEvent.press(view.getByRole('button', { name: t('transactionOcr.tryAgain') }))
    expect(onReset).toHaveBeenCalled()
    expect(view.getByRole('button', { name: t('transactionOcr.back') })).toBeOnTheScreen()
  })

  it('disables resend while sending, then reports a sent or failed outcome', async () => {
    const sending = await renderScreen({ phase: 'error', reason: 'unverified' }, { verificationResend: 'sending' })
    expect(sending.view.getByRole('button', { name: sending.t('transactionOcr.verifyEmail.sending') })).toBeDisabled()
    sending.view.unmount()

    const sent = await renderScreen({ phase: 'error', reason: 'unverified' }, { verificationResend: 'sent' })
    expect(sent.view.getByTestId('transaction-ocr-verify-email-sent')).toBeOnTheScreen()
    expect(sent.view.queryByTestId('transaction-ocr-verify-email-failed')).toBeNull()
    sent.view.unmount()

    const failed = await renderScreen({ phase: 'error', reason: 'unverified' }, { verificationResend: 'failed' })
    expect(failed.view.getByTestId('transaction-ocr-verify-email-failed')).toBeOnTheScreen()
    expect(failed.view.getByRole('button', { name: failed.t('transactionOcr.verifyEmail.resend') })).toBeEnabled()
  })

  it('keeps the verify-email panel out of other failures', async () => {
    const { view } = await renderScreen({ phase: 'error', reason: 'access' })
    expect(view.queryByTestId('transaction-ocr-verify-email')).toBeNull()
  })

  it('shows a neutral allowance panel with Back but no retry when the daily allowance is used up', async () => {
    const onBack = jest.fn()
    const { view, t } = await renderScreen({ phase: 'error', reason: 'allowance' }, { onBack })
    expect(view.getByTestId('transaction-ocr-allowance')).toBeOnTheScreen()
    expect(view.queryByRole('alert')).toBeNull()
    expect(view.queryByRole('button', { name: t('transactionOcr.tryAgain') })).toBeNull()
    expect(view.queryByTestId('transaction-ocr-verify-email')).toBeNull()
    await fireEvent.press(view.getByRole('button', { name: t('transactionOcr.back') }))
    expect(onBack).toHaveBeenCalled()
  })

  it('keeps the allowance panel out of other failures', async () => {
    for (const reason of ['unverified', 'access', 'network'] as const) {
      const { view } = await renderScreen({ phase: 'error', reason })
      expect(view.queryByTestId('transaction-ocr-allowance')).toBeNull()
      view.unmount()
    }
  })
})
