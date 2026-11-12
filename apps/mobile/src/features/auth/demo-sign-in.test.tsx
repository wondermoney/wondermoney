import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import type { i18n as I18n } from 'i18next'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'

import { ServerSwitchProvider } from '@/components/providers/server-switch-provider'
import { initMobileI18n } from '@/lib/i18n'

import { DemoSignIn } from './demo-sign-in'

const mockSetItemAsync = jest.fn((_key: string, _value: string, _options?: unknown) => Promise.resolve())
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
  setItemAsync: (key: string, value: string, options?: unknown) => mockSetItemAsync(key, value, options),
}))

const SERVER = 'https://money.example.test'
const session = { cookieName: 'better-auth.session_token', cookieValue: 'token.signature', expiresAt: '2026-01-08T02:00:00.000Z' }

const instance = (demo: boolean | undefined) => ({
  apiVersion: 1,
  features: {
    ai: { assistant: false, csvMapping: false, enrichment: false, monthlyStory: false, ocr: false },
    bankSync: false,
    contactForm: false,
    email: true,
    fileStorage: false,
    marketData: false,
    ...(demo === undefined ? {} : { demo }),
  },
  minAppVersion: null,
  name: 'Casa',
  signupMode: 'open',
})

const jsonResponse = (body: unknown, status = 200) =>
  ({ json: () => Promise.resolve(body), ok: status >= 200 && status < 300, status }) as Response

let queryClient: QueryClient
let i18n: I18n
const switchServer = jest.fn((_url: string | null) => Promise.resolve())

function Harness({ children }: { children: ReactNode }) {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <ServerSwitchProvider value={{ apiBaseUrl: SERVER, switchServer, usesDefaultServer: true }}>
          {children}
        </ServerSwitchProvider>
      </QueryClientProvider>
    </I18nextProvider>
  )
}

const settled = async () => {
  await waitFor(() => expect(queryClient.getQueryState(['instance', SERVER])?.status).not.toBe('pending'), { timeout: 3000 })
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
}

describe('DemoSignIn', () => {
  let fetchSpy: jest.SpyInstance
  /** What `POST /v1/auth/demo` answers in this test. */
  let demoAnswer: () => Promise<Response>

  beforeAll(async () => {
    i18n = await initMobileI18n('en')
  })

  beforeEach(() => {
    mockSetItemAsync.mockClear()
    switchServer.mockClear()
    demoAnswer = () => Promise.resolve(jsonResponse({ session }, 201))
    queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } })
    fetchSpy = jest.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    queryClient.clear()
    fetchSpy.mockRestore()
  })

  const serve = (demo: boolean | undefined) => {
    fetchSpy.mockImplementation((input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/v1/instance')) return Promise.resolve(jsonResponse(instance(demo)))
      if (url.endsWith('/v1/auth/demo')) return demoAnswer()
      return Promise.reject(new Error(`unexpected ${url}`))
    })
  }

  const demoButton = (view: Awaited<ReturnType<typeof render>>) => view.getByRole('button', { name: i18n.t('auth.demo.button') })

  it.each([
    ['says the demo is off', false],
    ['predates the demo field', undefined],
  ])('is not offered when the server %s', async (_case, demo) => {
    serve(demo)
    const view = await render(<DemoSignIn />, { wrapper: Harness })
    await settled()

    expect(view.queryByRole('button', { name: i18n.t('auth.demo.button') })).toBeNull()
  })

  it('is not offered when the server cannot be asked', async () => {
    fetchSpy.mockRejectedValue(new Error('offline'))
    const view = await render(<DemoSignIn />, { wrapper: Harness })
    await settled()

    expect(view.queryByRole('button', { name: i18n.t('auth.demo.button') })).toBeNull()
  })

  it('signs in with one tap: posts to the demo sign-in, stores the session and continues into the app', async () => {
    serve(true)
    const view = await render(<DemoSignIn />, { wrapper: Harness })
    await settled()

    await fireEvent.press(demoButton(view))

    await waitFor(() => expect(switchServer).toHaveBeenCalledTimes(1))
    expect(fetchSpy).toHaveBeenCalledWith(`${SERVER}/v1/auth/demo`, expect.objectContaining({ method: 'POST' }))
    expect(mockSetItemAsync).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('token.signature'), expect.anything())
    expect(mockSetItemAsync.mock.invocationCallOrder[0]).toBeLessThan(switchServer.mock.invocationCallOrder[0])
  })

  it('shows it is working while the request runs', async () => {
    serve(true)
    demoAnswer = () => new Promise(() => {})
    const view = await render(<DemoSignIn />, { wrapper: Harness })
    await settled()

    await fireEvent.press(demoButton(view))

    const pending = await view.findByRole('button', { name: i18n.t('auth.demo.signingIn') })
    expect(pending).toBeDisabled()
  })

  it.each([
    ['the demo is off', () => Promise.resolve(jsonResponse({}, 404)), 'auth.demo.errors.disabled'],
    ['too many demo sign-ins', () => Promise.resolve(jsonResponse({ code: 'RATE_LIMITED', retryAfter: 60 }, 429)), 'auth.demo.errors.rateLimited'],
    ['the demo is not set up', () => Promise.resolve(jsonResponse({ code: 'demo_unavailable' }, 503)), 'auth.demo.errors.unavailable'],
    ['the network fails', () => Promise.reject(new Error('offline')), 'auth.demo.errors.unreachable'],
  ])('says why when %s, without signing in', async (_case, answer, messageKey) => {
    serve(true)
    demoAnswer = answer
    const view = await render(<DemoSignIn />, { wrapper: Harness })
    await settled()

    await fireEvent.press(demoButton(view))

    expect(await view.findByRole('alert')).toHaveTextContent(i18n.t(messageKey))
    expect(mockSetItemAsync).not.toHaveBeenCalled()
    expect(switchServer).not.toHaveBeenCalled()
  })

  it('stops offering a demo the server turned out to have off, and lets other failures retry', async () => {
    serve(true)
    demoAnswer = () => Promise.resolve(jsonResponse({}, 404))
    const view = await render(<DemoSignIn />, { wrapper: Harness })
    await settled()
    await fireEvent.press(demoButton(view))
    await view.findByRole('alert')
    expect(demoButton(view)).toBeDisabled()

    await view.unmount()
    demoAnswer = () => Promise.resolve(jsonResponse({}, 503))
    const again = await render(<DemoSignIn />, { wrapper: Harness })
    await settled()
    await fireEvent.press(demoButton(again))
    await again.findByRole('alert')
    expect(demoButton(again)).toBeEnabled()
  })
})
