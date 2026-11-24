import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import type { i18n as I18n } from 'i18next'

import { ServerSwitchProvider } from '@/components/providers/server-switch-provider'
import { initMobileI18n } from '@/lib/i18n'

import SignInRoute from './sign-in'

/**
 * Which signed-out screen a server gets, read from its real `GET /v1/instance` answer: the setup
 * screen while it has no accounts (`setupRequired: true`), the sign-in screen otherwise, and for
 * an older server that does not send the field.
 */

const mockSignUp = jest.fn()
const mockSignInWithSso = jest.fn()

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ replace: jest.fn() }),
  Link: ({ children }: { children: React.ReactNode }) => children,
}))

jest.mock('@/features/auth/use-pairing', () => ({
  usePairing: () => ({ minAppVersion: null, pair: jest.fn(), reset: jest.fn(), status: 'idle' }),
}))

jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({
    activationError: null,
    blockAccess: jest.fn(),
    clearActivationError: jest.fn(),
    signInWithPassword: jest.fn(),
    signInWithSso: mockSignInWithSso,
    signUp: mockSignUp,
  }),
}))

// The device-dependent blocks are covered by their own tests.
jest.mock('@/features/auth/social-sign-in', () => ({ SocialSignIn: () => null }))
jest.mock('@/features/auth/passkey-sign-in', () => ({ PasskeySignIn: () => null }))
jest.mock('@/features/auth/demo-sign-in', () => ({ DemoSignIn: () => null }))
jest.mock('@/features/auth/scan-pairing-qr', () => ({ ScanPairingQr: () => null }))

const instance = (overrides: Record<string, unknown> = {}, features: Record<string, unknown> = {}) => ({
  apiVersion: 1,
  features: {
    ai: { assistant: false, csvMapping: false, enrichment: false, monthlyStory: false, ocr: false },
    bankSync: false,
    contactForm: false,
    email: true,
    fileStorage: false,
    marketData: false,
    ...features,
  },
  minAppVersion: null,
  name: 'Casa',
  signupMode: 'open',
  ...overrides,
})

const instanceResponse = (body: unknown) => ({ ok: true, json: () => Promise.resolve(body) }) as Response

const SERVER = 'https://money.example.com'
const OTHER_SERVER = 'https://fresh.example.org:8443'

let queryClient: QueryClient
let i18n: I18n
let fetchSpy: jest.SpyInstance

function Harness({ children, server = SERVER }: { children: ReactNode; server?: string }) {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <ServerSwitchProvider value={{ apiBaseUrl: server, switchServer: jest.fn(), usesDefaultServer: false }}>
          {children}
        </ServerSwitchProvider>
      </QueryClientProvider>
    </I18nextProvider>
  )
}

/** Answers each server's `/v1/instance` with its own description. */
function serve(descriptions: Record<string, unknown>) {
  fetchSpy.mockImplementation(async (url: string) => {
    const body = Object.entries(descriptions).find(([server]) => url === `${server}/v1/instance`)?.[1]
    return body ? instanceResponse(body) : Promise.reject(new Error(`unexpected ${url}`))
  })
}

