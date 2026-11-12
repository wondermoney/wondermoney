import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { ApiError } from '@/lib/api/errors'
import { initMobileI18n } from '@/lib/i18n'

import { TransactionImportReviewRoute, type TransactionImportReviewRouteProps } from './transaction-import-review-route'

const mockRead = jest.fn()
const mockWrite = jest.fn()
const mockBlockAccess = jest.fn()

jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 9, principalId: 'person-1', apiClient: { read: mockRead, write: mockWrite } }, blockAccess: mockBlockAccess }),
}))

const SESSION_ID = '0b3c9a52-7d3e-4c4e-9d55-6f1b2a3c4d5e'
const BASE = `/v1/transaction-import-sessions/${SESSION_ID}`
const emptyCounts = { new: 0, duplicate: 0, possible_duplicate: 0, invalid: 0, skipped: 0, imported: 0, failed: 0 }

type Row = { id: number; sourceRow: number; status: string; decision: 'import' | 'skip' | null; normalized: { amount: number; currency: string; date: string; description: string; merchant?: string } | null; error: string | null }

/** The API's session, held in memory: reads page it, writes change it, as the service does. */
function fakeServer(overrides: { status?: string; canRetry?: boolean; format?: string } = {}) {
  const state = {
    format: overrides.format ?? 'statement',
    status: overrides.status ?? 'ready',
    canRetry: overrides.canRetry ?? false,
    errorCode: null as string | null,
    rows: [
      { id: 1, sourceRow: 2, status: 'new', decision: 'import', normalized: { amount: -12.5, currency: 'EUR', date: '2026-11-03T00:00:00.000Z', description: 'CARD CAFE', merchant: 'Cafe' }, error: null },
      { id: 2, sourceRow: 3, status: 'new', decision: 'import', normalized: { amount: 1500, currency: 'EUR', date: '2026-11-01T00:00:00.000Z', description: 'Salary' }, error: null },
      { id: 3, sourceRow: 4, status: 'duplicate', decision: 'skip', normalized: { amount: -800, currency: 'EUR', date: '2026-11-01T00:00:00.000Z', description: 'Rent' }, error: null },
      { id: 4, sourceRow: 5, status: 'invalid', decision: null, normalized: null, error: 'Bad date' },
    ] as Row[],
  }
  const session = () => {
    const counts = { ...emptyCounts }
    const decisions = { import: 0, skip: 0 }
    for (const row of state.rows) {
      counts[row.status as keyof typeof counts] += 1
      if (['new', 'duplicate', 'possible_duplicate'].includes(row.status) && row.decision) decisions[row.decision] += 1
    }
    return {
      accountId: 7, accountMapping: {}, canCommit: state.status === 'ready', canRetry: state.canRetry, committedAt: null, correlationId: 'c', counts,
      createdAt: '2026-11-10T10:00:00.000Z', decisions, detailsDeletedAt: null, errorCode: state.errorCode, expiresAt: '2026-11-17T10:00:00.000Z',
      fileName: 'statement.csv', format: state.format, id: SESSION_ID, sourceAccounts: [], status: state.status, upload: null, warnings: [],
    }
  }
  /** What a commit job does: write the rows decided `import`, skip the rest. */
  const finishCommit = () => {
    for (const row of state.rows) {
      if (!['new', 'duplicate', 'possible_duplicate'].includes(row.status)) continue
      row.status = row.decision === 'import' ? 'imported' : 'skipped'
    }
    state.status = 'succeeded'
  }
  mockRead.mockImplementation(async (endpoint: { path: string; schema: { parse: (value: unknown) => unknown } }) => {
    const status = new URLSearchParams(endpoint.path.split('?')[1]).get('status')
    const items = state.rows.filter((row) => !status || row.status === status)
    return endpoint.schema.parse({ rows: { items, page: 1, pageSize: 50, total: items.length }, session: session() })
  })
  mockWrite.mockImplementation(async (endpoint: { method: string; path: string; schema: { parse: (value: unknown) => unknown } }, options: { body?: Record<string, unknown> }) => {
    const action = endpoint.path.slice(BASE.length + 1)
    if (action === 'rows') {
      const { decision, rowIds, status } = options.body as { decision: 'import' | 'skip'; rowIds?: number[]; status?: string }
      for (const row of state.rows) {
        if (!['new', 'duplicate', 'possible_duplicate'].includes(row.status)) continue
        if ((rowIds && rowIds.includes(row.id)) || (status && row.status === status)) row.decision = decision
      }
    } else if (action === 'commit') {
      state.status = 'importing'
      state.canRetry = false
    } else if (action === 'cancel') {
      state.status = 'cancelled'
    }
    return endpoint.schema.parse({ session: session() })
  })
  return { state, finishCommit, writes: () => mockWrite.mock.calls.map((call) => `${call[0].method} ${call[0].path.slice(BASE.length + 1)}`) }
}

