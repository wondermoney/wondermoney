import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { TransactionOcrRoute } from './transaction-ocr-route'

const mockReplace = jest.fn()
const mockAddListener = jest.fn((_event: string, _handler: (event: { preventDefault: () => void }) => void) => jest.fn())
const mockGetDocumentAsync = jest.fn()
const mockScan = jest.fn()
const mockConfirm = jest.fn()
const mockReject = jest.fn()
const mockReset = jest.fn()
let mockUseAccounts: () => unknown = () => ({ data: undefined, isLoading: true })
let mockUseMetadata: () => unknown = () => ({ types: { isLoading: true }, currencies: { isLoading: true }, merchants: { isLoading: true } })
let mockOcrState: { state: { phase: string }; scan: typeof mockScan; confirm: typeof mockConfirm; reject: typeof mockReject; reset: typeof mockReset } = {
  state: { phase: 'idle' }, scan: mockScan, confirm: mockConfirm, reject: mockReject, reset: mockReset,
}

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace }), useNavigation: () => ({ addListener: mockAddListener }) }))
jest.mock('expo-document-picker', () => ({ getDocumentAsync: (...args: unknown[]) => mockGetDocumentAsync(...args) }))
jest.mock('@/features/accounts/use-accounts', () => ({ useAccounts: () => mockUseAccounts() }))
jest.mock('./use-manual-transaction-metadata', () => ({ useManualTransactionMetadata: () => mockUseMetadata() }))
jest.mock('./use-transaction-ocr', () => ({ useTransactionOcr: () => mockOcrState }))

async function renderRoute() {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}><TransactionOcrRoute /></I18nextProvider>)
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
    mockReplace.mockReset(); mockAddListener.mockReset().mockReturnValue(jest.fn())
    mockGetDocumentAsync.mockReset(); mockScan.mockReset(); mockConfirm.mockReset(); mockReject.mockReset(); mockReset.mockReset()
    mockUseAccounts = () => ({ data: accountsData, isLoading: false })
    mockUseMetadata = () => ({ types: { data: typesData, isLoading: false }, currencies: { data: currenciesData, isLoading: false }, merchants: { isLoading: false } })
    mockOcrState = { state: { phase: 'idle' }, scan: mockScan, confirm: mockConfirm, reject: mockReject, reset: mockReset }
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
    const guard = mockAddListener.mock.calls[0]?.[1]
    const blocked = { preventDefault: jest.fn() }
    guard?.(blocked)
    expect(blocked.preventDefault).toHaveBeenCalledTimes(1)

    mockOcrState = { state: { phase: 'idle' }, scan: mockScan, confirm: mockConfirm, reject: mockReject, reset: mockReset }
    await renderRoute()
    const allowed = { preventDefault: jest.fn() }
    const secondGuard = mockAddListener.mock.calls[1]?.[1]
    secondGuard?.(allowed)
    expect(allowed.preventDefault).not.toHaveBeenCalled()
  })
})
