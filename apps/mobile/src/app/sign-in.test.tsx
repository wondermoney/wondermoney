import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'
import { captureAnalyticsEvent } from '@/lib/telemetry/analytics'

import SignInRoute from './sign-in'

const mockSignInWithPassword = jest.fn()
const mockClearActivationError = jest.fn()
jest.mock('@/lib/telemetry/analytics', () => ({ captureAnalyticsEvent: jest.fn() }))
const captured = jest.mocked(captureAnalyticsEvent)

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  Link: ({ children }: { children: React.ReactNode }) => children,
}))

jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({
    signInWithPassword: mockSignInWithPassword,
    activationError: null,
    clearActivationError: mockClearActivationError,
  }),
}))

jest.mock('@/features/auth/social-sign-in', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text: NativeText } = require('react-native')
  return { SocialSignIn: () => React.createElement(NativeText, null, 'social-sign-in-block') }
})

async function renderRoute() {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}><SignInRoute /></I18nextProvider>)
}

async function submitCredentials(view: Awaited<ReturnType<typeof renderRoute>>) {
  await fireEvent.changeText(view.getByLabelText('Email'), 'person@example.com')
  await fireEvent.changeText(view.getByLabelText('Password'), 'pw12345678')
  await fireEvent.press(view.getByRole('button', { name: 'Sign in' }))
}

describe('SignInRoute', () => {
  beforeEach(() => {
    captured.mockClear()
    mockSignInWithPassword.mockReset()
  })

  it('captures sign_in_completed with the channel only once the session is accepted', async () => {
    mockSignInWithPassword.mockResolvedValue({ status: 'accepted' })
    const view = await renderRoute()

    await submitCredentials(view)

    await waitFor(() => expect(captured).toHaveBeenCalledTimes(1))
    expect(captured).toHaveBeenCalledWith('sign_in_completed', { provider: 'email' })
    expect(JSON.stringify(captured.mock.calls)).not.toContain('person@example.com')
  })

  it('captures nothing when the credentials are refused', async () => {
    mockSignInWithPassword.mockResolvedValue({ status: 'invalid-credentials' })
    const view = await renderRoute()

    await submitCredentials(view)

    await waitFor(() => expect(mockSignInWithPassword).toHaveBeenCalled())
    expect(captured).not.toHaveBeenCalled()
  })

  it('composes the native provider buttons into the screen footer, not the screen itself', async () => {
    const view = await renderRoute()

    // The password form still comes from the provider-agnostic SignInScreen…
    expect(view.getByRole('button', { name: 'Sign in' })).toBeOnTheScreen()
    // …and Apple/Google only exist because the route composed them in.
    expect(view.getByText('social-sign-in-block')).toBeOnTheScreen()
    expect(view.getByText('Forgot password?')).toBeOnTheScreen()
    expect(view.getByText('New here? Create an account')).toBeOnTheScreen()
  })
})
