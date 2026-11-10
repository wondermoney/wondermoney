import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { TransactionOcrRoute } from './transaction-ocr-route'

const mockReplace = jest.fn()
const mockUsePreventRemove = jest.fn((_preventRemove: boolean, _onPrevented?: (options: { data: { action: object }; repeat: () => void }) => void) => jest.fn())
const mockGetDocumentAsync = jest.fn()
const mockScan = jest.fn()
const mockConfirm = jest.fn()
const mockReject = jest.fn()
const mockReset = jest.fn()
const mockResendMutate = jest.fn()
const mockResendReset = jest.fn()
let mockResendState: { isPending: boolean; isError: boolean; data?: { status: 'sent' | 'unavailable' } } = { isPending: false, isError: false }
let mockUseAccounts: () => unknown = () => ({ data: undefined, isLoading: true })
let mockUseMetadata: () => unknown = () => ({ types: { isLoading: true }, currencies: { isLoading: true }, merchants: { isLoading: true } })
let mockOcrState: { state: { phase: string }; scan: typeof mockScan; confirm: typeof mockConfirm; reject: typeof mockReject; reset: typeof mockReset } = {
  state: { phase: 'idle' }, scan: mockScan, confirm: mockConfirm, reject: mockReject, reset: mockReset,
}

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }), usePreventRemove: (preventRemove: boolean, onPrevented?: (options: { data: { action: object }; repeat: () => void }) => void) => mockUsePreventRemove(preventRemove, onPrevented) }))
jest.mock('expo-document-picker', () => ({ getDocumentAsync: (...args: unknown[]) => mockGetDocumentAsync(...args) }))
jest.mock('@/features/accounts/use-accounts', () => ({ useAccounts: () => mockUseAccounts() }))
jest.mock('./use-manual-transaction-metadata', () => ({ useManualTransactionMetadata: () => mockUseMetadata() }))
jest.mock('@/features/auth/use-resend-verification-email', () => ({
  useResendVerificationEmail: () => ({ ...mockResendState, mutate: mockResendMutate, reset: mockResendReset }),
}))
jest.mock('./use-transaction-ocr', () => ({ useTransactionOcr: () => mockOcrState }))

async function renderRoute() {
  const i18n = await initMobileI18n('en')
  return Object.assign(await render(<I18nextProvider i18n={i18n}><TransactionOcrRoute /></I18nextProvider>), { t: i18n.t.bind(i18n) })
}

const accountsData = {
  accounts: [
    { accountKey: 7, accountName: 'Daily account', accountFinancialInstitutionKey: null, accountOwnerAppuserKey: { currencyKey: { code: 'EUR' } }, appuserCurrencyBalance: 100, balance: 100, currencyKey: { code: 'EUR' }, isOwnedByViewer: true, isPrivate: false, refreshedAt: null, source: 'manual' as const },
  ],
}
const typesData = { transactionTypes: [{ transactionTypeKey: 3, name: 'card_payment' }] }
const currenciesData = { currencies: [{ currencyKey: 2, code: 'EUR', description: null }] }

describe('TransactionOcrRoute', () => {
  beforeEach(() => {
    mockReplace.mockReset(); mockUsePreventRemove.mockClear()
    mockGetDocumentAsync.mockReset(); mockScan.mockReset(); mockConfirm.mockReset(); mockReject.mockReset(); mockReset.mockReset()
    mockUseAccounts = () => ({ data: accountsData, isLoading: false })
    mockUseMetadata = () => ({ types: { data: typesData, isLoading: false }, currencies: { data: currenciesData, isLoading: false }, merchants: { isLoading: false } })
    mockOcrState = { state: { phase: 'idle' }, scan: mockScan, confirm: mockConfirm, reject: mockReject, reset: mockReset }
    mockResendMutate.mockReset(); mockResendReset.mockReset()
    mockResendState = { isPending: false, isError: false }
  })

  it('scans the picked file with a mime type', async () => {
    mockGetDocumentAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///receipt.jpg', name: 'receipt.jpg', mimeType: 'image/jpeg' }] })
    const view = await renderRoute()
    await fireEvent.press(view.getByRole('button', { name: 'Choose receipt' }))
    expect(mockGetDocumentAsync).toHaveBeenCalledWith(expect.objectContaining({ type: expect.arrayContaining(['image/jpeg', 'application/pdf']) }))
    expect(mockScan).toHaveBeenCalledWith({ uri: 'file:///receipt.jpg', name: 'receipt.jpg', mimeType: 'image/jpeg' })
  })

  it('never scans when the picker is cancelled', async () => {
    mockGetDocumentAsync.mockResolvedValue({ canceled: true, assets: null })
    const view = await renderRoute()
    await fireEvent.press(view.getByRole('button', { name: 'Choose receipt' }))
    expect(mockScan).not.toHaveBeenCalled()
  })

  it('navigates back to accounts on back', async () => {
    const view = await renderRoute()
    await fireEvent.press(view.getByRole('button', { name: 'Back' }))
    expect(mockReplace).toHaveBeenCalledWith('/accounts')
  })

  it('guards navigation away while scanning or confirming, but not once idle', async () => {
    mockOcrState = { state: { phase: 'scanning' }, scan: mockScan, confirm: mockConfirm, reject: mockReject, reset: mockReset }
    await renderRoute()
    expect(mockUsePreventRemove.mock.lastCall?.[0]).toBe(true)

    mockOcrState = { state: { phase: 'idle' }, scan: mockScan, confirm: mockConfirm, reject: mockReject, reset: mockReset }
    await renderRoute()
    expect(mockUsePreventRemove.mock.lastCall?.[0]).toBe(false)
  })

  it('resends the verification email from an unverified-email failure', async () => {
    mockOcrState = { state: { phase: 'error', reason: 'unverified' } as { phase: string }, scan: mockScan, confirm: mockConfirm, reject: mockReject, reset: mockReset }
    const view = await renderRoute()
    await fireEvent.press(view.getByRole('button', { name: view.t('transactionOcr.verifyEmail.resend') }))
    expect(mockResendMutate).toHaveBeenCalledTimes(1)
  })

  it('maps the resend outcome onto the screen state', async () => {
    mockOcrState = { state: { phase: 'error', reason: 'unverified' } as { phase: string }, scan: mockScan, confirm: mockConfirm, reject: mockReject, reset: mockReset }
    mockResendState = { isPending: false, isError: false, data: { status: 'sent' } }
    const sent = await renderRoute()
    expect(sent.getByTestId('transaction-ocr-verify-email-sent')).toBeOnTheScreen()
    sent.unmount()

    mockResendState = { isPending: false, isError: false, data: { status: 'unavailable' } }
    const failed = await renderRoute()
    expect(failed.getByTestId('transaction-ocr-verify-email-failed')).toBeOnTheScreen()
  })

  it('clears the resend outcome when retrying', async () => {
    mockOcrState = { state: { phase: 'error', reason: 'unverified' } as { phase: string }, scan: mockScan, confirm: mockConfirm, reject: mockReject, reset: mockReset }
    const view = await renderRoute()
    await fireEvent.press(view.getByRole('button', { name: view.t('transactionOcr.tryAgain') }))
    expect(mockResendReset).toHaveBeenCalled()
    expect(mockReset).toHaveBeenCalled()
  })
})
