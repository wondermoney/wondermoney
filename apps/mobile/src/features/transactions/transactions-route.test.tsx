import { act, render } from '@testing-library/react-native'

import { ApiError } from '@/lib/api/errors'

import { transactionFixture } from './test-fixtures'
import { TransactionsRoute } from './transactions-route'

const mockUseTransactions = jest.fn()
const mockMutateAsync = jest.fn()
const mockMutateAmountAsync = jest.fn()
const mockMutateTransferAsync = jest.fn()
const mockSetSplitsAsync = jest.fn()
const mockRemoveSplitsAsync = jest.fn()
const mockBulkDeleteAsync = jest.fn()
const mockDeleteOneAsync = jest.fn()
const mockUnlinkAsync = jest.fn()
let mockParams: { accountId?: string; filter?: string; focus?: string; fromDate?: string; toDate?: string } = {}
const mockBlockAccess = jest.fn()
const mockPush = jest.fn()
const mockUseAccounts = jest.fn()
let mockCapturedProps: Record<string, unknown> = {}
let mockAiHidden = false
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams, useRouter: () => ({ replace: jest.fn(), push: mockPush }) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } }) }))
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ blockAccess: mockBlockAccess }) }))
jest.mock('@/features/preferences/use-ai-hidden', () => ({ useAiHiddenPreference: () => mockAiHidden }))
jest.mock('@/features/categories/use-categories', () => ({ useCategories: () => ({ isLoading: true }) }))
const mockSetTags = jest.fn()
jest.mock('@/features/tags/use-tags', () => ({
  useTags: () => ({ isLoading: false, data: { tags: [{ tagKey: 5, name: 'Trip', color: '#ef4444' }] } }),
  useSetTransactionTags: () => ({ mutateAsync: mockSetTags, isPending: false }),
  useCreateTagForPicker: () => jest.fn(),
  toTagsState: (query: { data?: { tags: unknown[] } }) => query.data ? { status: 'loaded', tags: query.data.tags } : { status: 'error' },
}))
jest.mock('@/features/accounts/use-accounts', () => ({ useAccounts: () => mockUseAccounts() }))
jest.mock('./use-transactions', () => ({ useTransactions: (...args: unknown[]) => mockUseTransactions(...args) }))
jest.mock('./use-transactions-lead', () => ({ useTransactionsLead: () => ({ flows: { status: 'loading' }, reviewCount: { status: 'loading' } }) }))
jest.mock('./use-mark-reviewed', () => ({ useTransactionBulkActions: () => ({ mutateAsync: mockMutateAsync, isPending: false }) }))
jest.mock('./use-delete-transactions', () => ({
  ...jest.requireActual('./use-delete-transactions'),
  useDeleteTransactions: () => ({ bulk: { mutateAsync: mockBulkDeleteAsync, isPending: false }, single: { mutateAsync: mockDeleteOneAsync, isPending: false } }),
}))
jest.mock('./use-edit-transaction-amount', () => ({ useEditTransactionAmount: () => ({ mutateAsync: mockMutateAmountAsync, isPending: false }) }))
jest.mock('./use-edit-transaction-transfer', () => ({ useEditTransactionTransfer: () => ({ mutateAsync: mockMutateTransferAsync, isPending: false }) }))
jest.mock('./use-edit-transaction-attribution', () => ({ useEditTransactionAttribution: () => ({ mutateAsync: jest.fn(), isPending: false }) }))
jest.mock('@/features/household/use-household-members', () => ({ useHouseholdMembers: () => jest.requireActual('@/features/household/member-attribution').NO_HOUSEHOLD_MEMBERS }))
jest.mock('./use-transaction-splits', () => ({ useSetTransactionSplits: () => ({ mutateAsync: mockSetSplitsAsync, isPending: false }), useRemoveTransactionSplits: () => ({ mutateAsync: mockRemoveSplitsAsync, isPending: false }) }))
jest.mock('./use-transaction-reimbursements', () => ({ useUnlinkReimbursement: () => ({ mutateAsync: mockUnlinkAsync, isPending: false }) }))
jest.mock('./transaction-reimbursement-screen', () => ({ TransactionReimbursementScreen: (props: { transaction: { id: number } }) => { const Native = jest.requireActual<typeof import('react-native')>('react-native'); return <Native.Text>{`reimburse ${props.transaction.id}`}</Native.Text> } }))
jest.mock('./use-transfer-destinations', () => ({ useTransferDestinations: () => ({ accounts: [], portfolios: [{ key: 3, name: 'ETFs' }], goals: [] }) }))
type MockPromptProps = { suggestion: { fingerprint: string }; onCreate: (suggestion: unknown) => void }
const mockRuleSheets: { prompt: MockPromptProps | null; seed: unknown } = { prompt: null, seed: null }
const resetRuleSheets = () => { mockRuleSheets.prompt = null; mockRuleSheets.seed = null }
jest.mock('@/features/rules/rule-suggestion-prompt', () => ({ RuleSuggestionPrompt: (props: MockPromptProps) => { mockRuleSheets.prompt = props; return null } }))
jest.mock('@/features/rules/rule-editor-sheet', () => ({ RuleEditorSheet: (props: { seed: unknown; visible: boolean }) => { mockRuleSheets.seed = props.visible ? props.seed : null; return null } }))
jest.mock('./transactions-screen', () => ({ TransactionsScreen: (props: { state: { status: string } }) => { mockCapturedProps = props; const Native = jest.requireActual<typeof import('react-native')>('react-native'); return <Native.Text>{props.state.status}</Native.Text> } }))

