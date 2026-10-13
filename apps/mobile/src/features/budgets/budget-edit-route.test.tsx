import { fireEvent, render } from '@testing-library/react-native'

import { ApiError } from '@/lib/api/errors'

import { BudgetEditRoute } from './budget-edit-route'

let mockParams: { budgetId?: string | string[] } = { budgetId: '7' }
const mockReplace = jest.fn()
const mockUseDetail = jest.fn()
const mockMutation = { isPending: false, mutateAsync: jest.fn() }
const mockDeleteMutation = { isPending: false, mutateAsync: jest.fn() }

jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams, useRouter: () => ({ replace: mockReplace }) }))
jest.mock('./use-budget-detail', () => ({ useBudgetDetail: (...args: unknown[]) => mockUseDetail(...args) }))
jest.mock('./use-budget-metadata-mutation', () => ({ useBudgetMetadataMutation: () => mockMutation }))
jest.mock('./use-budget-delete-mutation', () => ({ useBudgetDeleteMutation: () => mockDeleteMutation }))
jest.mock('./budget-edit-screen', () => ({
  BudgetEditScreen: ({ state, onSaveMetadata, onDeleteBudget }: { state: { status: string; model?: { name: string } }; onSaveMetadata: (value: { name: string; description: string }) => Promise<void>; onDeleteBudget: () => Promise<void> }) => {
    const Native = jest.requireActual<typeof import('react-native')>('react-native')
    return <>
      <Native.Text>{`${state.status}:${state.model?.name ?? '-'}`}</Native.Text>
      <Native.Pressable accessibilityRole="button" accessibilityLabel="Save metadata route" onPress={() => void onSaveMetadata({ name: 'Plan', description: '' })} />
      <Native.Pressable accessibilityRole="button" accessibilityLabel="Delete budget route" onPress={() => void onDeleteBudget()} />
    </>
  },
}))

describe('budget edit route', () => {
  beforeEach(() => {
    mockParams = { budgetId: '7' }
    mockReplace.mockReset()
    mockMutation.mutateAsync.mockReset().mockResolvedValue(undefined)
    mockDeleteMutation.mutateAsync.mockReset().mockResolvedValue(undefined)
    mockUseDetail.mockReset().mockReturnValue({ data: { budget: { budgetKey: 7, name: 'Authoritative plan', description: null } }, isInvalidRoute: false, isLoading: false, isAccessTransition: false, isRefreshFailure: false, refetch: jest.fn() })
  })

  it('loads authoritative detail independently of templates and wires metadata only', async () => {
    const view = await render(<BudgetEditRoute />)
    expect(mockUseDetail).toHaveBeenCalledWith(7)
    expect(view.getByText('loaded:Authoritative plan')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Save metadata route' }))
    expect(mockMutation.mutateAsync).toHaveBeenCalledWith({ budgetId: 7, value: { name: 'Plan', description: '' } })
  })

  it('deletes the budget then navigates back to the list', async () => {
    const view = await render(<BudgetEditRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Delete budget route' }))
    expect(mockDeleteMutation.mutateAsync).toHaveBeenCalledWith(7)
    expect(mockReplace).toHaveBeenCalledWith('/budgets')
  })

  it.each([
    ['invalid-route', { isInvalidRoute: true }],
    ['not-found', { isInvalidRoute: false, isLoading: false, isAccessTransition: false, isNotFound: true }],
    ['invalid-response', { isInvalidRoute: false, isLoading: false, isAccessTransition: false, error: new ApiError('invalid-response') }],
    ['access-transition', { isInvalidRoute: false, isLoading: false, isAccessTransition: true }],
  ])('maps %s distinctly', async (label, result) => {
    mockUseDetail.mockReturnValue({ refetch: jest.fn(), ...result })
    const view = await render(<BudgetEditRoute />)
    expect(view.getByText(`${label}:-`)).toBeOnTheScreen()
  })

  it('keeps authoritative data visible with stale status after refresh failure', async () => {
    mockUseDetail.mockReturnValue({ data: { budget: { budgetKey: 7, name: 'Cached plan' } }, isInvalidRoute: false, isLoading: false, isAccessTransition: false, isRefreshFailure: true, isRefreshing: false, refetch: jest.fn() })
    const view = await render(<BudgetEditRoute />)
    expect(view.getByText('refresh-error:Cached plan')).toBeOnTheScreen()
  })
})
