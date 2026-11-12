import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'

import { ApiError } from '@/lib/api/errors'
import { initMobileI18n } from '@/lib/i18n'

import { PendingChangesRoute } from './pending-changes-route'
import type { ProposalDto } from './proposals-contract'

const mockRead = jest.fn()
const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), canGoBack: () => true, replace: jest.fn() }) }))
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ blockAccess: mockBlockAccess, runtime: { epochId: 3, apiClient: { read: mockRead, write: mockWrite } } }),
}))

const categorize: ProposalDto = {
  id: 11,
  kind: 'categorize_transactions',
  source: 'mcp',
  status: 'pending',
  summary: 'Categorize 2 transactions as Groceries',
  createdAt: '2026-11-10T10:00:00.000Z',
  expiresAt: '2026-11-17T10:00:00.000Z',
  decidedAt: null,
  failureReason: null,
  changes: [
    { transactionId: 1, description: 'Corner shop', transactionDate: '2026-11-08', field: 'category', before: null, after: 'Groceries' },
    { transactionId: 2, description: 'Market', transactionDate: '2026-11-09', field: 'category', before: 'Dining out', after: 'Groceries' },
  ],
  unavailableCount: 0,
}

const note: ProposalDto = {
  ...categorize,
  id: 12,
  kind: 'update_transaction_note',
  source: 'assistant',
  summary: 'Update the note',
  changes: [{ transactionId: 3, description: 'Rent', transactionDate: '2026-11-01', field: 'note', before: null, after: 'November rent' }],
}

let preferences = { aiHidden: false, previewFeatures: false, dashboardLayout: [] }
let proposals: ProposalDto[] = []

async function renderRoute() {
  const i18n = await initMobileI18n('en')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}><I18nextProvider i18n={i18n}>{children}</I18nextProvider></QueryClientProvider>
  )
  return { client, view: await render(<PendingChangesRoute />, { wrapper }) }
}

describe('PendingChangesRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    preferences = { aiHidden: false, previewFeatures: false, dashboardLayout: [] }
    proposals = [categorize, note]
    mockRead.mockImplementation(async (endpoint: { path: string }) => {
      if (endpoint.path === '/v1/user/me/preferences') return preferences
      if (endpoint.path.startsWith('/v1/assistant/proposals')) return { proposals }
      throw new Error(`unexpected read ${endpoint.path}`)
    })
  })

  it('lists each pending proposal with its translated title, source and before → after rows', async () => {
    const { view } = await renderRoute()

    expect(await view.findByText('Categorize 2 transactions as Groceries')).toBeOnTheScreen()
    expect(view.getByText(/From an MCP client/u)).toBeOnTheScreen()
    expect(view.getByLabelText('Corner shop: Uncategorized to Groceries')).toBeOnTheScreen()
    expect(view.getByLabelText('Market: Dining out to Groceries')).toBeOnTheScreen()
    expect(view.getByText('Update the note on a transaction')).toBeOnTheScreen()
    expect(view.getByText(/From the assistant/u)).toBeOnTheScreen()
    expect(view.getByLabelText('Rent: No note to November rent')).toBeOnTheScreen()
    expect(mockRead).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', path: '/v1/assistant/proposals?status=pending&limit=100' }))
  })

  it('applies a proposal, then refreshes the proposals and the transaction lists', async () => {
    mockWrite.mockImplementation(async (_endpoint, options: { commit: (value: unknown) => void }) => {
      proposals = [note]
      options.commit({ proposal: { ...categorize, status: 'applied' } })
      return { proposal: { ...categorize, status: 'applied' } }
    })
    const { client, view } = await renderRoute()
    const invalidate = jest.spyOn(client, 'invalidateQueries')

    await fireEvent.press(await view.findByRole('button', { name: 'Apply: Categorize 2 transactions as Groceries' }))

    expect(mockWrite).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST', path: '/v1/assistant/proposals/11/apply' }), expect.any(Object))
    await waitFor(() => expect(view.queryByText('Categorize 2 transactions as Groceries')).toBeNull())
    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['assistant-proposals', 3, 'pending'] }))
    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['transactions', 3] }))
  })

  it('dismisses a proposal without touching the transaction lists', async () => {
    mockWrite.mockImplementation(async (_endpoint, options: { commit: (value: unknown) => void }) => {
      proposals = [categorize]
      options.commit({ proposal: { ...note, status: 'rejected' } })
      return { proposal: { ...note, status: 'rejected' } }
    })
    const { client, view } = await renderRoute()
    const invalidate = jest.spyOn(client, 'invalidateQueries')

    await fireEvent.press(await view.findByRole('button', { name: 'Dismiss: Update the note on a transaction' }))

    expect(mockWrite).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST', path: '/v1/assistant/proposals/12/reject' }), expect.any(Object))
    await waitFor(() => expect(view.queryByText('Update the note on a transaction')).toBeNull())
    expect(invalidate).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['transactions', 3] }))
  })

  it('says a change can no longer be applied on a 409 and refetches the list', async () => {
    mockWrite.mockImplementation(async () => {
      proposals = [note]
      throw new ApiError('http', 409)
    })
    const { view } = await renderRoute()

    await fireEvent.press(await view.findByRole('button', { name: 'Apply: Categorize 2 transactions as Groceries' }))

    expect(await view.findByText(/That change can no longer be applied/u)).toBeOnTheScreen()
    await waitFor(() => expect(view.queryByText('Categorize 2 transactions as Groceries')).toBeNull())
  })

  it('shows the empty state when nothing is waiting', async () => {
    proposals = []
    const { view } = await renderRoute()

    expect(await view.findByText(/No pending changes/u)).toBeOnTheScreen()
  })

  it('shows no proposals, and never asks for them, when the person hid AI', async () => {
    preferences = { ...preferences, aiHidden: true }
    const { view } = await renderRoute()

    expect(await view.findByText(/AI features are hidden for your account/u)).toBeOnTheScreen()
    expect(view.queryByText('Categorize 2 transactions as Groceries')).toBeNull()
    expect(mockRead).not.toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringContaining('/v1/assistant/proposals') }))
  })
})
