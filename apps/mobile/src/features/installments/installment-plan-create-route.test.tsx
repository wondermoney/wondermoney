import { render } from '@testing-library/react-native'

import { ApiError } from '@/lib/api/errors'

import { InstallmentPlanCreateRoute } from './installment-plan-create-route'
import type { InstallmentPlanCreateScreenProps } from './installment-plan-create-screen'
import { planDetailFixture, suggestionFixture } from './test-fixtures'

const mockReplace = jest.fn()
const mockCreate = jest.fn()
const mockUseSuggestions = jest.fn()
let mockParams: { accountId?: string; suggestion?: string } = {}
let captured: InstallmentPlanCreateScreenProps | null = null

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  usePreventRemove: () => jest.fn(),
  useRouter: () => ({ replace: mockReplace, back: jest.fn(), canGoBack: () => true }),
}))
jest.mock('@/features/accounts/use-account', () => ({
  useAccount: () => ({ isLoading: false, data: { account: { currencyKey: { code: 'EUR' } } } }),
}))
jest.mock('./use-installment-plans', () => ({ useInstallmentSuggestions: (...args: unknown[]) => mockUseSuggestions(...args) }))
jest.mock('./use-installment-plan-mutations', () => ({
  ...jest.requireActual('./use-installment-plan-mutations'),
  useCreateInstallmentPlan: () => ({ mutateAsync: mockCreate, isPending: false }),
}))
jest.mock('./installment-plan-create-screen', () => ({
  InstallmentPlanCreateScreen: (props: InstallmentPlanCreateScreenProps) => {
    const Native = jest.requireActual<typeof import('react-native')>('react-native')
    captured = props
    return <Native.Text>{props.draft ? `draft ${props.draft.description}` : 'blank'}</Native.Text>
  },
}))

describe('InstallmentPlanCreateRoute', () => {
  beforeEach(() => {
    mockParams = { accountId: '7' }
    mockReplace.mockReset()
    mockCreate.mockReset()
    mockUseSuggestions.mockReset()
    mockUseSuggestions.mockReturnValue({ isLoading: false, data: { suggestions: [suggestionFixture] } })
    captured = null
  })

  it('opens blank for a plan typed in and does not load suggestions', async () => {
    const view = await render(<InstallmentPlanCreateRoute />)
    expect(view.getByText('blank')).toBeOnTheScreen()
    expect(mockUseSuggestions).toHaveBeenCalledWith(7, false)
    expect(captured).toMatchObject({ accountId: 7, currency: 'EUR', suggestionUnavailable: false })
  })

  it('accepts a suggestion only on submit, with its links, then opens the new plan', async () => {
    mockParams = { accountId: '7', suggestion: suggestionFixture.key }
    mockCreate.mockResolvedValue({ installmentPlan: { ...planDetailFixture, installmentPlanKey: 12 } })
    const view = await render(<InstallmentPlanCreateRoute />)
    expect(view.getByText('draft Phone shop')).toBeOnTheScreen()
    expect(mockCreate).not.toHaveBeenCalled()
    expect(captured?.draft?.links).toEqual([{ transactionKey: 901, installmentNumber: 1 }, { transactionKey: 902, installmentNumber: 2 }])
    const payload = { accountKey: 7, description: 'Phone shop', purchaseDate: '2026-09-15', totalAmount: 300, installmentCount: 6, links: captured!.draft!.links }
    await captured?.onSubmit(payload)
    expect(mockCreate).toHaveBeenCalledWith(payload)
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/accounts/[accountId]/installments/[planId]', params: { accountId: '7', planId: '12' } })
  })

  it('says when the suggestion is gone and keeps the form usable', async () => {
    mockParams = { accountId: '7', suggestion: 'gone' }
    const view = await render(<InstallmentPlanCreateRoute />)
    expect(view.getByText('blank')).toBeOnTheScreen()
    expect(captured?.suggestionUnavailable).toBe(true)
  })

  it('stays on the form with the reason when the API refuses the plan', async () => {
    mockCreate.mockRejectedValue(new ApiError('http', 409))
    const view = await render(<InstallmentPlanCreateRoute />)
    await captured?.onSubmit({ accountKey: 7, description: 'Phone shop', purchaseDate: '2026-09-15', totalAmount: 300, installmentCount: 6 })
    await view.rerender(<InstallmentPlanCreateRoute />)
    expect(captured?.failure).toBe('conflict')
    expect(mockReplace).not.toHaveBeenCalled()
  })
})
