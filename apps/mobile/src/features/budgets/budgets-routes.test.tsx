import { fireEvent, render } from '@testing-library/react-native'

import { BudgetMonthRoute } from './budget-month-route'
import { BudgetsRoute } from './budgets-route'
import { budgetFixture } from './test-fixtures'

const mockPush = jest.fn()
const mockReplace = jest.fn()
const mockAddListener = jest.fn((_event: string, _handler: (event: { preventDefault: () => void }) => void) => jest.fn())
let mockParams: Record<string, string | string[] | undefined> = {}
const mockUseBudgets = jest.fn()
const mockUseBudgetMonth = jest.fn()
const mockCategoryMutation = { isPending: false, mutateAsync: jest.fn() }
const mockCategoryDeleteMutation = { isPending: false, mutateAsync: jest.fn() }
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, replace: mockReplace }), useNavigation: () => ({ addListener: mockAddListener }), useLocalSearchParams: () => mockParams }))
jest.mock('./use-budgets', () => ({ useBudgets: () => mockUseBudgets() }))
jest.mock('./use-budget-month', () => ({ useBudgetMonth: (...args: unknown[]) => mockUseBudgetMonth(...args) }))
jest.mock('./use-budget-category-mutation', () => ({ useBudgetCategoryMutation: () => mockCategoryMutation }))
jest.mock('./use-budget-category-delete-mutation', () => ({ useBudgetCategoryDeleteMutation: () => mockCategoryDeleteMutation }))
jest.mock('./budgets-screen', () => ({
  BudgetsScreen: ({ onOpenBudget }: { onOpenBudget: (id: number, year: number, month: number) => void }) => {
    const Native = jest.requireActual<typeof import('react-native')>('react-native')
    return <Native.Pressable accessibilityRole="button" accessibilityLabel="Open budget" onPress={() => onOpenBudget(7, 2026, 7)}><Native.Text>Open</Native.Text></Native.Pressable>
  },
}))
jest.mock('./budget-month-screen', () => ({
  BudgetMonthScreen: ({ state, onPrevious, onNext, onSaveCategory, onRemoveCategory }: { state: { status: string; budget?: { year: number; month: number } }; onPrevious: () => void; onNext: () => void; onSaveCategory: (id: number, value: { amount: number; recurrency: 'MONTHLY'; applyToFollowingMonths: boolean }) => Promise<void>; onRemoveCategory: (id: number, scope: 'month' | 'forward') => Promise<void> }) => {
    const Native = jest.requireActual<typeof import('react-native')>('react-native')
    return <><Native.Text>{`${state.status}:${state.budget?.year ?? '-'}:${state.budget?.month ?? '-'}`}</Native.Text><Native.Pressable accessibilityRole="button" accessibilityLabel="Previous" onPress={onPrevious}><Native.Text>Previous</Native.Text></Native.Pressable><Native.Pressable accessibilityRole="button" accessibilityLabel="Next" onPress={onNext}><Native.Text>Next</Native.Text></Native.Pressable><Native.Pressable accessibilityRole="button" accessibilityLabel="Save child route" onPress={() => void onSaveCategory(11, { amount: 90, recurrency: 'MONTHLY', applyToFollowingMonths: false })} /><Native.Pressable accessibilityRole="button" accessibilityLabel="Remove child route" onPress={() => void onRemoveCategory(11, 'forward')} /></>
  },
}))

