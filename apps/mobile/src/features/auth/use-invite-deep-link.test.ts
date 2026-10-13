import { act, renderHook, waitFor } from '@testing-library/react-native'

import { takePendingInviteToken } from '@/lib/auth/invite-token-store'

import { useInviteDeepLink } from './use-invite-deep-link'

const mockUseURL = jest.fn()
const mockReplace = jest.fn()

jest.mock('expo-linking', () => ({
  useURL: () => mockUseURL(),
}))
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
}))

describe('useInviteDeepLink', () => {
  beforeEach(() => {
    mockUseURL.mockReset()
    mockReplace.mockClear()
    takePendingInviteToken()
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

  it('stashes the token and navigates to sign-up on a join link', async () => {
    mockUseURL.mockReturnValue('wondermoney://join?token=abc123')
    await renderHook(() => useInviteDeepLink())
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/sign-up'))
    expect(takePendingInviteToken()).toBe('abc123')
  })

  it('does not re-navigate on re-render with the same url', async () => {
    mockUseURL.mockReturnValue('wondermoney://join?token=abc123')
    const { rerender } = await renderHook(() => useInviteDeepLink())
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1))
    await rerender(undefined)
    await act(async () => {})
    expect(mockReplace).toHaveBeenCalledTimes(1)
  })
})
