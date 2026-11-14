import { render } from '@testing-library/react-native'

import { ApiError } from '@/lib/api/errors'

import { InstallmentPlanDetailRoute } from './installment-plan-detail-route'
import type { InstallmentPlanDetailScreenProps } from './installment-plan-detail-screen'
import { planDetailFixture } from './test-fixtures'

const mockReplace = jest.fn()
const mockBack = jest.fn()
const mockUsePlan = jest.fn()
const mockDelete = jest.fn()
let mockParams: { accountId?: string; planId?: string } = {}
let captured: InstallmentPlanDetailScreenProps | null = null

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ replace: mockReplace, back: mockBack, canGoBack: () => false }),
}))
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ signOut: jest.fn() }) }))
const mockUseAccounts = jest.fn()
jest.mock('@/features/accounts/use-accounts', () => ({ useAccounts: () => mockUseAccounts() }))
jest.mock('./use-installment-plans', () => ({ useInstallmentPlan: (planId: number | null) => mockUsePlan(planId) }))
jest.mock('./use-installment-plan-mutations', () => ({
  ...jest.requireActual('./use-installment-plan-mutations'),
  useDeleteInstallmentPlan: () => ({ mutateAsync: mockDelete, isPending: false }),
}))
const mockLinking = { target: null }
const mockUseLinking = jest.fn((_plan: unknown) => mockLinking)
jest.mock('./use-installment-linking', () => ({ useInstallmentLinking: (plan: unknown) => mockUseLinking(plan) }))
jest.mock('./installment-plan-detail-screen', () => ({
  InstallmentPlanDetailScreen: (props: InstallmentPlanDetailScreenProps) => {
    const Native = jest.requireActual<typeof import('react-native')>('react-native')
    captured = props
    return <Native.Text>{props.state.status}</Native.Text>
  },
}))

const query = { isInvalidId: false, isAccessTransition: false, isLoading: false, isNotFound: false, isRefreshFailure: false, error: null, refetch: jest.fn() }

describe('InstallmentPlanDetailRoute', () => {
  beforeEach(() => {
    mockParams = { accountId: '7', planId: '11' }
    mockUsePlan.mockReset()
    mockReplace.mockReset()
    mockDelete.mockReset()
    mockUseAccounts.mockReset().mockReturnValue({ data: { accounts: [{ accountKey: 7, myAccess: 'owner' }] } })
    captured = null
  })

  it('loads the plan by its route id and returns to its card after deleting it', async () => {
    mockUsePlan.mockReturnValue({ ...query, data: { installmentPlan: planDetailFixture } })
    mockDelete.mockResolvedValue(undefined)
    const view = await render(<InstallmentPlanDetailRoute />)
    expect(mockUsePlan).toHaveBeenCalledWith(11)
    expect(view.getByText('loaded')).toBeOnTheScreen()
    expect(captured?.backHref).toBe('/accounts/7')
    // The loaded plan's links are managed on its page.
    expect(mockUseLinking).toHaveBeenCalledWith(planDetailFixture)
    expect(captured?.linking).toBe(mockLinking)
    await captured?.onDelete?.()
    expect(mockDelete).toHaveBeenCalledWith({ planId: 11, accountId: 7 })
    expect(mockReplace).toHaveBeenCalledWith('/accounts/7')
  })

  it('offers no delete and no linking on a card the caller can only view', async () => {
    mockUseAccounts.mockReturnValue({ data: { accounts: [{ accountKey: 7, myAccess: 'read' }] } })
    mockUsePlan.mockReturnValue({ ...query, data: { installmentPlan: planDetailFixture } })
    const view = await render(<InstallmentPlanDetailRoute />)
    expect(view.getByText('loaded')).toBeOnTheScreen()
    expect(captured?.onDelete).toBeUndefined()
    expect(captured?.linking).toBeUndefined()
  })

  it('stays on the plan and says why when deleting fails', async () => {
    mockUsePlan.mockReturnValue({ ...query, data: { installmentPlan: planDetailFixture } })
    mockDelete.mockRejectedValue(new ApiError('http', 404))
    const view = await render(<InstallmentPlanDetailRoute />)
    await captured?.onDelete?.()
    await view.rerender(<InstallmentPlanDetailRoute />)
    expect(captured?.deleteFailure).toBe('not-found')
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it.each([
    [{ planId: '011' }, { ...query, isInvalidId: true }, 'invalid-id'],
    [{ planId: '11' }, { ...query, isLoading: true }, 'loading'],
    [{ planId: '11' }, { ...query, isNotFound: true, error: new ApiError('http', 404) }, 'not-found'],
    [{ planId: '11' }, { ...query, error: new ApiError('invalid-response') }, 'invalid-response'],
    [{ planId: '11' }, { ...query, error: new ApiError('network') }, 'error'],
  ])('maps %o to its page state', async (params, result, status) => {
    mockParams = { accountId: '7', ...params }
    mockUsePlan.mockReturnValue({ ...result, data: undefined })
    const view = await render(<InstallmentPlanDetailRoute />)
    expect(view.getByText(status)).toBeOnTheScreen()
  })
})