describe('budget routes', () => {
  beforeEach(() => { mockPush.mockReset(); mockReplace.mockReset(); mockAddListener.mockClear(); mockUseBudgets.mockReset(); mockUseBudgetMonth.mockReset(); mockCategoryMutation.isPending = false; mockCategoryMutation.mutateAsync.mockReset().mockResolvedValue(undefined); mockCategoryDeleteMutation.isPending = false; mockCategoryDeleteMutation.mutateAsync.mockReset().mockResolvedValue(undefined); mockParams = {} })

  it('opens a nested month route from the list', async () => {
    mockUseBudgets.mockReturnValue({ data: { budgets: [budgetFixture] }, isLoading: false, isAccessTransition: false, isRefreshFailure: false, refetch: jest.fn() })
    const view = await render(<BudgetsRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Open budget' }))
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/budgets/[budgetId]/[year]/[month]', params: { budgetId: '7', year: '2026', month: '7' } })
  })

  it('rejects malformed params locally without a valid request', async () => {
    mockParams = { budgetId: ['7'], year: '2026', month: '7' }
    mockUseBudgetMonth.mockReturnValue({ isInvalidRoute: true, refetch: jest.fn() })
    const view = await render(<BudgetMonthRoute />)
    expect(mockUseBudgetMonth).toHaveBeenCalledWith(null, 2026, 7)
    expect(view.getByText('invalid-route:-:-')).toBeOnTheScreen()
  })

  it('uses route period over response metadata and rolls Jan/Dec navigation', async () => {
    mockParams = { budgetId: '7', year: '2026', month: '1' }
    mockUseBudgetMonth.mockReturnValue({ isInvalidRoute: false, isAccessTransition: false, isLoading: false, data: { budget: { ...budgetFixture, year: 2020, month: 8 }, hasPreviousMonth: true, hasNextMonth: true }, isRefreshFailure: false, refetch: jest.fn() })
    const view = await render(<BudgetMonthRoute />)
    expect(view.getByText('loaded:2026:1')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Previous' }))
    expect(mockReplace).toHaveBeenLastCalledWith({ pathname: '/budgets/[budgetId]/[year]/[month]', params: { budgetId: '7', year: '2025', month: '12' } })
    mockParams = { budgetId: '7', year: '2026', month: '12' }
    await view.rerender(<BudgetMonthRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Next' }))
    expect(mockReplace).toHaveBeenLastCalledWith({ pathname: '/budgets/[budgetId]/[year]/[month]', params: { budgetId: '7', year: '2027', month: '1' } })
  })

  it('uses validated route period, not response metadata, for child category writes', async () => {
    mockParams = { budgetId: '7', year: '2028', month: '4' }
    mockUseBudgetMonth.mockReturnValue({ isInvalidRoute: false, isAccessTransition: false, isLoading: false, data: { budget: { ...budgetFixture, year: 2020, month: 8 }, hasPreviousMonth: true, hasNextMonth: true }, isRefreshFailure: false, refetch: jest.fn() })
    const view = await render(<BudgetMonthRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Save child route' }))
    expect(mockCategoryMutation.mutateAsync).toHaveBeenCalledWith({ budgetId: 7, year: 2028, month: 4, categoryId: 11, value: { amount: 90, recurrency: 'MONTHLY', applyToFollowingMonths: false } })
  })

  it('blocks navigator back removal while the guarded category write is pending', async () => {
    mockParams = { budgetId: '7', year: '2028', month: '4' }
    mockCategoryMutation.isPending = true
    mockUseBudgetMonth.mockReturnValue({ isInvalidRoute: false, isAccessTransition: false, isLoading: false, data: { budget: budgetFixture, hasPreviousMonth: true, hasNextMonth: true }, isRefreshFailure: false, refetch: jest.fn() })
    await render(<BudgetMonthRoute />)
    const beforeRemove = mockAddListener.mock.calls.find(([event]) => event === 'beforeRemove')?.[1]
    const preventDefault = jest.fn()
    beforeRemove?.({ preventDefault })
    expect(preventDefault).toHaveBeenCalled()
  })

  it('blocks navigator back removal while the guarded category deletion is pending', async () => {
    mockParams = { budgetId: '7', year: '2028', month: '4' }
    mockCategoryDeleteMutation.isPending = true
    mockUseBudgetMonth.mockReturnValue({ isInvalidRoute: false, isAccessTransition: false, isLoading: false, data: { budget: budgetFixture, hasPreviousMonth: true, hasNextMonth: true }, isRefreshFailure: false, refetch: jest.fn() })
    await render(<BudgetMonthRoute />)
    const beforeRemove = mockAddListener.mock.calls.find(([event]) => event === 'beforeRemove')?.[1]
    const preventDefault = jest.fn()
    beforeRemove?.({ preventDefault })
    expect(preventDefault).toHaveBeenCalled()
  })

  it('uses validated route period, not response metadata, for child category removal', async () => {
    mockParams = { budgetId: '7', year: '2028', month: '4' }
    mockUseBudgetMonth.mockReturnValue({ isInvalidRoute: false, isAccessTransition: false, isLoading: false, data: { budget: { ...budgetFixture, year: 2020, month: 8 }, hasPreviousMonth: true, hasNextMonth: true }, isRefreshFailure: false, refetch: jest.fn() })
    const view = await render(<BudgetMonthRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Remove child route' }))
    expect(mockCategoryDeleteMutation.mutateAsync).toHaveBeenCalledWith({ budgetId: 7, categoryId: 11, scope: 'forward', year: 2028, month: 4 })
  })
})
