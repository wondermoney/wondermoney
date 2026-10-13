import { act, renderHook, waitFor } from '@testing-library/react-native'

import { takePendingRecoveryTokens } from './recovery-token-store'
import { useRecoveryDeepLink } from './use-recovery-deep-link'

const mockUseURL = jest.fn()
const mockReplace = jest.fn()

jest.mock('expo-linking', () => ({
  useURL: () => mockUseURL(),
}))
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
}))

describe('useRecoveryDeepLink', () => {
  beforeEach(() => {
    mockUseURL.mockReset()
    mockReplace.mockClear()
    takePendingRecoveryTokens()
  })

  it('does nothing when there is no url', async () => {
    mockUseURL.mockReturnValue(null)
    await renderHook(() => useRecoveryDeepLink())
    await act(async () => {})
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('does nothing for an unrelated url', async () => {
    mockUseURL.mockReturnValue('wondermoney://sign-in')
    await renderHook(() => useRecoveryDeepLink())
    await act(async () => {})
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('stashes the token and navigates to reset-password on a recovery link', async () => {
    mockUseURL.mockReturnValue('wondermoney://reset-password?token=abc')
    await renderHook(() => useRecoveryDeepLink())
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/reset-password'))
    expect(takePendingRecoveryTokens()).toEqual({ token: 'abc' })
  })

  it('navigates to forgot-password with an expired notice on an expired link', async () => {
    mockUseURL.mockReturnValue('wondermoney://reset-password?error=INVALID_TOKEN')
    await renderHook(() => useRecoveryDeepLink())
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({ pathname: '/forgot-password', params: { notice: 'expired' } }))
  })

  it('does not re-navigate on re-render with the same url', async () => {
    mockUseURL.mockReturnValue('wondermoney://reset-password?token=abc')
    const { rerender } = await renderHook(() => useRecoveryDeepLink())
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1))
    await rerender(undefined)
    await act(async () => {})
    expect(mockReplace).toHaveBeenCalledTimes(1)
  })
})
