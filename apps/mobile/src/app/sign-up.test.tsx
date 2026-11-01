import { act, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'
import { setPendingInviteToken, takePendingInviteToken } from '@/lib/auth/invite-token-store'
import { captureAnalyticsEvent } from '@/lib/telemetry/analytics'

import SignUpRoute from './sign-up'

jest.mock('@/lib/telemetry/analytics', () => ({ captureAnalyticsEvent: jest.fn() }))
const captured = jest.mocked(captureAnalyticsEvent)

const mockReplace = jest.fn()
const mockSignUp = jest.fn()
const mockValidateHouseholdInvite = jest.fn()
let capturedSignUpProps: Record<string, unknown> | null = null
let capturedInvalidProps: Record<string, unknown> | null = null
let capturedSocialProps: Record<string, unknown> | null = null

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
  Link: ({ children }: { children: React.ReactNode }) => children,
}))

jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ signUp: mockSignUp, validateHouseholdInvite: mockValidateHouseholdInvite }),
}))

jest.mock('@/features/auth/sign-up-screen', () => ({
  SignUpScreen: (props: Record<string, unknown>) => {
    capturedSignUpProps = props
    return null
  },
}))

jest.mock('@/features/auth/social-sign-in', () => ({
  SocialSignIn: (props: Record<string, unknown>) => {
    capturedSocialProps = props
    return null
  },
}))

jest.mock('@/features/auth/invite-invalid-screen', () => ({
  InviteInvalidScreen: (props: Record<string, unknown>) => {
    capturedInvalidProps = props
    return null
  },
}))

async function renderRoute() {
  const i18n = await initMobileI18n('en')
  return render(
    <I18nextProvider i18n={i18n}>
      <SignUpRoute />
    </I18nextProvider>,
  )
}

