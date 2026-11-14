import { render } from '@testing-library/react-native'

import { SyncHistoryRoute } from '../sync-history-route'

let mockParams: { connectionId?: string; institutionName?: string; provider?: string } = {}
const mockUseBankSyncHistory = jest.fn()

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => mockParams,
}))
jest.mock('../use-bank-sync-history', () => ({
  useBankSyncHistory: (...args: unknown[]) => mockUseBankSyncHistory(...args),
}))
jest.mock('../sync-history-screen', () => ({
  SyncHistoryScreen: () => null,
}))

describe('SyncHistoryRoute', () => {
  beforeEach(() => {
    mockUseBankSyncHistory.mockReset().mockReturnValue({ data: undefined, isError: false, isFetching: true, isNotFound: false, refetch: jest.fn() })
  })

  it('reads a SimpleFIN connection with the SimpleFIN provider', async () => {
    mockParams = { connectionId: '7', provider: 'SimpleFIN' }
    await render(<SyncHistoryRoute />)
    expect(mockUseBankSyncHistory).toHaveBeenCalledWith(7, 'SimpleFIN')
  })

  it('reads any other connection as Enable Banking', async () => {
    mockParams = { connectionId: '7' }
    await render(<SyncHistoryRoute />)
    expect(mockUseBankSyncHistory).toHaveBeenLastCalledWith(7, 'EnableBanking')

    mockParams = { connectionId: '7', provider: 'Plaid' }
    await render(<SyncHistoryRoute />)
    expect(mockUseBankSyncHistory).toHaveBeenLastCalledWith(7, 'EnableBanking')
  })
})