describe('TransactionsRoute', () => {
  beforeEach(() => { mockParams = {}; mockCapturedProps = {}; mockAiHidden = false; mockBlockAccess.mockReset(); mockUseTransactions.mockReset(); mockUseAccounts.mockReset(); mockUseAccounts.mockReturnValue({ data: { accounts: [] } }); mockMutateAsync.mockReset(); mockMutateAmountAsync.mockReset(); mockSetSplitsAsync.mockReset(); mockRemoveSplitsAsync.mockReset(); mockUnlinkAsync.mockReset(); mockPush.mockReset() })

  it('navigates to the import screen, carrying the current account id when present', async () => {
    mockUseTransactions.mockReturnValue({ isInvalidAccountId: false, isAccessTransition: false, isLoading: true, refetch: jest.fn() })
    await render(<TransactionsRoute />)
    ;(mockCapturedProps.onImport as () => void)()
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/accounts/transactions/import' })

    mockParams = { accountId: '7' }
    await render(<TransactionsRoute perAccount />)
    ;(mockCapturedProps.onImport as () => void)()
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/accounts/transactions/import', params: { accountId: '7' } })
  })
  it('navigates to the receipt-scan screen', async () => {
    mockUseTransactions.mockReturnValue({ isInvalidAccountId: false, isAccessTransition: false, isLoading: true, refetch: jest.fn() })
    await render(<TransactionsRoute />)
    ;(mockCapturedProps.onScanReceipt as () => void)()
    expect(mockPush).toHaveBeenCalledWith('/accounts/transactions/scan')
  })
  it('hides the receipt-scan action when the person hid AI', async () => {
    mockAiHidden = true
    mockUseTransactions.mockReturnValue({ isInvalidAccountId: false, isAccessTransition: false, isLoading: true, refetch: jest.fn() })
    await render(<TransactionsRoute />)
    expect(mockCapturedProps.onScanReceipt).toBeUndefined()
  })
  it('names no account on the all-accounts list, whatever account the first row is on', async () => {
    mockUseTransactions.mockReturnValue({ isInvalidAccountId: false, isAccessTransition: false, isLoading: false, data: { transactions: [transactionFixture], total: 1, hasMore: false }, refetch: jest.fn() })
    mockUseAccounts.mockReturnValue({ data: { accounts: [{ accountKey: 7, accountName: 'Daily account' }] } })
    await render(<TransactionsRoute />)
    expect(mockCapturedProps.accountName).toBeNull()
  })
  it("names the account on a single-account list, even before it has a transaction", async () => {
    mockParams = { accountId: '7' }
    mockUseTransactions.mockReturnValue({ isInvalidAccountId: false, isAccessTransition: false, isLoading: false, data: { transactions: [], total: 0, hasMore: false }, refetch: jest.fn() })
    mockUseAccounts.mockReturnValue({ data: { accounts: [{ accountKey: 3, accountName: 'Other' }, { accountKey: 7, accountName: 'Daily account' }] } })
    await render(<TransactionsRoute perAccount />)
    expect(mockCapturedProps.accountName).toBe('Daily account')
    expect(mockCapturedProps.perAccount).toBe(true)
    expect(mockCapturedProps.lead).toBeUndefined()
  })
  it('hands the screen the accounts the caller can only view, and offers no add on a view-only ledger', async () => {
    mockParams = { accountId: '7' }
    mockUseTransactions.mockReturnValue({ isInvalidAccountId: false, isAccessTransition: false, isLoading: false, data: { transactions: [], total: 0, hasMore: false }, refetch: jest.fn() })
    mockUseAccounts.mockReturnValue({ data: { accounts: [{ accountKey: 3, accountName: 'Mine', myAccess: 'owner' }, { accountKey: 7, accountName: 'Joint', myAccess: 'read' }] } })
    await render(<TransactionsRoute perAccount />)
    expect([...(mockCapturedProps.readOnlyAccountIds as ReadonlySet<number>)]).toEqual([7])
    expect(mockCapturedProps.onCreate).toBeUndefined()
    expect(mockCapturedProps.onImport).toBeUndefined()
    expect(mockCapturedProps.onScanReceipt).toBeUndefined()
  })

  it('keeps adding on the all-accounts ledger while any account is writable, and drops it when none is', async () => {
    mockUseTransactions.mockReturnValue({ isInvalidAccountId: false, isAccessTransition: false, isLoading: false, data: { transactions: [], total: 0, hasMore: false }, refetch: jest.fn() })
    mockUseAccounts.mockReturnValue({ data: { accounts: [{ accountKey: 3, myAccess: 'write' }, { accountKey: 7, myAccess: 'read' }] } })
    const first = await render(<TransactionsRoute />)
    expect(mockCapturedProps.onCreate).toEqual(expect.any(Function))
    await first.unmount()
    mockUseAccounts.mockReturnValue({ data: { accounts: [{ accountKey: 7, myAccess: 'read' }] } })
    await render(<TransactionsRoute />)
    expect(mockCapturedProps.onCreate).toBeUndefined()
    expect(mockCapturedProps.onImport).toBeUndefined()
  })

  it('reports the oldest account refresh as the list freshness, and the lead in the owner currency', async () => {
    mockUseTransactions.mockReturnValue({ isInvalidAccountId: false, isAccessTransition: false, isLoading: false, data: { transactions: [], total: 0, hasMore: false }, refetch: jest.fn() })
    mockUseAccounts.mockReturnValue({ data: { accounts: [
      { accountKey: 1, accountName: 'A', refreshedAt: '2026-11-04T10:00:00.000Z', accountOwnerAppuserKey: { currencyKey: { code: 'EUR' } } },
      { accountKey: 2, accountName: 'B', refreshedAt: '2026-11-01T10:00:00.000Z', accountOwnerAppuserKey: { currencyKey: { code: 'EUR' } } },
      { accountKey: 3, accountName: 'Manual', refreshedAt: null, accountOwnerAppuserKey: { currencyKey: { code: 'EUR' } } },
    ] } })
    await render(<TransactionsRoute />)
    expect(mockCapturedProps.freshness).toEqual({ kind: 'updated', at: '2026-11-01T10:00:00.000Z' })
    expect(mockCapturedProps.leadCurrency).toBe('EUR')
    expect(mockCapturedProps.lead).toEqual({ flows: { status: 'loading' }, reviewCount: { status: 'loading' } })
  })
  it('maps aggregate loading without inventing a tab', async () => {
    mockUseTransactions.mockReturnValue({ isInvalidAccountId: false, isAccessTransition: false, isLoading: true, refetch: jest.fn() })
    const view = await render(<TransactionsRoute />)
    expect(view.getByText('loading')).toBeOnTheScreen()
    // Web opens on the last 60 days, so the list does too.
    expect(mockUseTransactions).toHaveBeenCalledWith({ fromDate: expect.any(String), toDate: expect.any(String) }, null)
    const [{ fromDate, toDate }] = mockUseTransactions.mock.calls[0] as [{ fromDate: string; toDate: string }]
    expect(Math.round((Date.parse(toDate) - Date.parse(fromDate)) / 86_400_000)).toBe(61)
  })
  it('opens already filtered to the review inbox when Home asks for it', async () => {
    mockParams = { filter: 'unreviewed' }
    mockUseTransactions.mockReturnValue({ isInvalidAccountId: false, isAccessTransition: false, isLoading: true, refetch: jest.fn() })
    await render(<TransactionsRoute />)
    // No date range: an unreviewed row older than the list's 60-day default must still show.
    expect(mockUseTransactions).toHaveBeenCalledWith({ limit: 100, needsReview: true }, null)
  })
  it('passes the validated nested account id and maps not found', async () => {
    mockParams = { accountId: '7' }
    mockUseTransactions.mockReturnValue({ isInvalidAccountId: false, isAccessTransition: false, isLoading: false, data: undefined, isNotFound: true, refetch: jest.fn() })
    const view = await render(<TransactionsRoute perAccount />)
    expect(mockUseTransactions).toHaveBeenCalledWith({ fromDate: expect.any(String), toDate: expect.any(String) }, 7)
    expect(view.getByText('not-found')).toBeOnTheScreen()
  })

  it.each([
    ['demo-forbidden', 'demo', undefined],
    ['account-read-only', 'account-read-only', undefined],
    ['mfa-required', 'mfa', 'mfa-required'],
    ['cancelled', 'cancelled', undefined],
    ['network', 'network', undefined],
    ['http', 'error', undefined],
  ] as const)('maps %s without replay to distinct action result %s', async (code, expected, access) => {
    mockUseTransactions.mockReturnValue({ isInvalidAccountId: false, isAccessTransition: false, isLoading: true, refetch: jest.fn() })
    mockMutateAsync.mockRejectedValue(new ApiError(code))
    await render(<TransactionsRoute />)
    const result = await (mockCapturedProps.onBulkReview as (ids: number[]) => Promise<string>)([7, 4])
    expect(result).toBe(expected)
    expect(mockMutateAsync).toHaveBeenCalledTimes(1)
    expect(mockMutateAsync).toHaveBeenCalledWith({ type: 'review', transactionIds: [7, 4] })
    if (access) expect(mockBlockAccess).toHaveBeenCalledWith(access)
    else expect(mockBlockAccess).not.toHaveBeenCalled()
  })

  it.each([
    ['demo-forbidden', 'demo', undefined],
    ['mfa-required', 'mfa', 'mfa-required'],
    ['cancelled', 'cancelled', undefined],
    ['network', 'network', undefined],
    ['http', 'error', undefined],
  ] as const)('maps %s from an amount edit to distinct result %s', async (code, expected, access) => {
    mockUseTransactions.mockReturnValue({ isInvalidAccountId: false, isAccessTransition: false, isLoading: true, refetch: jest.fn() })
    mockMutateAmountAsync.mockRejectedValue(new ApiError(code))
    await render(<TransactionsRoute />)
    const result = await (mockCapturedProps.onEditAmount as (id: number, updatedAmount: string) => Promise<string>)(41, '9.99')
    expect(result).toBe(expected)
    expect(mockMutateAmountAsync).toHaveBeenCalledTimes(1)
    expect(mockMutateAmountAsync).toHaveBeenCalledWith({ transactionId: 41, updatedAmount: '9.99' })
    if (access) expect(mockBlockAccess).toHaveBeenCalledWith(access)
    else expect(mockBlockAccess).not.toHaveBeenCalled()
  })

  it('reports amount-edit success and passes the combined pending state through', async () => {
    mockUseTransactions.mockReturnValue({ isInvalidAccountId: false, isAccessTransition: false, isLoading: true, refetch: jest.fn() })
    mockMutateAmountAsync.mockResolvedValue(undefined)
    await render(<TransactionsRoute />)
    const result = await (mockCapturedProps.onEditAmount as (id: number, updatedAmount: string) => Promise<string>)(41, '9.99')
    expect(result).toBe('success')
    expect(mockCapturedProps.pending).toBe(false)
  })

  it.each([
    [true, 'hidden'],
    [false, 'unhidden'],
  ] as const)('maps onSetHidden(%s) to a %s bulk action', async (hidden, type) => {
    mockUseTransactions.mockReturnValue({ isInvalidAccountId: false, isAccessTransition: false, isLoading: true, refetch: jest.fn() })
    mockMutateAsync.mockResolvedValue(undefined)
    await render(<TransactionsRoute />)
    const result = await (mockCapturedProps.onSetHidden as (ids: number[], hidden: boolean) => Promise<string>)([7, 4], hidden)
    expect(result).toBe('success')
    expect(mockMutateAsync).toHaveBeenCalledWith({ type, transactionIds: [7, 4] })
  })

  it('sends the list\'s filters, not ids, for every matching row, and a tag change as its own action', async () => {
    mockUseTransactions.mockReturnValue({ isInvalidAccountId: false, isAccessTransition: false, isLoading: true, refetch: jest.fn() })
    mockMutateAsync.mockResolvedValue(undefined)
    await render(<TransactionsRoute />)
    await (mockCapturedProps.onSetHidden as (scope: 'matching', hidden: boolean) => Promise<string>)('matching', true)
    // The list's own filters: the date range it opened on.
    expect(mockMutateAsync).toHaveBeenLastCalledWith({ type: 'hidden', filter: (mockUseTransactions.mock.calls.at(-1) as unknown[])[0], accountId: null })
    await (mockCapturedProps.onBulkTag as (scope: number[], tagId: number, mode: string) => Promise<string>)([7], 5, 'remove')
    expect(mockMutateAsync).toHaveBeenLastCalledWith({ type: 'removeTag', tagId: 5, transactionIds: [7] })
  })

  it('reports what a bulk delete did, with the bank rows it skipped', async () => {
    mockUseTransactions.mockReturnValue({ isInvalidAccountId: false, isAccessTransition: false, isLoading: true, refetch: jest.fn() })
    mockBulkDeleteAsync.mockResolvedValue({ deletedTransactionIds: [7], skipped: [{ reason: 'bank_synced', transactionIds: [4] }] })
    await render(<TransactionsRoute />)
    const outcome = await (mockCapturedProps.onBulkDelete as (scope: number[]) => Promise<unknown>)([7, 4])
    expect(mockBulkDeleteAsync).toHaveBeenCalledWith({ transactionIds: [7, 4] })
    expect(outcome).toEqual({ result: 'success', deletedCount: 1, skippedIds: [4] })
  })

  it('tells a bank row\'s refused delete apart from other failures', async () => {
    mockUseTransactions.mockReturnValue({ isInvalidAccountId: false, isAccessTransition: false, isLoading: true, refetch: jest.fn() })
    await render(<TransactionsRoute />)
    const deleteOne = mockCapturedProps.onDeleteOne as (id: number) => Promise<string>
    mockDeleteOneAsync.mockRejectedValueOnce(new ApiError('http', 409))
    expect(await deleteOne(41)).toBe('bank-synced')
    mockDeleteOneAsync.mockRejectedValueOnce(new ApiError('http', 500))
    expect(await deleteOne(41)).toBe('error')
    mockDeleteOneAsync.mockResolvedValueOnce(undefined)
    expect(await deleteOne(41)).toBe('success')
  })

  it('forwards an edited description alongside the amount', async () => {
    mockUseTransactions.mockReturnValue({ isInvalidAccountId: false, isAccessTransition: false, isLoading: true, refetch: jest.fn() })
    mockMutateAmountAsync.mockResolvedValue(undefined)
    await render(<TransactionsRoute />)
    const result = await (mockCapturedProps.onEditAmount as (id: number, updatedAmount: string, description?: string) => Promise<string>)(41, '9.99', 'Corner shop groceries')
    expect(result).toBe('success')
    expect(mockMutateAmountAsync).toHaveBeenCalledWith({ transactionId: 41, updatedAmount: '9.99', description: 'Corner shop groceries' })
  })
  it('passes the household tags through and maps a tag change to its result', async () => {
    mockUseTransactions.mockReturnValue({ isInvalidAccountId: false, isAccessTransition: false, isLoading: true, refetch: jest.fn() })
    mockSetTags.mockReset()
    mockSetTags.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new ApiError('demo-forbidden'))
    await render(<TransactionsRoute />)
    expect(mockCapturedProps.tags).toEqual({ status: 'loaded', tags: [{ tagKey: 5, name: 'Trip', color: '#ef4444' }] })
    const setTags = mockCapturedProps.onSetTags as (id: number, tagIds: readonly number[]) => Promise<string>
    await expect(setTags(41, [5])).resolves.toBe('success')
    expect(mockSetTags).toHaveBeenCalledWith({ transactionId: 41, tagIds: [5] })
    await expect(setTags(41, [])).resolves.toBe('demo')
  })

  it('passes transfer destinations through and maps a transfer change to its result', async () => {
    mockUseTransactions.mockReturnValue({ isInvalidAccountId: false, isAccessTransition: false, isLoading: true, refetch: jest.fn() })
    mockMutateTransferAsync.mockReset()
    mockMutateTransferAsync.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new ApiError('demo-forbidden'))
    await render(<TransactionsRoute />)
    expect(mockCapturedProps.transferDestinations).toEqual({ accounts: [], portfolios: [{ key: 3, name: 'ETFs' }], goals: [] })
    const setTransfer = mockCapturedProps.onSetTransfer as (draft: object) => Promise<string>
    const draft = { transactionId: 41, direction: 'debit', transfer: true, destination: { type: 'portfolio', key: 3 } }
    await expect(setTransfer(draft)).resolves.toBe('success')
    expect(mockMutateTransferAsync).toHaveBeenCalledWith(draft)
    await expect(setTransfer(draft)).resolves.toBe('demo')
  })

  it('offers the rule a recategorization suggests, and opens the editor pre-filled with it', async () => {
    mockUseTransactions.mockReturnValue({ isInvalidAccountId: false, isAccessTransition: false, isLoading: true, refetch: jest.fn() })
    const ruleSuggestion = {
      category: { categoryKey: 9, name: 'Family' },
      fingerprint: 'f'.repeat(64),
      matchCount: 3,
      rule: { name: 'TRF MB WAY', match: 'all', conditions: [{ field: 'description', operator: 'starts_with', source: 'cleaned', value: 'TRF MB WAY' }], actions: [{ type: 'set_category', categoryId: 9 }] },
      windowDays: 90,
    }
    mockMutateAsync.mockResolvedValue({ ruleSuggestion })
    resetRuleSheets()
    const view = await render(<TransactionsRoute />)

    await act(async () => { await expect((mockCapturedProps.onAssignCategory as (ids: number[], categoryId: number) => Promise<string>)([7, 4], 9)).resolves.toBe('success') })
    expect(mockRuleSheets.prompt?.suggestion).toEqual(ruleSuggestion)

    await act(async () => { mockRuleSheets.prompt?.onCreate(ruleSuggestion) })
    expect(mockRuleSheets.seed).toMatchObject({ name: 'TRF MB WAY', conditions: [{ field: 'description', operator: 'starts_with', value: 'TRF MB WAY' }], actions: [{ type: 'set_category', categoryId: '9' }] })
    view.unmount()
  })

  it('maps a saved split and a removed split to their results', async () => {
    mockUseTransactions.mockReturnValue({ isInvalidAccountId: false, isAccessTransition: false, isLoading: true, refetch: jest.fn() })
    mockSetSplitsAsync.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new ApiError('demo-forbidden'))
    mockRemoveSplitsAsync.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new ApiError('network'))
    await render(<TransactionsRoute />)
    const saveSplit = mockCapturedProps.onSaveSplit as (id: number, lines: readonly object[]) => Promise<string>
    const removeSplit = mockCapturedProps.onRemoveSplit as (id: number) => Promise<string>
    const lines = [{ categoryId: 3, amount: '-60', notes: null }, { categoryId: null, amount: '-40', notes: null }]
    await expect(saveSplit(41, lines)).resolves.toBe('success')
    expect(mockSetSplitsAsync).toHaveBeenCalledWith({ transactionId: 41, lines })
    await expect(saveSplit(41, lines)).resolves.toBe('demo')
    await expect(removeSplit(41)).resolves.toBe('success')
    expect(mockRemoveSplitsAsync).toHaveBeenCalledWith(41)
    await expect(removeSplit(41)).resolves.toBe('network')
  })

  it('maps an unlink to its result, by the API’s reason', async () => {
    mockUseTransactions.mockReturnValue({ isInvalidAccountId: false, isAccessTransition: false, isLoading: true, refetch: jest.fn() })
    mockUnlinkAsync
      .mockResolvedValueOnce({ transactionReimbursementKey: 5 })
      .mockRejectedValueOnce(new ApiError('http', 404, { serverCode: 'not_found' }))
      .mockRejectedValueOnce(new ApiError('demo-forbidden', 403))
    await render(<TransactionsRoute />)
    const unlink = mockCapturedProps.onUnlinkReimbursement as (transactionId: number, linkId: number) => Promise<string>
    await expect(unlink(41, 5)).resolves.toBe('success')
    expect(mockUnlinkAsync).toHaveBeenCalledWith({ transactionId: 41, transactionReimbursementKey: 5 })
    await expect(unlink(41, 5)).resolves.toBe('not-found')
    await expect(unlink(41, 5)).resolves.toBe('demo')
  })

  it('opens "Mark as reimbursement" over the list for the chosen row', async () => {
    mockUseTransactions.mockReturnValue({ isInvalidAccountId: false, isAccessTransition: false, isLoading: false, data: { transactions: [{ ...transactionFixture, transactionKey: 90 }] }, refetch: jest.fn() })
    const view = await render(<TransactionsRoute />)
    expect(view.queryByText('reimburse 90')).not.toBeOnTheScreen()
    await act(async () => { (mockCapturedProps.onMarkReimbursement as (row: { id: number }) => void)({ id: 90 }) })
    expect(view.getByText('reimburse 90')).toBeOnTheScreen()
  })

  it('follows a link to a row that is not loaded into its account’s ledger, on its own day', async () => {
    mockUseTransactions.mockReturnValue({ isInvalidAccountId: false, isAccessTransition: false, isLoading: true, refetch: jest.fn() })
    await render(<TransactionsRoute />)
    const open = mockCapturedProps.onOpenTransaction as (linked: object) => void
    open({ transactionKey: 90, accountKey: 8, accountName: 'Card', description: null, merchantName: 'Shop', transactionDate: '2026-07-18T10:00:00.000Z', settlementAmount: 20, currencyCode: 'EUR' })
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/accounts/[accountId]/transactions',
      params: expect.objectContaining({ accountId: '8', focus: '90', fromDate: expect.any(String), toDate: expect.any(String) }),
    })
    open({ transactionKey: 91, accountKey: null, accountName: null, description: null, merchantName: null, transactionDate: null, settlementAmount: null, currencyCode: null })
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/accounts/transactions', params: { focus: '91' } })
  })

  it('opens on a followed link’s day, in both directions, with that row expanded', async () => {
    mockUseTransactions.mockReturnValue({ isInvalidAccountId: false, isAccessTransition: false, isLoading: true, refetch: jest.fn() })
    mockParams = { accountId: '8', focus: '90', fromDate: '2026-07-17T23:00:00.000Z', toDate: '2026-07-18T22:59:59.999Z' }
    await render(<TransactionsRoute perAccount />)
    expect(mockUseTransactions).toHaveBeenCalledWith({ fromDate: '2026-07-17T23:00:00.000Z', toDate: '2026-07-18T22:59:59.999Z', limit: 100 }, 8)
    expect(mockCapturedProps.focusTransactionId).toBe(90)
  })
})
