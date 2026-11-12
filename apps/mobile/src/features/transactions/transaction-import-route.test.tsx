import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { TransactionImportRoute } from './transaction-import-route'

const mockPush = jest.fn()
const mockReplace = jest.fn()
const mockUsePreventRemove = jest.fn((_preventRemove: boolean, _onPrevented?: (options: { data: { action: object }; repeat: () => void }) => void) => jest.fn())
const mockGetDocumentAsync = jest.fn()
const mockStart = jest.fn()
const mockReset = jest.fn()
const mockRead = jest.fn()
const mockShareCsv = jest.fn()
const mockRemember = jest.fn()
const mockForget = jest.fn()
let mockResume: { checking: boolean; pending: { sessionId: string; expiresAt: string | null } | null } = { checking: false, pending: null }
let mockReviewProps: Record<string, unknown> | null = null
let mockParams: Record<string, string | string[] | undefined> = {}
let mockUseAccounts: () => unknown = () => ({ data: undefined, isLoading: true })
let mockImportState: { state: { phase: string; reason?: string }; start: typeof mockStart; reset: typeof mockReset } = {
  state: { phase: 'idle' }, start: mockStart, reset: mockReset,
}

jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams, useRouter: () => ({ push: mockPush, replace: mockReplace }), usePreventRemove: (preventRemove: boolean, onPrevented?: (options: { data: { action: object }; repeat: () => void }) => void) => mockUsePreventRemove(preventRemove, onPrevented) }))
jest.mock('expo-document-picker', () => ({ getDocumentAsync: (...args: unknown[]) => mockGetDocumentAsync(...args) }))
jest.mock('@/features/accounts/use-accounts', () => ({ useAccounts: () => mockUseAccounts() }))
jest.mock('./use-transaction-import', () => ({ useTransactionImport: () => mockImportState }))
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ runtime: { epochId: 9, principalId: 'person-1', apiClient: { read: mockRead } } }) }))
jest.mock('@/features/reports/report-csv-export', () => ({ shareReportCsv: (...args: unknown[]) => mockShareCsv(...args) }))
jest.mock('./transaction-import-resume', () => ({
  useTransactionImportResume: (principalId: string | null) => ({ ...mockResume, principalId, remember: mockRemember, forget: mockForget }),
}))
jest.mock('./transaction-import-review-route', () => ({
  TransactionImportReviewRoute: (props: Record<string, unknown>) => {
    mockReviewProps = props
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Text: MockText } = require('react-native') as typeof import('react-native')
    return <MockText testID="review">{`review ${String(props.sessionId)}`}</MockText>
  },
}))

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
    mockPush.mockReset(); mockReplace.mockReset(); mockUsePreventRemove.mockClear()
    mockGetDocumentAsync.mockReset(); mockStart.mockReset(); mockReset.mockReset(); mockRead.mockReset(); mockShareCsv.mockReset()
    mockRemember.mockReset(); mockForget.mockReset(); mockResume = { checking: false, pending: null }; mockReviewProps = null
    mockParams = {}
    mockUseAccounts = () => ({ data: accountsData, isLoading: false })
    mockImportState = { state: { phase: 'idle' }, start: mockStart, reset: mockReset }
  })

  it('lists mapped accounts, falling back to an unnamed label', async () => {
    const view = await renderRoute()
    await fireEvent.press(view.getByRole('button', { name: /^Account,/ }))
    expect(view.getByRole('radio', { name: 'Daily account' })).toBeOnTheScreen()
    expect(view.getByRole('radio', { name: 'Unnamed account' })).toBeOnTheScreen()
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
    mockImportState = { state: { phase: 'starting' }, start: mockStart, reset: mockReset }
    await renderRoute()
    expect(mockUsePreventRemove.mock.lastCall?.[0]).toBe(true)

    mockImportState = { state: { phase: 'error', reason: 'network' }, start: mockStart, reset: mockReset }
    await renderRoute()
    expect(mockUsePreventRemove.mock.lastCall?.[0]).toBe(false)
  })

  it('stops at review once the file is staged, and keeps the session to resume', async () => {
    mockParams = { accountId: '7' }
    mockGetDocumentAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///a.csv', name: 'a.csv' }] })
    const session = { id: '0b3c9a52-7d3e-4c4e-9d55-6f1b2a3c4d5e', expiresAt: '2026-11-19T10:00:00.000Z' }
    mockStart.mockResolvedValue(session)
    const view = await renderRoute()
    await fireEvent.press(view.getByRole('button', { name: 'Choose file' }))
    expect(await view.findByTestId('review')).toHaveTextContent(`review ${session.id}`)
    expect(mockRemember).toHaveBeenCalledWith(session)
    expect(mockReviewProps).toMatchObject({ sessionId: session.id, expiresAt: session.expiresAt, accounts: [{ id: 7, name: 'Daily account' }, { id: 8, name: 'Unnamed account' }] })
  })

  it('stays on the picker when the import stopped before staging', async () => {
    mockParams = { accountId: '7' }
    mockGetDocumentAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///a.csv', name: 'a.csv' }] })
    mockStart.mockResolvedValue(null)
    const view = await renderRoute()
    await fireEvent.press(view.getByRole('button', { name: 'Choose file' }))
    expect(view.queryByTestId('review')).not.toBeOnTheScreen()
    expect(mockRemember).not.toHaveBeenCalled()
  })

  it('resumes an unfinished import when the person returns', async () => {
    mockResume = { checking: false, pending: { sessionId: '0b3c9a52-7d3e-4c4e-9d55-6f1b2a3c4d5e', expiresAt: '2026-11-19T10:00:00.000Z' } }
    const view = await renderRoute()
    expect(await view.findByTestId('review')).toHaveTextContent('review 0b3c9a52-7d3e-4c4e-9d55-6f1b2a3c4d5e')
    expect(mockGetDocumentAsync).not.toHaveBeenCalled()
    expect(mockReviewProps).toMatchObject({ expiresAt: '2026-11-19T10:00:00.000Z' })
  })

  it('offers no new file while it looks for an unfinished import', async () => {
    mockParams = { accountId: '7' }
    mockResume = { checking: true, pending: null }
    const view = await renderRoute()
    expect(view.getByRole('button', { name: 'Choose file' })).toBeDisabled()
  })

  it('stops resuming an import once its outcome is seen, and starts over on request', async () => {
    mockResume = { checking: false, pending: { sessionId: '0b3c9a52-7d3e-4c4e-9d55-6f1b2a3c4d5e', expiresAt: null } }
    const view = await renderRoute()
    await view.findByTestId('review')
    const props = mockReviewProps as { onFinished: () => void; onImportAnother: () => void }
    await act(async () => { props.onFinished() })
    expect(mockForget).toHaveBeenCalledTimes(1)
    expect(view.getByTestId('review')).toBeOnTheScreen()

    await act(async () => { props.onImportAnother() })
    expect(mockForget).toHaveBeenCalledTimes(2)
    expect(mockReset).toHaveBeenCalled()
    expect(view.queryByTestId('review')).not.toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Choose file' })).toBeOnTheScreen()
  })

  it('forgets a finished import and leaves on done', async () => {
    mockResume = { checking: false, pending: { sessionId: '0b3c9a52-7d3e-4c4e-9d55-6f1b2a3c4d5e', expiresAt: null } }
    const view = await renderRoute()
    await view.findByTestId('review')
    await act(async () => { (mockReviewProps as { onDone: () => void }).onDone() })
    expect(mockForget).toHaveBeenCalled()
    expect(mockReplace).toHaveBeenCalledWith('/accounts')
  })

  it('keeps the session when the person leaves the review', async () => {
    mockResume = { checking: false, pending: { sessionId: '0b3c9a52-7d3e-4c4e-9d55-6f1b2a3c4d5e', expiresAt: null } }
    const view = await renderRoute()
    await view.findByTestId('review')
    await act(async () => { (mockReviewProps as { onBack: () => void }).onBack() })
    expect(mockReplace).toHaveBeenCalledWith('/accounts')
    expect(mockForget).not.toHaveBeenCalled()
  })
})
