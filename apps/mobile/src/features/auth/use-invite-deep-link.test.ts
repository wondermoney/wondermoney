import { act, renderHook, waitFor } from '@testing-library/react-native'

import { takePendingInviteToken } from '@/lib/auth/invite-token-store'
import { takeJoinInviteToken } from '@/lib/auth/join-invite-token-store'

import { useInviteDeepLink } from './use-invite-deep-link'

const mockUseURL = jest.fn()
const mockReplace = jest.fn()
const mockRouteState = jest.fn()

jest.mock('expo-linking', () => ({
  useURL: () => mockUseURL(),
}))
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
}))
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ routeState: mockRouteState() }),
}))

describe('useInviteDeepLink', () => {
  beforeEach(() => {
    mockUseURL.mockReset()
    mockReplace.mockClear()
    mockRouteState.mockReset().mockReturnValue({ status: 'signed-out' })
    takePendingInviteToken()
    takeJoinInviteToken()
  })

  it('does nothing when there is no url', async () => {
    mockUseURL.mockReturnValue(null)
    await renderHook(() => useInviteDeepLink())
    await act(async () => {})
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('does nothing for an unrelated url', async () => {
    mockUseURL.mockReturnValue('wondermoney://sign-in')
    await renderHook(() => useInviteDeepLink())
    await act(async () => {})
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('stashes the token and navigates to sign-up on a join link while signed out', async () => {
    mockUseURL.mockReturnValue('wondermoney://join?token=abc123')
    await renderHook(() => useInviteDeepLink())
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/sign-up'))
    expect(takePendingInviteToken()).toBe('abc123')
    expect(takeJoinInviteToken()).toBeNull()
  })

  it('opens the join confirmation, not sign-up, while signed in', async () => {
    mockRouteState.mockReturnValue({ status: 'authenticated' })
    mockUseURL.mockReturnValue('wondermoney://join?token=abc123')
    await renderHook(() => useInviteDeepLink())
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/settings/household/join'))
    expect(mockReplace).not.toHaveBeenCalledWith('/sign-up')
    expect(takeJoinInviteToken()).toBe('abc123')
    // Never handed to provisioning, which would send it on the next sign-in.
    expect(takePendingInviteToken()).toBeNull()
  })

  it('waits while the session resolves, then routes by its outcome', async () => {
    mockRouteState.mockReturnValue({ status: 'activating' })
    mockUseURL.mockReturnValue('wondermoney://join?token=abc123')
    const { rerender } = await renderHook(() => useInviteDeepLink())
    await act(async () => {})
    expect(mockReplace).not.toHaveBeenCalled()
    mockRouteState.mockReturnValue({ status: 'authenticated' })
    await rerender(undefined)
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/settings/household/join'))
  })

  it('does not re-navigate on re-render with the same url', async () => {
    mockUseURL.mockReturnValue('wondermoney://join?token=abc123')
    const { rerender } = await renderHook(() => useInviteDeepLink())
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1))
    mockRouteState.mockReturnValue({ status: 'authenticated' })
    await rerender(undefined)
    await act(async () => {})
    expect(mockReplace).toHaveBeenCalledTimes(1)
  })
})
