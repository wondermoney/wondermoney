import { render } from '@testing-library/react-native'

import { PortfolioActivityRoute } from './portfolio-activity-route'

const mockUseActivity = jest.fn()
const mockReplace = jest.fn()
const mockDeleteMutateAsync = jest.fn()
const mockEditMutateAsync = jest.fn()
let mockParams: Record<string, string | string[] | undefined> = {}
type CapturedProps = { state: { status: string }; aggregate: boolean; onApplyFilters: (filters: Record<string, string>) => void; onDeleteTransaction?: (transactionKey: number) => Promise<void>; onEditTransaction?: (transactionKey: number, draft: { quantity?: string }) => Promise<void> }
let captured: CapturedProps | null = null

jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams, useRouter: () => ({ replace: mockReplace }) }))
jest.mock('@/components/providers/product-runtime-provider', () => ({ useProductRuntime: () => ({ signOut: jest.fn() }) }))
jest.mock('./use-portfolio-activity', () => ({ usePortfolioActivity: (...args: unknown[]) => mockUseActivity(...args) }))
jest.mock('./use-delete-portfolio-transaction', () => ({ useDeletePortfolioTransaction: (...args: unknown[]) => ({ mutateAsync: (transactionKey: number) => mockDeleteMutateAsync(...args, transactionKey) }) }))
jest.mock('./use-edit-portfolio-transaction', () => ({ useEditPortfolioTransaction: (...args: unknown[]) => ({ mutateAsync: (value: unknown) => mockEditMutateAsync(...args, value) }) }))
jest.mock('./portfolio-activity-screen', () => ({
  PortfolioActivityScreen: (props: CapturedProps) => {
    const Native = jest.requireActual<typeof import('react-native')>('react-native')
    captured = props
    return <Native.Text>{props.state.status}</Native.Text>
  },
}))

const base = { data: undefined, isInvalidRequest: false, isAccessTransition: false, isInitialLoading: false, isRateLimited: false, isNotFound: false, isInvalidResponse: false, isRefreshFailure: false, isRefreshing: false, refetch: jest.fn() }

describe('PortfolioActivityRoute', () => {
  beforeEach(() => { mockParams = {}; mockUseActivity.mockReset(); mockReplace.mockReset(); mockDeleteMutateAsync.mockReset().mockResolvedValue(undefined); mockEditMutateAsync.mockReset().mockResolvedValue(undefined); captured = null })

  it('loads aggregate activity and serializes applied filters into the route', async () => {
    mockUseActivity.mockReturnValue({ ...base, data: { transactions: [] } })
    const view = await render(<PortfolioActivityRoute aggregate />)
    expect(view.getByText('loaded')).toBeOnTheScreen()
    expect(mockUseActivity).toHaveBeenCalledWith('aggregate', {})
    captured?.onApplyFilters({ fromDate: '2026-07-01T00:00:00.000Z' })
    expect(mockReplace).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/portfolio/activity', params: { fromDate: '2026-07-01T00:00:00.000Z' } }))
  })

  it('strictly parses per-ID routes and maps initial/cached 429 states', async () => {
    mockParams = { portfolioId: '3' }
    mockUseActivity.mockReturnValue({ ...base, isRateLimited: true })
    const initial = await render(<PortfolioActivityRoute aggregate={false} />)
    expect(mockUseActivity).toHaveBeenCalledWith(3, {})
    expect(initial.getByText('rate-limited')).toBeOnTheScreen()
    mockUseActivity.mockReturnValue({ ...base, data: { transactions: [] }, isRateLimited: true, isRefreshFailure: true })
    await initial.rerender(<PortfolioActivityRoute aggregate={false} />)
    expect(initial.getByText('rate-limited-cached')).toBeOnTheScreen()
  })

  it('makes malformed IDs and filters invalid without coercion', async () => {
    mockParams = { portfolioId: '03', fromDate: 'bad' }
    mockUseActivity.mockReturnValue({ ...base, isInvalidRequest: true })
    const view = await render(<PortfolioActivityRoute aggregate={false} />)
    expect(mockUseActivity).toHaveBeenCalledWith(null, null)
    expect(view.getByText('invalid-request')).toBeOnTheScreen()
  })

  describe('transaction deletion wiring', () => {
    it('never offers a delete handler in the aggregate view', async () => {
      mockUseActivity.mockReturnValue({ ...base, data: { transactions: [] } })
      await render(<PortfolioActivityRoute aggregate />)
      expect(captured?.onDeleteTransaction).toBeUndefined()
    })

    it('never offers a delete handler for an invalid portfolio id', async () => {
      mockParams = { portfolioId: '03' }
      mockUseActivity.mockReturnValue({ ...base, isInvalidRequest: true })
      await render(<PortfolioActivityRoute aggregate={false} />)
      expect(captured?.onDeleteTransaction).toBeUndefined()
    })

    it('deletes by the validated portfolio id and the given transaction key', async () => {
      mockParams = { portfolioId: '3' }
      mockUseActivity.mockReturnValue({ ...base, data: { transactions: [] } })
      await render(<PortfolioActivityRoute aggregate={false} />)
      await captured?.onDeleteTransaction?.(41)
      expect(mockDeleteMutateAsync).toHaveBeenCalledWith(3, 41)
    })
  })

  describe('transaction editing wiring', () => {
    it('never offers an edit handler in the aggregate view', async () => {
      mockUseActivity.mockReturnValue({ ...base, data: { transactions: [] } })
      await render(<PortfolioActivityRoute aggregate />)
      expect(captured?.onEditTransaction).toBeUndefined()
    })

    it('never offers an edit handler for an invalid portfolio id', async () => {
      mockParams = { portfolioId: '03' }
      mockUseActivity.mockReturnValue({ ...base, isInvalidRequest: true })
      await render(<PortfolioActivityRoute aggregate={false} />)
      expect(captured?.onEditTransaction).toBeUndefined()
    })

    it('edits by the validated portfolio id, the given transaction key, and the given draft', async () => {
      mockParams = { portfolioId: '3' }
      mockUseActivity.mockReturnValue({ ...base, data: { transactions: [] } })
      await render(<PortfolioActivityRoute aggregate={false} />)
      await captured?.onEditTransaction?.(41, { quantity: '5' })
      expect(mockEditMutateAsync).toHaveBeenCalledWith(3, { transactionId: 41, draft: { quantity: '5' } })
    })
  })
})
