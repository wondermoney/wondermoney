import { fireEvent, render } from '@testing-library/react-native'

import { LoanDetailRoute } from './loan-detail-route'
import { LoansRoute } from './loans-route'
import { loanFixture, repaymentFixture } from './test-fixtures'

const mockPush = jest.fn()
const mockReplace = jest.fn()
let mockParams: { loanId?: string | string[] } = {}
const mockUseLoans = jest.fn()
const mockUseLoan = jest.fn()
const mockUseRepayments = jest.fn()
const mockUseCandidates = jest.fn()
const mockMutate = jest.fn()
const mockMarkAuthoritative = jest.fn()
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, replace: mockReplace }), useLocalSearchParams: () => mockParams, useNavigation: () => ({ addListener: jest.fn(() => jest.fn()) }) }))
jest.mock('./use-loans', () => ({ useLoans: () => mockUseLoans() }))
jest.mock('./use-loan', () => ({ useLoan: (id: number | null) => mockUseLoan(id) }))
jest.mock('./use-loan-repayments', () => ({ useLoanRepayments: (id: number | null) => mockUseRepayments(id) }))
jest.mock('./use-loan-repayment-candidates', () => ({ useLoanRepaymentCandidates: (id: number | null) => mockUseCandidates(id) }))
jest.mock('./use-loan-repayment-mutation', () => ({ classifyRepaymentWriteFailure: () => 'general', useLoanRepaymentMutation: () => ({ mutateAsync: mockMutate, isLoanPending: () => false, requiresAuthoritativeRefresh: () => false, markAuthoritativeRefresh: mockMarkAuthoritative }) }))
jest.mock('./loans-screen', () => ({ LoansScreen: ({ onOpenLoan, onCreateLoan }: { onOpenLoan: (id: number) => void; onCreateLoan: () => void }) => { const Native = jest.requireActual<typeof import('react-native')>('react-native'); return <><Native.Pressable accessibilityRole="button" accessibilityLabel="Loan row" onPress={() => onOpenLoan(7)}><Native.Text>Loan row</Native.Text></Native.Pressable><Native.Pressable accessibilityRole="button" accessibilityLabel="Add" onPress={onCreateLoan}><Native.Text>Add</Native.Text></Native.Pressable></> } }))
jest.mock('./loan-detail-screen', () => ({ LoanDetailScreen: ({ state, onBack, onEdit, repaymentWorkflow }: { state: { status: string; history?: { repayments?: { id: number }[] } }; onBack: () => void; onEdit: () => void; repaymentWorkflow?: { candidates: { status: string }; onResolveUnknown: () => Promise<boolean> } }) => { const Native = jest.requireActual<typeof import('react-native')>('react-native'); return <><Native.Text>{`${state.status}:${state.history?.repayments?.map((item) => item.id).join(',') ?? '-'}`}</Native.Text><Native.Text>{`candidates:${repaymentWorkflow?.candidates.status ?? '-'}`}</Native.Text><Native.Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack}><Native.Text>Back</Native.Text></Native.Pressable><Native.Pressable accessibilityRole="button" accessibilityLabel="Edit" onPress={onEdit}><Native.Text>Edit</Native.Text></Native.Pressable><Native.Pressable accessibilityRole="button" accessibilityLabel="Resolve repayment unknown" onPress={() => void repaymentWorkflow?.onResolveUnknown()} /></> } }))

describe('loan routes', () => {
  beforeEach(() => { mockPush.mockReset(); mockReplace.mockReset(); mockUseLoans.mockReset(); mockUseLoan.mockReset(); mockUseRepayments.mockReset(); mockUseCandidates.mockReset(); mockMutate.mockReset(); mockMarkAuthoritative.mockReset(); mockUseCandidates.mockReturnValue({ isAccessTransition: false, isLoading: false, data: { candidates: [] }, isRefreshFailure: false, refetch: jest.fn() }); mockParams = {} })

  it('opens nested loan detail from the More-owned list', async () => {
    mockUseLoans.mockReturnValue({ isAccessTransition: false, isLoading: false, data: { loans: [loanFixture] }, isRefreshFailure: false, refetch: jest.fn() })
    const view = await render(<LoansRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Loan row' }))
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/loans/[loanId]', params: { loanId: '7' } })
  })

  it('opens the create form from the loans list', async () => {
    mockUseLoans.mockReturnValue({ isAccessTransition: false, isLoading: false, data: { loans: [loanFixture] }, isRefreshFailure: false, refetch: jest.fn() })
    const view = await render(<LoansRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Add' }))
    expect(mockPush).toHaveBeenCalledWith('/loans/create')
  })

  it('passes malformed ids as null and makes the screen locally invalid', async () => {
    mockParams = { loanId: ['7'] }
    mockUseLoan.mockReturnValue({ isInvalidId: true, refetch: jest.fn() })
    mockUseRepayments.mockReturnValue({ refetch: jest.fn() })
    const view = await render(<LoanDetailRoute />)
    expect(mockUseLoan).toHaveBeenCalledWith(null)
    expect(mockUseRepayments).toHaveBeenCalledWith(null)
    expect(view.getByText('invalid-id:-')).toBeOnTheScreen()
  })

  it('sorts repayment history before presentation and maps Back to Loans', async () => {
    mockParams = { loanId: '7' }
    mockUseLoan.mockReturnValue({ isInvalidId: false, isAccessTransition: false, isLoading: false, data: { loan: loanFixture }, isRefreshFailure: false, isRefreshing: false, refetch: jest.fn() })
    mockUseRepayments.mockReturnValue({ isAccessTransition: false, isLoading: false, data: { repayments: [repaymentFixture, { ...repaymentFixture, loanRepaymentLinkKey: 22, paymentDate: '2026-08-05' }] }, isRefreshFailure: false, isRefreshing: false, refetch: jest.fn() })
    const view = await render(<LoanDetailRoute />)
    expect(view.getByText('loaded:22,21')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Edit' }))
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/loans/[loanId]/edit', params: { loanId: '7' } })
    await fireEvent.press(view.getByRole('button', { name: 'Back' }))
    expect(mockReplace).toHaveBeenCalledWith('/loans')
  })

  it('clears the unknown repayment barrier only after both history and candidates refresh successfully', async () => {
    mockParams = { loanId: '7' }
    const historyRefetch = jest.fn().mockResolvedValue({ isSuccess: true, data: { repayments: [] } })
    const candidateRefetch = jest.fn().mockResolvedValueOnce({ isSuccess: false, data: undefined }).mockResolvedValueOnce({ isSuccess: true, data: { candidates: [] } })
    mockUseLoan.mockReturnValue({ isInvalidId: false, isAccessTransition: false, isLoading: false, data: { loan: loanFixture }, isRefreshFailure: false, isRefreshing: false, refetch: jest.fn() })
    mockUseRepayments.mockReturnValue({ isAccessTransition: false, isLoading: false, data: { repayments: [] }, isRefreshFailure: false, isRefreshing: false, refetch: historyRefetch })
    mockUseCandidates.mockReturnValue({ isAccessTransition: false, isLoading: false, data: { candidates: [] }, isRefreshFailure: false, refetch: candidateRefetch })
    const view = await render(<LoanDetailRoute />)
    await fireEvent.press(view.getByRole('button', { name: 'Resolve repayment unknown' }))
    expect(mockMarkAuthoritative).not.toHaveBeenCalled()
    await fireEvent.press(view.getByRole('button', { name: 'Resolve repayment unknown' }))
    expect(mockMarkAuthoritative).toHaveBeenCalledWith(7)
  })
})
