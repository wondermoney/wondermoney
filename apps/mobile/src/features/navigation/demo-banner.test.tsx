import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as Linking from 'expo-linking'
import { Slot } from 'expo-router'
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library'
import type { i18n as I18n } from 'i18next'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { Text } from 'react-native'

import AuthenticatedLayout from '@/app/(app)/_layout'
import { ServerSwitchProvider } from '@/components/providers/server-switch-provider'
import { selfHostingDocs } from '@/features/more/link-policy'
import { profileKey } from '@/features/self/query-keys'
import { takeSignUpAfterSignOut } from '@/lib/auth/sign-up-after-sign-out'
import { initMobileI18n } from '@/lib/i18n'

jest.mock('@/components/providers/authenticated-route-boundary', () => ({
  AuthenticatedRouteBoundary: ({ children }: { children: ReactNode }) => children,
}))
jest.mock('@/features/onboarding/onboarding-gate', () => ({
  OnboardingGate: ({ children }: { children: ReactNode }) => children,
}))
jest.mock('@/features/security/app-lock-gate', () => ({
  AppLockGate: ({ children }: { children: ReactNode }) => children,
}))

const mockRead = jest.fn()
const mockSignOut = jest.fn(() => Promise.resolve())
jest.mock('@/components/providers/product-runtime-provider', () => {
  const value = {
    runtime: { epochId: 1, principalId: 'demo-user', apiClient: { read: (...args: unknown[]) => mockRead(...args) } },
    signOut: () => mockSignOut(),
    blockAccess: jest.fn(),
  }
  return { useOptionalProductRuntime: () => value, useProductRuntime: () => value }
})

jest.mock('expo-linking', () => ({ ...jest.requireActual('expo-linking'), openURL: jest.fn(() => Promise.resolve(true)) }))
const openURL = jest.mocked(Linking.openURL)

const SERVER = 'https://money.example.test'
const profile = (demo?: boolean) => ({
  profile: { emailAddress: 'demo@example.com', firstName: 'Demo', lastName: null, mfaEnabled: false, ...(demo === undefined ? {} : { demo }) },
})
const instance = (signupMode: string) => ({
  apiVersion: 1,
  features: {
    ai: { assistant: false, csvMapping: false, enrichment: false, monthlyStory: false, ocr: false },
    bankSync: false,
    contactForm: false,
    demo: true,
    email: true,
    fileStorage: false,
    marketData: false,
  },
  minAppVersion: null,
  name: 'Casa',
  signupMode,
})

let i18n: I18n
let queryClient: QueryClient
let fetchSpy: jest.SpyInstance

async function renderApp({ demo, signupMode = 'open', initialUrl = '/', locale = 'en' }: {
  demo?: boolean
  signupMode?: string
  initialUrl?: string
  locale?: string
}) {
  i18n = await initMobileI18n(locale)
  mockRead.mockResolvedValue(profile(demo))
  fetchSpy.mockImplementation((input: string | URL | Request) =>
    String(input).endsWith('/v1/instance')
      ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(instance(signupMode)) } as Response)
      : Promise.reject(new Error('unexpected request')))
  const Root = () => (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <ServerSwitchProvider value={{ apiBaseUrl: SERVER, switchServer: jest.fn(), usesDefaultServer: true }}>
          <Slot />
        </ServerSwitchProvider>
      </QueryClientProvider>
    </I18nextProvider>
  )
  await renderRouter({
    _layout: Root,
    '(app)/_layout': AuthenticatedLayout,
    '(app)/(tabs)/index': () => <Text>home screen</Text>,
    '(app)/accounts/create': () => <Text>create account screen</Text>,
  }, { initialUrl })
  // The profile answers first; only the demo's banner then asks the server whether it takes sign-ups.
  await waitFor(() => expect(queryClient.getQueryState(profileKey(1))?.status).toBe('success'))
  if (demo) await waitFor(() => expect(queryClient.getQueryState(['instance', SERVER])?.status).toBe('success'))
}

const t = (key: string) => i18n.t(key)

describe('DemoBanner', () => {
  beforeEach(() => {
    mockRead.mockReset()
    mockSignOut.mockClear()
    openURL.mockClear()
    takeSignUpAfterSignOut()
    queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } })
    fetchSpy = jest.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    queryClient.clear()
    fetchSpy.mockRestore()
  })

  it('tells a demo visitor the data is a shared read-only demo, under the top bar', async () => {
    await renderApp({ demo: true })

    expect(await screen.findByTestId('demo-banner')).toBeOnTheScreen()
    expect(screen.getByText(t('demo.banner.message'))).toBeOnTheScreen()
    expect(screen.getByTestId('app-top-bar')).toBeOnTheScreen()
  })

  it('stays on screens without the top bar', async () => {
    await renderApp({ demo: true, initialUrl: '/accounts/create' })

    expect(await screen.findByTestId('demo-banner')).toBeOnTheScreen()
    expect(screen.queryByTestId('app-top-bar')).not.toBeOnTheScreen()
    expect(screen.getByText('create account screen')).toBeOnTheScreen()
  })

  it.each([
    ['a regular account', false],
    ['a server that predates the field', undefined],
  ])('is not shown for %s', async (_case, demo) => {
    await renderApp({ demo })

    expect(screen.getByText('home screen')).toBeOnTheScreen()
    expect(screen.queryByTestId('demo-banner')).not.toBeOnTheScreen()
  })

  it('signs the demo out before going to sign-up, when the server takes sign-ups', async () => {
    await renderApp({ demo: true, signupMode: 'open' })

    await fireEvent.press(await screen.findByRole('link', { name: t('demo.banner.signUp') }))

    expect(mockSignOut).toHaveBeenCalledTimes(1)
    // The sign-in screen the sign-out lands on carries on to sign-up.
    expect(takeSignUpAfterSignOut()).toBe(true)
  })

  it.each(['invite', 'closed'])('offers no sign-up when sign-up is %s', async (signupMode) => {
    await renderApp({ demo: true, signupMode })

    expect(await screen.findByTestId('demo-banner')).toBeOnTheScreen()
    expect(screen.queryByRole('link', { name: t('demo.banner.signUp') })).not.toBeOnTheScreen()
    expect(screen.getByRole('link', { name: t('demo.banner.selfHost') })).toBeOnTheScreen()
  })

  it.each([
    ['en', selfHostingDocs.en],
    ['pt-PT', selfHostingDocs.pt],
    ['es', selfHostingDocs.es],
  ])('opens the self-hosting docs in the app language (%s)', async (locale, url) => {
    await renderApp({ demo: true, locale })

    await fireEvent.press(await screen.findByRole('link', { name: t('demo.banner.selfHost') }))

    expect(openURL).toHaveBeenCalledWith(url)
    expect(mockSignOut).not.toHaveBeenCalled()
  })
})
