import { render } from '@testing-library/react-native'

import { ApiError } from '@/lib/api/errors'

import { TransactionsRoute } from './transactions-route'

const mockUseTransactions = jest.fn()
const mockMutateAsync = jest.fn()
const mockMutateAmountAsync = jest.fn()
let mockParams: { accountId?: string } = {}
const mockBlockAccess = jest.fn()
const mockPush = jest.fn()
const mockUseAccounts = jest.fn()
let mockCapturedProps: Record<string, unknown> = {}
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams, useRouter: () => ({ replace: jest.fn(), push: mockPush }) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } }) }))
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ blockAccess: mockBlockAccess }) }))
jest.mock('@/features/categories/use-categories', () => ({ useCategories: () => ({ isLoading: true }) }))
jest.mock('@/features/accounts/use-accounts', () => ({ useAccounts: () => mockUseAccounts() }))
jest.mock('./use-transactions', () => ({ useTransactions: (...args: unknown[]) => mockUseTransactions(...args) }))
jest.mock('./use-mark-reviewed', () => ({ useTransactionBulkActions: () => ({ mutateAsync: mockMutateAsync, isPending: false }) }))
jest.mock('./use-edit-transaction-amount', () => ({ useEditTransactionAmount: () => ({ mutateAsync: mockMutateAmountAsync, isPending: false }) }))
jest.mock('./transactions-screen', () => ({ TransactionsScreen: (props: { state: { status: string } }) => { mockCapturedProps = props; const Native = jest.requireActual<typeof import('react-native')>('react-native'); return <Native.Text>{props.state.status}</Native.Text> } }))

describe('TransactionsRoute', () => {
  beforeEach(() => { mockParams = {}; mockCapturedProps = {}; mockBlockAccess.mockReset(); mockUseTransactions.mockReset(); mockUseAccounts.mockReset(); mockUseAccounts.mockReturnValue({ data: { accounts: [] } }); mockMutateAsync.mockReset(); mockMutateAmountAsync.mockReset(); mockPush.mockReset() })

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
  it('maps aggregate loading without inventing a tab', async () => {
    mockUseTransactions.mockReturnValue({ isInvalidAccountId: false, isAccessTransition: false, isLoading: true, refetch: jest.fn() })
    const view = await render(<TransactionsRoute />)
    expect(view.getByText('loading')).toBeOnTheScreen()
    expect(mockUseTransactions).toHaveBeenCalledWith({}, null)
  })
  it('passes the validated nested account id and maps not found', async () => {
    mockParams = { accountId: '7' }
    mockUseTransactions.mockReturnValue({ isInvalidAccountId: false, isAccessTransition: false, isLoading: false, data: undefined, isNotFound: true, refetch: jest.fn() })
    const view = await render(<TransactionsRoute perAccount />)
    expect(mockUseTransactions).toHaveBeenCalledWith({}, 7)
    expect(view.getByText('not-found')).toBeOnTheScreen()
  })

  it.each([
    ['demo-forbidden', 'demo', undefined],
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

  it('forwards an edited description alongside the amount', async () => {
    mockUseTransactions.mockReturnValue({ isInvalidAccountId: false, isAccessTransition: false, isLoading: true, refetch: jest.fn() })
    mockMutateAmountAsync.mockResolvedValue(undefined)
    await render(<TransactionsRoute />)
    const result = await (mockCapturedProps.onEditAmount as (id: number, updatedAmount: string, description?: string) => Promise<string>)(41, '9.99', 'Corner shop groceries')
    expect(result).toBe('success')
    expect(mockMutateAmountAsync).toHaveBeenCalledWith({ transactionId: 41, updatedAmount: '9.99', description: 'Corner shop groceries' })
  })
})