describe('SignInRoute, by what the server says about setup', () => {
  beforeAll(async () => {
    i18n = await initMobileI18n('en')
  })

  beforeEach(() => {
    mockSignUp.mockReset()
    mockSignInWithSso.mockReset()
    fetchSpy = jest.spyOn(globalThis, 'fetch')
    // gcTime Infinity: no garbage-collection timer to outlive the test.
    queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } })
  })

  afterEach(() => {
    queryClient.clear()
    fetchSpy.mockRestore()
  })

  it('offers to set up a server with no accounts, naming it, instead of signing in', async () => {
    serve({ [SERVER]: instance({ setupRequired: true }) })
    const view = await render(<SignInRoute />, { wrapper: Harness })

    expect(await view.findByRole('header', { name: 'Set up this server' })).toBeOnTheScreen()
    expect(view.getByText('Casa (money.example.com) has no accounts yet. The account you create here will own this server and can invite others.')).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Create account' })).toBeOnTheScreen()
    expect(view.getByLabelText('Confirm password')).toBeOnTheScreen()
    expect(view.queryByText('Welcome back')).toBeNull()
    expect(view.queryByRole('button', { name: 'Sign in' })).toBeNull()
    expect(view.queryByText('Not a member?')).toBeNull()
    expect(view.queryByRole('link', { name: 'Forgot your password?' })).toBeNull()
    // The way to another server stays.
    expect(view.getByText('Server: money.example.com')).toBeOnTheScreen()
  })

  it.each([
    ['has accounts', instance({ setupRequired: false })],
    ['predates the setupRequired field', instance()],
    ['sends a malformed setupRequired', instance({ setupRequired: 'yes' })],
  ])('keeps the sign-in screen when the server %s', async (_case, body) => {
    serve({ [SERVER]: body })
    const view = await render(<SignInRoute />, { wrapper: Harness })
    await waitFor(() => expect(queryClient.getQueryState(['instance', SERVER])?.status).toBe('success'))

    expect(view.getByRole('header', { name: 'Welcome back' })).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Sign in' })).toBeOnTheScreen()
    expect(view.queryByText('Set up this server')).toBeNull()
  })

  it('keeps the sign-in screen while the server cannot be asked', async () => {
    fetchSpy.mockRejectedValue(new Error('offline'))
    const view = await render(<SignInRoute />, { wrapper: Harness })
    // The hook retries once, a second later.
    await waitFor(() => expect(queryClient.getQueryState(['instance', SERVER])?.status).toBe('error'), { timeout: 3000 })

    expect(view.getByRole('header', { name: 'Welcome back' })).toBeOnTheScreen()
  })

  it('creates the account with the form, the same sign-up that starts onboarding', async () => {
    serve({ [SERVER]: instance({ setupRequired: true }) })
    mockSignUp.mockResolvedValue({ status: 'accepted' })
    const view = await render(<SignInRoute />, { wrapper: Harness })
    await view.findByRole('header', { name: 'Set up this server' })

    await fireEvent.changeText(view.getByLabelText('Email'), 'owner@example.com')
    await fireEvent.changeText(view.getByLabelText('Password'), 'pw12345678')
    await fireEvent.changeText(view.getByLabelText('Confirm password'), 'pw12345678')
    await fireEvent.press(view.getByRole('checkbox'))
    await fireEvent.press(view.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(mockSignUp).toHaveBeenCalledWith('owner@example.com', 'pw12345678'))
  })

  it('asks the server again after a refused sign-up, and turns into sign-in once it has been set up', async () => {
    serve({ [SERVER]: instance({ setupRequired: true }) })
    mockSignUp.mockResolvedValue({ status: 'unavailable' })
    const view = await render(<SignInRoute />, { wrapper: Harness })
    await view.findByRole('header', { name: 'Set up this server' })

    // Meanwhile someone else created the first account.
    serve({ [SERVER]: instance({ setupRequired: false }) })
    await fireEvent.changeText(view.getByLabelText('Email'), 'late@example.com')
    await fireEvent.changeText(view.getByLabelText('Password'), 'pw12345678')
    await fireEvent.changeText(view.getByLabelText('Confirm password'), 'pw12345678')
    await fireEvent.press(view.getByRole('checkbox'))
    await fireEvent.press(view.getByRole('button', { name: 'Create account' }))

    expect(await view.findByRole('header', { name: 'Welcome back' })).toBeOnTheScreen()
  })

  it('offers only single sign-on on a server that takes no passwords', async () => {
    serve({ [SERVER]: instance({ setupRequired: true }, { oidc: { name: 'Authentik' }, passwordSignIn: false }) })
    const view = await render(<SignInRoute />, { wrapper: Harness })

    expect(await view.findByRole('header', { name: 'Set up this server' })).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Sign in with Authentik' })).toBeOnTheScreen()
    expect(view.queryByLabelText('Email')).toBeNull()
    expect(view.queryByRole('button', { name: 'Create account' })).toBeNull()
  })

  it('reads the flag again for the server it switches to', async () => {
    serve({
      [SERVER]: instance({ setupRequired: false }),
      [OTHER_SERVER]: instance({ name: 'Fresh', setupRequired: true }),
    })
    // The app rebuilds its providers on a switch; the instance query is keyed on the server
    // either way, so even the same query client asks the new one.
    const view = await render(<Harness><SignInRoute /></Harness>)
    expect(await view.findByRole('header', { name: 'Welcome back' })).toBeOnTheScreen()

    await view.rerender(<Harness server={OTHER_SERVER}><SignInRoute /></Harness>)

    expect(await view.findByRole('header', { name: 'Set up this server' })).toBeOnTheScreen()
    expect(view.getByText(/^Fresh \(fresh\.example\.org:8443\) has no accounts yet\./)).toBeOnTheScreen()
  })
})
