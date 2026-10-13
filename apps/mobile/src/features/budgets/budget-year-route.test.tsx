import { render } from '@testing-library/react-native'

import { BudgetYearRoute } from './budget-year-route'

let mockParams: { budgetId?: string | string[]; year?: string | string[] } = { budgetId: '7', year: '2026' }
const mockReplace = jest.fn()
const mockUseBudgetYear = jest.fn()
const mockUseBudgetYearToDate = jest.fn()

jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams, useRouter: () => ({ replace: mockReplace }) }))
jest.mock('./use-budget-year', () => ({
  useBudgetYear: (...args: unknown[]) => mockUseBudgetYear(...args),
  useBudgetYearToDate: (...args: unknown[]) => mockUseBudgetYearToDate(...args),
}))
jest.mock('./budget-year-screen', () => ({
  BudgetYearScreen: ({ state }: { state: { status: string; year?: { year: number }; toDate?: { totals: { planned: number } } } }) => {
    const Native = jest.requireActual<typeof import('react-native')>('react-native')
    return <Native.Text>{`${state.status}:${state.year?.year ?? '-'}:${state.toDate?.totals.planned ?? '-'}`}</Native.Text>
  },
}))

const yearBudget = { budget: { budgetKey: 7, name: 'Plan', year: 2026, categories: [], accounts: [], incomes: [], currencyCode: 'EUR', description: null } }
const toDateBudget = { budget: { budgetKey: 7, name: 'Plan', year: 2026, categories: [], accounts: [], incomes: [], currencyCode: 'EUR', description: null } }

describe('BudgetYearRoute', () => {
  beforeEach(() => {
    mockParams = { budgetId: '7', year: '2026' }
    mockReplace.mockReset()
    mockUseBudgetYear.mockReset().mockReturnValue({ data: yearBudget, isInvalidRoute: false, isAccessTransition: false, isLoading: false, isNotFound: false, isRefreshFailure: false, isRefreshing: false, refetch: jest.fn() })
    mockUseBudgetYearToDate.mockReset().mockReturnValue({ data: toDateBudget, isInvalidRoute: false, isAccessTransition: false, isLoading: false, isNotFound: false, isRefreshFailure: false, isRefreshing: false, refetch: jest.fn() })
  })

  it('maps both the full year and year-to-date data by the validated route year', async () => {
    const view = await render(<BudgetYearRoute />)
    expect(mockUseBudgetYear).toHaveBeenCalledWith(7, 2026)
    expect(mockUseBudgetYearToDate).toHaveBeenCalledWith(7, 2026, new Date().getMonth() + 1)
    expect(view.getByText('loaded:2026:0')).toBeOnTheScreen()
  })

  it('rejects a malformed budget id or year without a valid request', async () => {
    mockParams = { budgetId: ['7'], year: '2026' }
    mockUseBudgetYear.mockReturnValue({ data: undefined, isInvalidRoute: true, isAccessTransition: false, isLoading: false, isNotFound: false, isRefreshFailure: false, refetch: jest.fn() })
    const view = await render(<BudgetYearRoute />)
    expect(mockUseBudgetYear).toHaveBeenCalledWith(null, 2026)
    expect(view.getByText('invalid-route:-:-')).toBeOnTheScreen()
  })

  it('shows loading while either query is still resolving', async () => {
    mockUseBudgetYearToDate.mockReturnValue({ data: undefined, isInvalidRoute: false, isAccessTransition: false, isLoading: true, isNotFound: false, isRefreshFailure: false, refetch: jest.fn() })
    const view = await render(<BudgetYearRoute />)
    expect(view.getByText(/^loading:/)).toBeOnTheScreen()
  })

  it('maps not-found when either query 404s', async () => {
    mockUseBudgetYear.mockReturnValue({ data: undefined, isInvalidRoute: false, isAccessTransition: false, isLoading: false, isNotFound: true, isRefreshFailure: false, refetch: jest.fn() })
    const view = await render(<BudgetYearRoute />)
    expect(view.getByText('not-found:-:-')).toBeOnTheScreen()
  })

  it('maps refresh-error when either query is a stale-data failure', async () => {
    mockUseBudgetYear.mockReturnValue({ data: yearBudget, isInvalidRoute: false, isAccessTransition: false, isLoading: false, isNotFound: false, isRefreshFailure: true, isRefreshing: false, refetch: jest.fn() })
    const view = await render(<BudgetYearRoute />)
    expect(view.getByText('refresh-error:2026:0')).toBeOnTheScreen()
  })

  it('never requests without an authenticated access transition being mapped', async () => {
    mockUseBudgetYear.mockReturnValue({ data: undefined, isInvalidRoute: false, isAccessTransition: true, isLoading: false, isNotFound: false, isRefreshFailure: false, refetch: jest.fn() })
    const view = await render(<BudgetYearRoute />)
    expect(view.getByText('access-transition:-:-')).toBeOnTheScreen()
  })
})
