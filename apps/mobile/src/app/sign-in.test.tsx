import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { requestSignUpAfterSignOut, takeSignUpAfterSignOut } from '@/lib/auth/sign-up-after-sign-out'
import { initMobileI18n } from '@/lib/i18n'
import { captureAnalyticsEvent } from '@/lib/telemetry/analytics'

import SignInRoute from './sign-in'

const mockSignInWithPassword = jest.fn()
const mockClearActivationError = jest.fn()
const mockParams: { notice?: string; pairCode?: string; pairServer?: string } = {}
const mockPair = jest.fn()
const mockSignInWithSso = jest.fn()
const mockBlockAccess = jest.fn()
const mockServer: { demo: boolean; oidc: { name: string } | null; passwordSignIn: boolean } = { demo: false, oidc: null, passwordSignIn: true }
const mockReplace = jest.fn()
jest.mock('@/lib/telemetry/analytics', () => ({ captureAnalyticsEvent: jest.fn() }))
const captured = jest.mocked(captureAnalyticsEvent)

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ replace: mockReplace }),
  Link: ({ children }: { children: React.ReactNode }) => children,
}))

jest.mock('@/features/auth/use-pairing', () => ({
  usePairing: () => ({ minAppVersion: null, pair: mockPair, reset: jest.fn(), status: 'idle' }),
}))

jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({
    signInWithPassword: mockSignInWithPassword,
    signInWithSso: mockSignInWithSso,
    blockAccess: mockBlockAccess,
    activationError: null,
    clearActivationError: mockClearActivationError,
  }),
}))

jest.mock('@/lib/server/use-instance', () => ({
  useConfirmedFeature: (select: (features: { demo?: boolean }) => boolean | undefined) => select({ demo: mockServer.demo }) === true,
  useOidcProvider: () => mockServer.oidc,
  usePasswordSignIn: () => mockServer.passwordSignIn,
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
    mockPair.mockReset()
    delete mockParams.notice
    delete mockParams.pairCode
    delete mockParams.pairServer
    mockServer.oidc = null
    mockServer.passwordSignIn = true
    mockServer.demo = false
    mockReplace.mockReset()
    takeSignUpAfterSignOut()
    mockSignInWithSso.mockReset()
    mockBlockAccess.mockReset()
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
    expect(view.getByRole('link', { name: 'Forgot your password?' })).toBeOnTheScreen()
    expect(view.getByText('Not a member?')).toBeOnTheScreen()
    expect(view.getByRole('link', { name: 'Create an account' })).toBeOnTheScreen()
  })

  it('offers the demo only when the server does', async () => {
    const i18n = await initMobileI18n('en')
    const without = await renderRoute()
    expect(without.queryByRole('button', { name: i18n.t('auth.demo.button') })).toBeNull()
    await without.unmount()

    mockServer.demo = true
    const view = await renderRoute()
    expect(view.getByRole('button', { name: i18n.t('auth.demo.button') })).toBeOnTheScreen()
  })

  it('carries on to sign-up when signing out of the demo was to create an account', async () => {
    requestSignUpAfterSignOut()
    await renderRoute()

    expect(mockReplace).toHaveBeenCalledWith('/sign-up')
    expect(takeSignUpAfterSignOut()).toBe(false)
  })

  it('stays on sign-in after an ordinary sign-out', async () => {
    await renderRoute()

    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('offers to scan a pairing QR code', async () => {
    const view = await renderRoute()

    expect(view.getByRole('button', { name: 'Scan QR code' })).toBeOnTheScreen()
  })

  it('exchanges a pairing code that arrived as a deep link, once', async () => {
    mockParams.pairServer = 'https://api.example.test'
    mockParams.pairCode = 'abcdefghijklmnop'
    mockPair.mockResolvedValue('paired')

    await renderRoute()

    await waitFor(() => expect(mockPair).toHaveBeenCalledTimes(1))
    expect(mockPair).toHaveBeenCalledWith({ code: 'abcdefghijklmnop', server: 'https://api.example.test' })
  })

  describe('single sign-on', () => {
    it('offers "Sign in with <name>" next to the password form when the server has it', async () => {
      mockServer.oidc = { name: 'Home SSO' }
      const view = await renderRoute()

      expect(view.getByRole('button', { name: 'Sign in with Home SSO' })).toBeOnTheScreen()
      expect(view.getByLabelText('Password')).toBeOnTheScreen()
    })

    it('has no single sign-on button on a server without it', async () => {
      const view = await renderRoute()

      expect(view.queryByRole('button', { name: /Sign in with/ })).toBeNull()
    })

    it('leaves out the password form under OIDC_ONLY', async () => {
      mockServer.oidc = { name: 'Home SSO' }
      mockServer.passwordSignIn = false
      const view = await renderRoute()

      expect(view.queryByLabelText('Email')).toBeNull()
      expect(view.queryByLabelText('Password')).toBeNull()
      expect(view.queryByRole('link', { name: 'Forgot your password?' })).toBeNull()
      expect(view.getByText('This server signs in through Home SSO.')).toBeOnTheScreen()
      expect(view.getByRole('button', { name: 'Sign in with Home SSO' })).toBeOnTheScreen()
    })

    it('hands a two-factor account to the TOTP challenge', async () => {
      mockServer.oidc = { name: 'Home SSO' }
      mockSignInWithSso.mockResolvedValue({ status: 'mfa-pending' })
      const view = await renderRoute()

      await fireEvent.press(view.getByRole('button', { name: 'Sign in with Home SSO' }))

      await waitFor(() => expect(mockBlockAccess).toHaveBeenCalledWith('mfa-required'))
    })

    it('says so when the sign-in did not finish', async () => {
      mockServer.oidc = { name: 'Home SSO' }
      mockSignInWithSso.mockResolvedValue({ status: 'unavailable' })
      const view = await renderRoute()

      await fireEvent.press(view.getByRole('button', { name: 'Sign in with Home SSO' }))

      expect(await view.findByRole('alert')).toHaveTextContent(/Sign-in with Home SSO didn't finish/)
      expect(mockBlockAccess).not.toHaveBeenCalled()
      expect(captured).not.toHaveBeenCalled()
    })
  })
})
