import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api/errors'

import { BudgetAddCategoryRoute } from './budget-add-category-route'
import { BudgetCreateRoute } from './budget-create-route'
import type { BudgetAddCategoryWrite, BudgetCreateWrite } from './budgets-contract'
import { budgetFixture } from './test-fixtures'

const mockCreatePayload: BudgetCreateWrite = { houseHoldSize: 2, dependentsNum: 0, incomes: [] }
const mockCategoryPayload: BudgetAddCategoryWrite = { categoryKey: 12, amountBudgeted: 80, recurrency: 'MONTHLY' }
const mockCreate = { isPending: false, mutateAsync: jest.fn() }
const mockAddCategory = { isPending: false, mutateAsync: jest.fn() }
const mockInventory = jest.fn()
const mockUseBudgets = jest.fn()
const mockUseBudgetMonth = jest.fn()
const mockRead = jest.fn()
const mockReplace = jest.fn()
const mockAddListener = jest.fn(() => jest.fn())

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ budgetId: '7' }),
  useNavigation: () => ({ addListener: mockAddListener }),
  useRouter: () => ({ replace: mockReplace }),
}))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } }) }))
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ runtime: { epochId: 8, apiClient: { read: mockRead } } }),
}))
jest.mock('@/features/categories/categories-view-model', () => ({ mapCategories: () => [{ id: 12, name: 'Power', children: [] }] }))
jest.mock('@/features/categories/use-categories', () => ({ useCategories: () => ({ data: { categories: [] }, isLoading: false, isError: false, isAccessTransition: false, refetch: jest.fn() }) }))
jest.mock('./use-budget-inventory', () => ({ useBudgetInventory: () => mockInventory() }))
jest.mock('./use-budgets', () => ({ useBudgets: () => mockUseBudgets() }))
jest.mock('./use-budget-month', () => ({ useBudgetMonth: () => mockUseBudgetMonth() }))
jest.mock('./use-create-budget', () => {
  const actual = jest.requireActual<typeof import('./use-create-budget')>('./use-create-budget')
  return { ...actual, useCreateBudget: () => mockCreate }
})
jest.mock('./use-add-budget-category', () => {
  const actual = jest.requireActual<typeof import('./use-add-budget-category')>('./use-add-budget-category')
  return { ...actual, useAddBudgetCategory: () => mockAddCategory }
})
jest.mock('./budget-create-screen', () => ({
  BudgetCreateScreen: (props: { candidates: readonly { id: number }[] | null; reconciliationFailed: boolean; failure: string | null; onSubmit: (value: BudgetCreateWrite) => Promise<void>; onCreateAnother: () => void }) => {
    const Native = jest.requireActual<typeof import('react-native')>('react-native')
    return <><Native.Text>{`create:${props.failure ?? 'none'}:${props.reconciliationFailed ? 'failed' : props.candidates?.map((item) => item.id).join(',') ?? 'open'}`}</Native.Text><Native.Pressable accessibilityRole="button" accessibilityLabel="Submit create" onPress={() => void props.onSubmit(mockCreatePayload)} /><Native.Pressable accessibilityRole="button" accessibilityLabel="Create another test" onPress={props.onCreateAnother} /></>
  },
}))
jest.mock('./budget-add-category-screen', () => ({
  BudgetAddCategoryScreen: (props: { failure: string | null; reconciliation: string | null; onSubmit: (value: BudgetAddCategoryWrite) => Promise<void>; onNewAttempt: () => void }) => {
    const Native = jest.requireActual<typeof import('react-native')>('react-native')
    return <><Native.Text>{`category:${props.failure ?? 'none'}:${props.reconciliation ?? 'open'}`}</Native.Text><Native.Pressable accessibilityRole="button" accessibilityLabel="Submit category" onPress={() => void props.onSubmit(mockCategoryPayload)} /><Native.Pressable accessibilityRole="button" accessibilityLabel="New category attempt" onPress={props.onNewAttempt} /></>
  },
}))

const wrapper = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('cancelled budget creation reconciliation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCreate.isPending = false
    mockCreate.mutateAsync.mockRejectedValue(new ApiError('cancelled'))
    mockInventory.mockReturnValue({ data: { budgets: [{ budgetKey: 7, name: 'Existing', budgetTemplates: [] }] }, isLoading: false, isError: false })
    mockRead.mockImplementation(async (endpoint: { path: string }) => endpoint.path === '/v1/budget/full'
      ? { budgets: [budgetFixture] }
      : { budgets: [{ budgetKey: 7, name: 'Existing', budgetTemplates: [] }, { budgetKey: 9, name: 'Candidate', budgetTemplates: [] }] })
  })

  it('refreshes inventory and full list, retains the payload, and blocks resubmit until Create another', async () => {
    const view = await render(<BudgetCreateRoute />, { wrapper })
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Submit create' })) })
    await waitFor(() => expect(view.getByText('create:unknown:9')).toBeOnTheScreen())
    expect(mockRead.mock.calls.map(([endpoint]) => endpoint.path)).toEqual(expect.arrayContaining(['/v1/budget', '/v1/budget/full']))
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Submit create' })) })
    expect(mockCreate.mutateAsync).toHaveBeenCalledTimes(1)
    expect(mockCreate.mutateAsync).toHaveBeenCalledWith(mockCreatePayload)
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Create another test' })) })
    await waitFor(() => expect(view.getByText('create:none:open')).toBeOnTheScreen())
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Submit create' })) })
    await waitFor(() => expect(mockCreate.mutateAsync).toHaveBeenCalledTimes(2))
    expect(mockCreate.mutateAsync).toHaveBeenLastCalledWith(mockCreatePayload)
  })

  it('keeps creation blocked when either authoritative refresh fails', async () => {
    mockRead.mockImplementation(async (endpoint: { path: string }) => {
      if (endpoint.path === '/v1/budget/full') throw new ApiError('network')
      return { budgets: [{ budgetKey: 7, name: 'Existing', budgetTemplates: [] }] }
    })
    const view = await render(<BudgetCreateRoute />, { wrapper })
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Submit create' })) })
    await waitFor(() => expect(view.getByText('create:unknown:failed')).toBeOnTheScreen())
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Submit create' })) })
    expect(mockCreate.mutateAsync).toHaveBeenCalledTimes(1)
  })
})