async function renderReview(overrides: Partial<TransactionImportReviewRouteProps> = {}) {
  const i18n = await initMobileI18n('en')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = jest.spyOn(client, 'invalidateQueries')
  const props: TransactionImportReviewRouteProps = {
    sessionId: SESSION_ID,
    expiresAt: '2026-11-17T10:00:00.000Z',
    accounts: [{ id: 7, name: 'Daily account' }],
    onFinished: jest.fn(),
    onGone: jest.fn(),
    onDone: jest.fn(),
    onImportAnother: jest.fn(),
    onBack: jest.fn(),
    now: () => new Date('2026-11-12T12:00:00.000Z'),
    ...overrides,
  }
  const view = await render(<QueryClientProvider client={client}><I18nextProvider i18n={i18n}><TransactionImportReviewRoute {...props} /></I18nextProvider></QueryClientProvider>)
  return { view, props, client, invalidate }
}

const transactionInvalidations = (invalidate: jest.SpyInstance) => invalidate.mock.calls.filter(([filters]) => typeof (filters as { predicate?: unknown } | undefined)?.predicate === 'function')

describe('TransactionImportReviewRoute', () => {
  beforeEach(() => { mockRead.mockReset(); mockWrite.mockReset(); mockBlockAccess.mockReset() })

  it('writes nothing until the person taps the commit, then commits the rows they chose', async () => {
    const server = fakeServer()
    const { view, props, invalidate, client } = await renderReview()

    expect(await view.findByRole('button', { name: 'Import 2 transactions' })).toBeOnTheScreen()
    expect(view.getByRole('checkbox', { name: 'Import row 4' })).not.toBeChecked()

    // Include the duplicate, skip the salary, look at the duplicates: still nothing committed.
    await fireEvent.press(view.getByRole('checkbox', { name: 'Import row 4' }))
    await waitFor(() => expect(view.getByRole('checkbox', { name: 'Import row 4' })).toBeChecked())
    await fireEvent.press(view.getByRole('checkbox', { name: 'Import row 3' }))
    await waitFor(() => expect(view.getByRole('checkbox', { name: 'Import row 3' })).not.toBeChecked())
    await fireEvent.press(view.getByRole('tab', { name: 'Already in the account (1)' }))
    await waitFor(() => expect(view.queryByText('Cafe')).not.toBeOnTheScreen())
    await fireEvent.press(view.getByRole('tab', { name: 'All (4)' }))
    await view.findByText('Cafe')

    expect(server.writes()).toEqual([`PATCH rows`, `PATCH rows`])
    expect(server.writes()).not.toContain('POST commit')
    expect(server.state.rows.some((row) => row.status === 'imported')).toBe(false)
    expect(transactionInvalidations(invalidate)).toHaveLength(0)
    expect(props.onFinished).not.toHaveBeenCalled()

    await fireEvent.press(await view.findByRole('button', { name: 'Import 2 transactions' }))
    await waitFor(() => expect(server.writes()).toContain('POST commit'))
    expect(await view.findByRole('progressbar', { name: 'Importing… 0 of 2 transactions so far.' })).toBeOnTheScreen()

    server.finishCommit()
    // The review reads the session again every two seconds while the commit runs.
    expect(await view.findByText('2 transactions imported, 1 skipped.', {}, { timeout: 5000 })).toBeOnTheScreen()
    expect(server.state.rows.filter((row) => row.status === 'imported').map((row) => row.id)).toEqual([1, 3])
    await waitFor(() => expect(props.onFinished).toHaveBeenCalledTimes(1))
    expect(transactionInvalidations(invalidate)).toHaveLength(1)
    client.clear()
  })

  it('never commits a YNAB export, which needs its categories mapped on the web', async () => {
    const server = fakeServer({ format: 'ynab' })
    const { view, props, client } = await renderReview()
    expect(await view.findByText(/import the file on the web/)).toBeOnTheScreen()
    expect(view.queryByRole('button', { name: /^Import \d/ })).not.toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Cancel import' }))
    await waitFor(() => expect(props.onImportAnother).toHaveBeenCalled())
    expect(server.writes()).toEqual(['POST cancel'])
    client.clear()
  })

  it('includes a whole status at once', async () => {
    const server = fakeServer()
    const { view, client } = await renderReview()
    await fireEvent.press(await view.findByRole('tab', { name: 'Already in the account (1)' }))
    await fireEvent.press(await view.findByRole('button', { name: 'Include all' }))
    await waitFor(() => expect(mockWrite.mock.calls.at(-1)?.[1].body).toEqual({ decision: 'import', status: 'duplicate' }))
    expect(await view.findByRole('button', { name: 'Import 3 transactions' })).toBeOnTheScreen()
    expect(server.writes()).not.toContain('POST commit')
    client.clear()
  })

  it('resumes a commit that is already running when the person returns', async () => {
    const server = fakeServer({ status: 'importing' })
    const { view, client } = await renderReview()
    expect(await view.findByRole('progressbar', { name: 'Importing… 0 of 2 transactions so far.' })).toBeOnTheScreen()
    expect(view.queryByRole('checkbox')).not.toBeOnTheScreen()
    expect(server.writes()).toEqual([])
    client.clear()
  })

  it('carries on a commit whose job stopped', async () => {
    const server = fakeServer({ status: 'importing', canRetry: true })
    const { view, client } = await renderReview()
    await fireEvent.press(await view.findByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(server.writes()).toEqual(['POST commit']))
    expect(await view.findByRole('progressbar')).toBeOnTheScreen()
    client.clear()
  })

  it('keeps the review and says why when the commit request fails', async () => {
    const server = fakeServer()
    const { view, props, client } = await renderReview()
    const commit = await view.findByRole('button', { name: 'Import 2 transactions' })
    mockWrite.mockRejectedValueOnce(new ApiError('network'))
    await fireEvent.press(commit)
    expect(await view.findByTestId('transaction-import-review-failure')).toHaveTextContent('Check your connection and try again.')
    expect(server.state.status).toBe('ready')
    expect(view.getByRole('button', { name: 'Import 2 transactions' })).not.toBeDisabled()
    expect(props.onFinished).not.toHaveBeenCalled()

    // Tried again, it goes through.
    await fireEvent.press(view.getByRole('button', { name: 'Import 2 transactions' }))
    expect(await view.findByRole('progressbar')).toBeOnTheScreen()
    expect(view.queryByTestId('transaction-import-review-failure')).not.toBeOnTheScreen()
    client.clear()
  })

  it('shows the session as the API has it when a commit is refused for a session that expired meanwhile', async () => {
    const server = fakeServer()
    const { view, props, client } = await renderReview()
    const commit = await view.findByRole('button', { name: 'Import 2 transactions' })
    mockWrite.mockImplementationOnce(async () => {
      server.state.status = 'expired'
      throw new ApiError('http', 409)
    })
    await fireEvent.press(commit)
    expect(await view.findByText('This import expired before it was finished. Start again with the file.')).toBeOnTheScreen()
    expect(view.queryByTestId('transaction-import-review-failure')).not.toBeOnTheScreen()
    await waitFor(() => expect(props.onFinished).toHaveBeenCalled())
    client.clear()
  })

  it('reports a commit whose rows all failed without refreshing the ledger', async () => {
    const server = fakeServer()
    server.state.status = 'failed'
    for (const row of server.state.rows) if (row.status === 'new') row.status = 'failed'
    const { view, invalidate, props, client } = await renderReview()
    expect(await view.findByRole('alert')).toHaveTextContent('0 transactions imported, 0 skipped.')
    expect(view.getByText("2 rows couldn't be imported.")).toBeOnTheScreen()
    await waitFor(() => expect(props.onFinished).toHaveBeenCalled())
    expect(transactionInvalidations(invalidate)).toHaveLength(0)
    client.clear()
  })

  it('locks the review once the demo refuses a write', async () => {
    fakeServer()
    const { view, client } = await renderReview()
    await view.findByRole('checkbox', { name: 'Import row 2' })
    mockWrite.mockRejectedValueOnce(new ApiError('demo-forbidden', 403))
    await fireEvent.press(view.getByRole('checkbox', { name: 'Import row 2' }))
    expect(await view.findByText('Importing transactions is unavailable in demo mode.')).toBeOnTheScreen()
    await waitFor(() => expect(view.getByRole('checkbox', { name: 'Import row 2' })).toBeDisabled())
    // The refused change is undone: the server's decision shows again.
    expect(view.getByRole('checkbox', { name: 'Import row 2' })).toBeChecked()
    expect(view.getByRole('button', { name: 'Import 2 transactions' })).toBeDisabled()
    client.clear()
  })

  it('cancels the import and leaves it', async () => {
    const server = fakeServer()
    const { view, props, client } = await renderReview()
    await fireEvent.press(await view.findByRole('button', { name: 'Cancel import' }))
    await waitFor(() => expect(props.onImportAnother).toHaveBeenCalled())
    expect(server.writes()).toEqual(['POST cancel'])
    client.clear()
  })

  it('says a resumed session expired after seven days', async () => {
    fakeServer({ status: 'expired' })
    const { view, props, client } = await renderReview()
    expect(await view.findByText('This import expired before it was finished. Start again with the file.')).toBeOnTheScreen()
    await waitFor(() => expect(props.onFinished).toHaveBeenCalled())
    await fireEvent.press(view.getByRole('button', { name: 'Import another file' }))
    expect(props.onImportAnother).toHaveBeenCalled()
    client.clear()
  })

  it('says a session the daily sweep already deleted expired', async () => {
    mockRead.mockRejectedValue(new ApiError('http', 404))
    const { view, props, client } = await renderReview({ expiresAt: '2026-11-11T10:00:00.000Z' })
    expect(await view.findByText('This import expired before it was finished. Start again with the file.')).toBeOnTheScreen()
    expect(props.onGone).not.toHaveBeenCalled()
    client.clear()
  })

  it('forgets a session that is gone before it expired', async () => {
    mockRead.mockRejectedValue(new ApiError('http', 404))
    const { props, client } = await renderReview()
    await waitFor(() => expect(props.onGone).toHaveBeenCalled())
    client.clear()
  })

  it('maps the accounts of a file that holds several', async () => {
    const server = fakeServer({ status: 'needs_mapping' })
    mockRead.mockImplementation(async (endpoint: { schema: { parse: (value: unknown) => unknown } }) => endpoint.schema.parse({
      rows: { items: [], page: 1, pageSize: 50, total: 0 },
      session: {
        accountId: 7, accountMapping: {}, canCommit: false, canRetry: false, committedAt: null, correlationId: 'c', counts: { ...emptyCounts, new: 2 }, createdAt: '2026-11-10T10:00:00.000Z',
        decisions: { import: 2, skip: 0 }, detailsDeletedAt: null, errorCode: null, expiresAt: '2026-11-17T10:00:00.000Z', fileName: 'export.xml', format: 'camt053', id: SESSION_ID,
        sourceAccounts: [{ label: 'PT50000201231234567890154', rowCount: 2, suggestedAccountId: 7 }], status: 'needs_mapping', upload: null, warnings: [],
      },
    }))
    const { view, client } = await renderReview()
    expect(await view.findByRole('button', { name: 'Import 2 transactions' })).toBeDisabled()
    await fireEvent.press(view.getByRole('button', { name: 'Save accounts' }))
    await waitFor(() => expect(mockWrite.mock.calls.at(-1)?.[0].path).toBe(`${BASE}/account-mapping`))
    expect(mockWrite.mock.calls.at(-1)?.[1].body).toEqual({ mapping: { PT50000201231234567890154: 7 } })
    expect(server.writes()).not.toContain('POST commit')
    client.clear()
  })
})
