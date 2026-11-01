import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { TransactionImportRoute } from './transaction-import-route'

const mockPush = jest.fn()
const mockReplace = jest.fn()
const mockAddListener = jest.fn((_event: string, _handler: (event: { preventDefault: () => void }) => void) => jest.fn())
const mockGetDocumentAsync = jest.fn()
const mockStart = jest.fn()
const mockReset = jest.fn()
const mockRead = jest.fn()
const mockShareCsv = jest.fn()
let mockParams: Record<string, string | string[] | undefined> = {}
let mockUseAccounts: () => unknown = () => ({ data: undefined, isLoading: true })
let mockImportState: { state: { phase: string; outcome?: string; reason?: string }; start: typeof mockStart; reset: typeof mockReset } = {
  state: { phase: 'idle' }, start: mockStart, reset: mockReset,
}

jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams, useRouter: () => ({ push: mockPush, replace: mockReplace }), useNavigation: () => ({ addListener: mockAddListener }) }))
jest.mock('expo-document-picker', () => ({ getDocumentAsync: (...args: unknown[]) => mockGetDocumentAsync(...args) }))
jest.mock('@/features/accounts/use-accounts', () => ({ useAccounts: () => mockUseAccounts() }))
jest.mock('./use-transaction-import', () => ({ useTransactionImport: () => mockImportState }))
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: 9, apiClient: { read: mockRead } } }) }))
jest.mock('@/features/reports/report-csv-export', () => ({ shareReportCsv: (...args: unknown[]) => mockShareCsv(...args) }))

async function renderRoute() {
  const i18n = await initMobileI18n('en')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><I18nextProvider i18n={i18n}><TransactionImportRoute /></I18nextProvider></QueryClientProvider>)
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
    mockGetDocumentAsync.mockReset(); mockStart.mockReset(); mockReset.mockReset(); mockRead.mockReset(); mockShareCsv.mockReset()
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

  it('offers a generic account the CSV-only picker and shares a template with the instance\'s type codes', async () => {
    mockParams = { accountId: '7' }
    mockUseAccounts = () => ({ data: { accounts: [{ ...accountsData.accounts[0], csvImportFormat: 'generic' as const }] }, isLoading: false })
    mockRead.mockResolvedValue({ transactionTypes: [{ transactionTypeKey: 3, name: 'PAYMENT' }] })
    mockShareCsv.mockResolvedValue(undefined)
    mockGetDocumentAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///a.csv', name: 'a.csv' }] })
    const view = await renderRoute()

    await waitFor(() => expect(mockRead).toHaveBeenCalledWith(expect.objectContaining({ path: '/v1/account/transaction-types' })))
    await fireEvent.press(view.getByRole('button', { name: 'Share template' }))
    expect(mockShareCsv).toHaveBeenCalledWith(expect.stringContaining('date,amount,merchant,internalTransactionId,transactionTypeKey,description'), 'transactions-template.csv')

    await fireEvent.press(view.getByRole('button', { name: 'Choose file' }))
    const pickerTypes = mockGetDocumentAsync.mock.calls[0]?.[0].type as string[]
    expect(pickerTypes).toContain('text/csv')
    expect(pickerTypes).not.toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(mockStart).toHaveBeenCalledWith(7, { uri: 'file:///a.csv', name: 'a.csv' })
  })

  it('does not open the picker for an account whose format this build does not know', async () => {
    mockParams = { accountId: '7' }
    mockUseAccounts = () => ({ data: { accounts: [{ ...accountsData.accounts[0], csvImportFormat: 'unknown' as const }] }, isLoading: false })
    const view = await renderRoute()
    expect(view.getByRole('button', { name: 'Choose file' })).toBeDisabled()
    expect(mockGetDocumentAsync).not.toHaveBeenCalled()
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