describe('cancelled category-add reconciliation', () => {
  const month = (categoryKeys: readonly number[]) => ({
    budget: { ...budgetFixture, categories: categoryKeys.map((categoryKey) => ({ ...budgetFixture.categories[1], category_key: categoryKey })) },
    hasPreviousMonth: true,
    hasNextMonth: true,
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockAddCategory.isPending = false
    mockAddCategory.mutateAsync.mockRejectedValue(new ApiError('cancelled'))
    mockUseBudgets.mockReturnValue({ data: { budgets: [budgetFixture] }, isLoading: false, isError: false, isAccessTransition: false, refetch: jest.fn() })
  })

  it.each([
    ['committed', [12], 'committed'],
    ['absent', [11], 'absent'],
  ] as const)('refreshes the current month and resolves presence as %s', async (_label, categoryKeys, expected) => {
    const refetch = jest.fn().mockResolvedValue({ isError: false, data: month(categoryKeys) })
    mockUseBudgetMonth.mockReturnValue({ data: month([11]), isLoading: false, isError: false, isNotFound: false, isAccessTransition: false, refetch })
    const view = await render(<BudgetAddCategoryRoute />)
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Submit category' })) })
    await waitFor(() => expect(view.getByText(`category:unknown:${expected}`)).toBeOnTheScreen())
    expect(refetch).toHaveBeenCalledTimes(1)
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Submit category' })) })
    expect(mockAddCategory.mutateAsync).toHaveBeenCalledTimes(1)
  })

  it('retains the payload and clears the gate only after an explicit new attempt for confirmed absence', async () => {
    const refetch = jest.fn().mockResolvedValue({ isError: false, data: month([11]) })
    mockUseBudgetMonth.mockReturnValue({ data: month([11]), isLoading: false, isError: false, isNotFound: false, isAccessTransition: false, refetch })
    const view = await render(<BudgetAddCategoryRoute />)
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Submit category' })) })
    await waitFor(() => expect(view.getByText('category:unknown:absent')).toBeOnTheScreen())
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'New category attempt' })) })
    await waitFor(() => expect(view.getByText('category:none:open')).toBeOnTheScreen())
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Submit category' })) })
    await waitFor(() => expect(mockAddCategory.mutateAsync).toHaveBeenCalledTimes(2))
    expect(mockAddCategory.mutateAsync).toHaveBeenNthCalledWith(2, { budgetId: 7, value: mockCategoryPayload })
  })

  it.each([
    ['duplicate-unknown', [11], 'duplicate-unknown'],
    ['committed', [12], 'committed'],
  ] as const)('keeps a duplicate response locked when reconciliation is %s', async (_label, categoryKeys, expected) => {
    mockAddCategory.mutateAsync.mockRejectedValue(new ApiError('http', 400))
    const refetch = jest.fn().mockResolvedValue({ isError: false, data: month(categoryKeys) })
    mockUseBudgetMonth.mockReturnValue({ data: month([11]), isLoading: false, isError: false, isNotFound: false, isAccessTransition: false, refetch })
    const view = await render(<BudgetAddCategoryRoute />)
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Submit category' })) })
    await waitFor(() => expect(view.getByText(`category:duplicate:${expected}`)).toBeOnTheScreen())
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'New category attempt' })) })
    expect(view.getByText(`category:duplicate:${expected}`)).toBeOnTheScreen()
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Submit category' })) })
    expect(mockAddCategory.mutateAsync).toHaveBeenCalledTimes(1)
    expect(mockAddCategory.mutateAsync).toHaveBeenCalledWith({ budgetId: 7, value: mockCategoryPayload })
  })

  it('keeps a failed current-month refresh unknown and refuses gate clearing or resubmit', async () => {
    const refetch = jest.fn().mockResolvedValue({ isError: true, data: undefined })
    mockUseBudgetMonth.mockReturnValue({ data: month([11]), isLoading: false, isError: false, isNotFound: false, isAccessTransition: false, refetch })
    const view = await render(<BudgetAddCategoryRoute />)
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Submit category' })) })
    await waitFor(() => expect(view.getByText('category:unknown:refresh-failed')).toBeOnTheScreen())
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'New category attempt' })) })
    expect(view.getByText('category:unknown:refresh-failed')).toBeOnTheScreen()
    await act(async () => { fireEvent.press(view.getByRole('button', { name: 'Submit category' })) })
    expect(mockAddCategory.mutateAsync).toHaveBeenCalledTimes(1)
  })
})