describe('SignUpRoute', () => {
  beforeEach(() => {
    mockReplace.mockClear()
    mockSignUp.mockReset()
    mockValidateHouseholdInvite.mockReset()
    capturedSignUpProps = null
    capturedInvalidProps = null
    capturedSocialProps = null
    captured.mockClear()
  })

  it('captures sign_up_completed with the channel only, and only on acceptance', async () => {
    mockSignUp.mockResolvedValue({ status: 'accepted' })
    await renderRoute()
    const onSubmit = capturedSignUpProps?.onSubmit as (email: string, password: string) => Promise<string>

    await onSubmit('person@example.com', 'pw12345678')

    expect(captured.mock.calls).toEqual([['sign_up_completed', { provider: 'email' }]])
    expect(JSON.stringify(captured.mock.calls)).not.toContain('person@example.com')
  })

  it('captures nothing when sign-up is refused, and never reports an invite', async () => {
    setPendingInviteToken('tok-1')
    mockValidateHouseholdInvite.mockResolvedValue({
      status: 'valid',
      invite: { email: 'partner@example.com', expiresAt: '2024-01-08T00:00:00.000Z', inviterName: 'Alex' },
    })
    mockSignUp.mockResolvedValue({ status: 'email-taken' })
    await renderRoute()
    await waitFor(() => expect(capturedSignUpProps?.emailLocked).toBe(true))
    const onSubmit = capturedSignUpProps?.onSubmit as (email: string, password: string) => Promise<string>

    await onSubmit('partner@example.com', 'pw12345678')

    expect(captured).not.toHaveBeenCalled()
    takePendingInviteToken()
  })

  it('tells the native provider block it is rendering the sign-up funnel', async () => {
    await renderRoute()
    const i18n = await initMobileI18n('en')
    await render(
      <I18nextProvider i18n={i18n}>{capturedSignUpProps?.footer as React.ReactElement}</I18nextProvider>,
    )

    expect(capturedSocialProps?.flow).toBe('sign_up')
  })

  it('renders a normal, unlocked sign-up form when there is no pending invite', async () => {
    await renderRoute()
    expect(capturedSignUpProps).not.toBeNull()
    expect(capturedSignUpProps?.emailLocked).toBe(false)
    expect(capturedSignUpProps?.initialEmail).toBeUndefined()
    expect(mockValidateHouseholdInvite).not.toHaveBeenCalled()
  })

  it('validates a pending invite token and locks the email on success', async () => {
    setPendingInviteToken('tok-1')
    mockValidateHouseholdInvite.mockResolvedValue({
      status: 'valid',
      invite: { email: 'partner@example.com', expiresAt: '2024-01-08T00:00:00.000Z', inviterName: 'Alex' },
    })

    await renderRoute()

    await waitFor(() => expect(capturedSignUpProps?.emailLocked).toBe(true))
    expect(mockValidateHouseholdInvite).toHaveBeenCalledWith('tok-1')
    expect(capturedSignUpProps?.initialEmail).toBe('partner@example.com')
    expect(capturedSignUpProps?.greeting).toBe('Alex invited you to their household')
  })

  it('renders a generic greeting when the invite has no inviter name', async () => {
    setPendingInviteToken('tok-1')
    mockValidateHouseholdInvite.mockResolvedValue({
      status: 'valid',
      invite: { email: 'partner@example.com', expiresAt: '2024-01-08T00:00:00.000Z', inviterName: null },
    })

    await renderRoute()

    await waitFor(() => expect(capturedSignUpProps?.greeting).toBe("You've been invited to a household"))
  })

  it('renders the invalid-invite screen when the token is invalid', async () => {
    setPendingInviteToken('tok-1')
    mockValidateHouseholdInvite.mockResolvedValue({ status: 'invalid' })

    await renderRoute()

    await waitFor(() => expect(capturedInvalidProps).not.toBeNull())
    expect(capturedSignUpProps).toBeNull()
  })

  it('re-arms the invite token store right before calling signUp so activation can consume it', async () => {
    setPendingInviteToken('tok-1')
    mockValidateHouseholdInvite.mockResolvedValue({
      status: 'valid',
      invite: { email: 'partner@example.com', expiresAt: '2024-01-08T00:00:00.000Z', inviterName: 'Alex' },
    })
    mockSignUp.mockResolvedValue({ status: 'accepted' })

    await renderRoute()
    await waitFor(() => expect(capturedSignUpProps?.emailLocked).toBe(true))

    const onSubmit = capturedSignUpProps?.onSubmit as (email: string, password: string) => Promise<string>
    const outcome = await onSubmit('partner@example.com', 'pw12345678')

    expect(outcome).toBe('accepted')
    expect(mockSignUp).toHaveBeenCalledWith('partner@example.com', 'pw12345678')
  })

  it('re-arms the invite token before a native provider sign-up too', async () => {
    setPendingInviteToken('tok-1')
    mockValidateHouseholdInvite.mockResolvedValue({
      status: 'valid',
      invite: { email: 'partner@example.com', expiresAt: '2024-01-08T00:00:00.000Z', inviterName: 'Alex' },
    })

    const i18n = await initMobileI18n('en')
    await renderRoute()
    await waitFor(() => expect(capturedSignUpProps?.emailLocked).toBe(true))
    await render(
      <I18nextProvider i18n={i18n}>{capturedSignUpProps?.footer as React.ReactElement}</I18nextProvider>,
    )

    expect(capturedSocialProps).not.toBeNull()
    await act(async () => (capturedSocialProps?.onBeforeSignIn as () => void)())

    expect(takePendingInviteToken()).toBe('tok-1')
  })

  it('backs out of the invalid state into a normal sign-up form on "continue without invite"', async () => {
    setPendingInviteToken('tok-1')
    mockValidateHouseholdInvite.mockResolvedValue({ status: 'invalid' })

    await renderRoute()
    await waitFor(() => expect(capturedInvalidProps).not.toBeNull())

    const onContinue = capturedInvalidProps?.onContinueWithoutInvite as () => void
    await act(async () => onContinue())

    await waitFor(() => expect(capturedSignUpProps).not.toBeNull())
    expect(capturedSignUpProps?.emailLocked).toBe(false)
  })
})
