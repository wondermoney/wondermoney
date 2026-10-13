import { render } from '@testing-library/react-native'

import { setPendingRecoveryTokens } from '@/features/auth/recovery-token-store'

import ResetPasswordRoute from './reset-password'

const mockReplace = jest.fn()
const mockConfirmReset = jest.fn()
let capturedOnSubmit: ((newPassword: string) => Promise<string>) | null = null

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
}))

jest.mock('@/components/providers/password-recovery-provider', () => ({
  usePasswordRecovery: () => ({ confirmReset: mockConfirmReset }),
}))

jest.mock('@/features/auth/reset-password-screen', () => ({
  ResetPasswordScreen: (props: { onSubmit: (newPassword: string) => Promise<string> }) => {
    capturedOnSubmit = props.onSubmit
    return null
  },
}))

describe('ResetPasswordRoute', () => {
  beforeEach(() => {
    mockReplace.mockClear()
    mockConfirmReset.mockReset()
    capturedOnSubmit = null
  })

  it('routes back to forgot-password with an expired notice when confirm reports a link-expired outcome', async () => {
    setPendingRecoveryTokens({ token: 'abc' })
    mockConfirmReset.mockResolvedValue({ status: 'link-expired' })

    await render(<ResetPasswordRoute />)
    expect(capturedOnSubmit).not.toBeNull()

    const outcome = await capturedOnSubmit!('newpassword123')

    expect(outcome).toBe('link-expired')
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/forgot-password', params: { notice: 'expired' } })
  })

  it('routes to sign-in with a passwordUpdated notice when confirm accepts the new password', async () => {
    setPendingRecoveryTokens({ token: 'abc' })
    mockConfirmReset.mockResolvedValue({ status: 'accepted' })

    await render(<ResetPasswordRoute />)
    const outcome = await capturedOnSubmit!('newpassword123')

    expect(outcome).toBe('accepted')
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/sign-in', params: { notice: 'passwordUpdated' } })
  })

  it('does not navigate for a weak-password outcome, leaving the screen to render the inline error', async () => {
    setPendingRecoveryTokens({ token: 'abc' })
    mockConfirmReset.mockResolvedValue({ status: 'weak-password' })

    await render(<ResetPasswordRoute />)
    const outcome = await capturedOnSubmit!('short')

    expect(outcome).toBe('weak-password')
    expect(mockReplace).not.toHaveBeenCalled()
  })
})
