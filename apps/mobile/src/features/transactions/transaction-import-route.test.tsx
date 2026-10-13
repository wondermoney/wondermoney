import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { TransactionImportRoute } from './transaction-import-route'

const mockPush = jest.fn()
const mockReplace = jest.fn()
const mockAddListener = jest.fn((_event: string, _handler: (event: { preventDefault: () => void }) => void) => jest.fn())
const mockGetDocumentAsync = jest.fn()
const mockStart = jest.fn()
const mockReset = jest.fn()
let mockParams: Record<string, string | string[] | undefined> = {}
let mockUseAccounts: () => unknown = () => ({ data: undefined, isLoading: true })
let mockImportState: { state: { phase: string; outcome?: string; reason?: string }; start: typeof mockStart; reset: typeof mockReset } = {
  state: { phase: 'idle' }, start: mockStart, reset: mockReset,
}

jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams, useRouter: () => ({ push: mockPush, replace: mockReplace }), useNavigation: () => ({ addListener: mockAddListener }) }))
jest.mock('expo-document-picker', () => ({ getDocumentAsync: (...args: unknown[]) => mockGetDocumentAsync(...args) }))
jest.mock('@/features/accounts/use-accounts', () => ({ useAccounts: () => mockUseAccounts() }))
jest.mock('./use-transaction-import', () => ({ useTransactionImport: () => mockImportState }))

async function renderRoute() {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}><TransactionImportRoute /></I18nextProvider>)
}

const accountsData = {
  accounts: [
    { accountKey: 7, accountName: 'Daily account', accountFinancialInstitutionKey: null, accountOwnerAppuserKey: { currencyKey: { code: 'EUR' } }, appuserCurrencyBalance: 100, balance: 100, currencyKey: { code: 'EUR' }, isOwnedByViewer: true, isPrivate: false, refreshedAt: null, source: 'manual' as const },
    { accountKey: 8, accountName: null, accountFinancialInstitutionKey: null, accountOwnerAppuserKey: { currencyKey: { code: 'EUR' } }, appuserCurrencyBalance: 0, balance: 0, currencyKey: { code: 'EUR' }, isOwnedByViewer: true, isPrivate: false, refreshedAt: null, source: 'manual' as const },
  ],
}

describe('TransactionImportRoute', () => {
  beforeEach(() => {
    mockPush.mockReset(); mockReplace.mockReset(); mockAddListener.mockReset().mockReturnValue(jest.fn())
    mockGetDocumentAsync.mockReset(); mockStart.mockReset(); mockReset.mockReset()
    mockParams = {}
    mockUseAccounts = () => ({ data: accountsData, isLoading: false })
    mockImportState = { state: { phase: 'idle' }, start: mockStart, reset: mockReset }
  })

  it('lists mapped accounts, falling back to an unnamed label', async () => {
    const view = await renderRoute()
    expect(view.getByRole('button', { name: 'Daily account' })).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Unnamed account' })).toBeOnTheScreen()
  })

  it('preselects the account id from route params', async () => {
    mockParams = { accountId: '7' }
    const view = await renderRoute()
    expect(view.getByRole('button', { name: 'Choose file' })).not.toBeDisabled()
  })

  it('starts the import with the selected account and picked file', async () => {
    mockParams = { accountId: '7' }
    mockGetDocumentAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///a.csv', name: 'a.csv' }] })
    const view = await renderRoute()
    await fireEvent.press(view.getByRole('button', { name: 'Choose file' }))
    expect(mockGetDocumentAsync).toHaveBeenCalledWith(expect.objectContaining({ type: expect.arrayContaining(['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']) }))
    expect(mockStart).toHaveBeenCalledWith(7, { uri: 'file:///a.csv', name: 'a.csv' })
  })

  it('never starts the import when the picker is cancelled', async () => {
    mockParams = { accountId: '7' }
    mockGetDocumentAsync.mockResolvedValue({ canceled: true, assets: null })
    const view = await renderRoute()
    await fireEvent.press(view.getByRole('button', { name: 'Choose file' }))
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('navigates back to accounts on back and done', async () => {
    const view = await renderRoute()
    await fireEvent.press(view.getByRole('button', { name: 'Back' }))
    expect(mockReplace).toHaveBeenCalledWith('/accounts')
  })

  it('guards navigation away while an import is in flight, but not once it settles', async () => {
    mockImportState = { state: { phase: 'processing' }, start: mockStart, reset: mockReset }
    await renderRoute()
    const guard = mockAddListener.mock.calls[0]?.[1]
    const blocked = { preventDefault: jest.fn() }
    guard?.(blocked)
    expect(blocked.preventDefault).toHaveBeenCalledTimes(1)

    mockImportState = { state: { phase: 'done', outcome: 'succeeded' }, start: mockStart, reset: mockReset }
    await renderRoute()
    const allowed = { preventDefault: jest.fn() }
    const secondGuard = mockAddListener.mock.calls[1]?.[1]
    secondGuard?.(allowed)
    expect(allowed.preventDefault).not.toHaveBeenCalled()
  })
})
