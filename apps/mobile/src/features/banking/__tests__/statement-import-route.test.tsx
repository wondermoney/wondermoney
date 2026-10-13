import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { StatementImportRoute } from '../statement-import-route'

const mockReplace = jest.fn()
const mockBack = jest.fn()
const mockCanGoBack = jest.fn().mockReturnValue(true)
const mockAddListener = jest.fn((_event: string, _handler: (event: { preventDefault: () => void }) => void) => jest.fn())
const mockGetDocumentAsync = jest.fn()
const mockStart = jest.fn()
const mockReset = jest.fn()
const mockRefetch = jest.fn()

let mockAccounts: { data?: unknown; isLoading: boolean; error: unknown; refetch: typeof mockRefetch } = {
  data: undefined, isLoading: true, error: null, refetch: mockRefetch,
}
let mockImportState: { state: { phase: string; summary?: unknown; reason?: string }; start: typeof mockStart; reset: typeof mockReset } = {
  state: { phase: 'idle' }, start: mockStart, reset: mockReset,
}

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: mockBack, canGoBack: mockCanGoBack }),
  useNavigation: () => ({ addListener: mockAddListener }),
}))
jest.mock('expo-document-picker', () => ({ getDocumentAsync: (...args: unknown[]) => mockGetDocumentAsync(...args) }))
jest.mock('@/features/accounts/use-accounts', () => ({ useAccounts: () => mockAccounts }))
jest.mock('../use-statement-import', () => ({ useStatementImport: () => mockImportState }))

async function renderRoute() {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}><StatementImportRoute /></I18nextProvider>)
}

describe('StatementImportRoute', () => {
  beforeEach(() => {
    mockReplace.mockReset(); mockBack.mockReset(); mockCanGoBack.mockReset().mockReturnValue(true)
    mockAddListener.mockReset().mockReturnValue(jest.fn())
    mockGetDocumentAsync.mockReset(); mockStart.mockReset(); mockReset.mockReset(); mockRefetch.mockReset()
    mockAccounts = { data: undefined, isLoading: true, error: null, refetch: mockRefetch }
    mockImportState = { state: { phase: 'idle' }, start: mockStart, reset: mockReset }
  })

  it('shows an account loading state before the accounts query resolves', async () => {
    const view = await renderRoute()
    expect(view.getByText('Loading your accounts')).toBeOnTheScreen()
  })

  it('lists real accounts once loaded and starts the import with the selected account and picked file', async () => {
    mockAccounts = { data: { accounts: [{ accountKey: 5, accountName: 'Checking' }] }, isLoading: false, error: null, refetch: mockRefetch }
    mockGetDocumentAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///a.csv', name: 'a.csv' }] })
    const view = await renderRoute()
    await fireEvent.press(view.getByRole('radio', { name: 'Checking' }))
    await fireEvent.press(view.getByRole('button', { name: 'Choose a CSV file' }))
    expect(mockGetDocumentAsync).toHaveBeenCalledWith(expect.objectContaining({ type: expect.arrayContaining(['text/csv']) }))
    expect(mockStart).toHaveBeenCalledWith(5, { uri: 'file:///a.csv', name: 'a.csv' })
  })

  it('never starts an import without a selected account', async () => {
    mockAccounts = { data: { accounts: [{ accountKey: 5, accountName: 'Checking' }] }, isLoading: false, error: null, refetch: mockRefetch }
    const view = await renderRoute()
    await fireEvent.press(view.getByRole('button', { name: 'Choose a CSV file' }))
    expect(mockGetDocumentAsync).not.toHaveBeenCalled()
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('never starts an import when the picker is cancelled', async () => {
    mockAccounts = { data: { accounts: [{ accountKey: 5, accountName: 'Checking' }] }, isLoading: false, error: null, refetch: mockRefetch }
    mockGetDocumentAsync.mockResolvedValue({ canceled: true, assets: null })
    const view = await renderRoute()
    await fireEvent.press(view.getByRole('radio', { name: 'Checking' }))
    await fireEvent.press(view.getByRole('button', { name: 'Choose a CSV file' }))
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('retries the accounts query from the failure state', async () => {
    mockAccounts = { data: undefined, isLoading: false, error: new Error('boom'), refetch: mockRefetch }
    const view = await renderRoute()
    await fireEvent.press(view.getByRole('button', { name: 'Retry' }))
    expect(mockRefetch).toHaveBeenCalledTimes(1)
  })

  it('goes back through router.back when history exists', async () => {
    const view = await renderRoute()
    await fireEvent.press(view.getByRole('button', { name: 'Back' }))
    expect(mockBack).toHaveBeenCalledTimes(1)
  })

  it('falls back to replacing the banking hub when there is no history', async () => {
    mockCanGoBack.mockReturnValue(false)
    const view = await renderRoute()
    await fireEvent.press(view.getByRole('button', { name: 'Back' }))
    expect(mockReplace).toHaveBeenCalledWith('/more/banking')
  })

  it('guards navigation away while an import is in flight, but not once it settles', async () => {
    mockImportState = { state: { phase: 'processing' }, start: mockStart, reset: mockReset }
    await renderRoute()
    const guard = mockAddListener.mock.calls[0]?.[1]
    const blocked = { preventDefault: jest.fn() }
    guard?.(blocked)
    expect(blocked.preventDefault).toHaveBeenCalledTimes(1)

    mockImportState = { state: { phase: 'succeeded', summary: undefined }, start: mockStart, reset: mockReset }
    await renderRoute()
    const allowed = { preventDefault: jest.fn() }
    const secondGuard = mockAddListener.mock.calls[1]?.[1]
    secondGuard?.(allowed)
    expect(allowed.preventDefault).not.toHaveBeenCalled()
  })
})
