import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, waitFor } from '@testing-library/react-native'
import type { ReactNode } from 'react'

import { ServerSwitchProvider } from '@/components/providers/server-switch-provider'
import { themeTokens } from '@/theme/tokens'

import { SocialSignIn } from './social-sign-in'

const mockSubmit = jest.fn()
let capturedProps: Record<string, unknown> | null = null

jest.mock('./use-social-sign-in', () => ({
  useSocialSignIn: () => ({
    available: ['apple', 'google'],
    pending: null,
    failure: null,
    submit: mockSubmit,
  }),
}))

jest.mock('./social-sign-in-buttons', () => ({
  SocialSignInButtons: (props: Record<string, unknown>) => {
    capturedProps = props
    return null
  },
}))

const features = (overrides: Record<string, unknown> = {}) => ({
  ai: { assistant: false, csvMapping: false, enrichment: false, monthlyStory: false, ocr: false },
  bankSync: false,
  contactForm: false,
  email: true,
  fileStorage: false,
  marketData: false,
  ...overrides,
})

const instanceResponse = (body: unknown) => ({ ok: true, json: () => Promise.resolve(body) }) as Response
const instance = (featureOverrides: Record<string, unknown>) => ({
  apiVersion: 1,
  features: features(featureOverrides),
  minAppVersion: null,
  name: 'Casa',
  signupMode: 'open',
})

const SERVER = 'https://money.example.com'
let queryClient: QueryClient

function Harness({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ServerSwitchProvider value={{ apiBaseUrl: SERVER, switchServer: jest.fn(), usesDefaultServer: true }}>
        {children}
      </ServerSwitchProvider>
    </QueryClientProvider>
  )
}

/** Waits until the instance query has answered or failed (the hook retries once, a second apart). */
const settled = async () => {
  await waitFor(() => expect(queryClient.getQueryState(['instance', SERVER])?.status).not.toBe('pending'), { timeout: 3000 })
  await flushQueryNotifications()
}

/** React Query batches its re-render notifications on a timer; let them land inside act. */
const flushQueryNotifications = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

describe('SocialSignIn', () => {
  let fetchSpy: jest.SpyInstance

  beforeEach(() => {
    mockSubmit.mockReset()
    capturedProps = null
    fetchSpy = jest.spyOn(globalThis, 'fetch')
    // gcTime Infinity: no garbage-collection timer to outlive the test.
    queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } })
  })

  afterEach(() => {
    queryClient.clear()
    fetchSpy.mockRestore()
  })

  it('offers Google once the server reports Google sign-in', async () => {
    fetchSpy.mockResolvedValue(instanceResponse(instance({ googleSignIn: true })))
    await render(<SocialSignIn />, { wrapper: Harness })

    await settled()
    expect(capturedProps?.providers).toEqual(['apple', 'google'])
    expect(fetchSpy).toHaveBeenCalledWith(`${SERVER}/v1/instance`, expect.anything())
    expect(capturedProps?.scheme).toBe('light')
    expect(capturedProps?.palette).toBe(themeTokens.colors.light)
  })

  it('hides Google while the server description is still loading', async () => {
    fetchSpy.mockReturnValue(new Promise(() => {}))
    await render(<SocialSignIn />, { wrapper: Harness })
    await flushQueryNotifications()

    expect(capturedProps?.providers).toEqual(['apple'])
  })

  it.each([
    ['says Google sign-in is off', instance({ googleSignIn: false })],
    ['predates the googleSignIn field', instance({})],
  ])('hides Google when the server %s', async (_case, body) => {
    fetchSpy.mockResolvedValue(instanceResponse(body))
    await render(<SocialSignIn />, { wrapper: Harness })

    await settled()
    expect(capturedProps?.providers).toEqual(['apple'])
  })

  it('hides Google when the server cannot be asked', async () => {
    fetchSpy.mockRejectedValue(new Error('offline'))
    await render(<SocialSignIn />, { wrapper: Harness })

    await settled()
    expect(capturedProps?.providers).toEqual(['apple'])
  })

  it('runs the caller hook before opening the native sheet', async () => {
    fetchSpy.mockResolvedValue(instanceResponse(instance({ googleSignIn: true })))
    const onBeforeSignIn = jest.fn()
    await render(<SocialSignIn onBeforeSignIn={onBeforeSignIn} />, { wrapper: Harness })
    await settled()

    await act(async () => (capturedProps?.onPress as (provider: string) => void)('apple'))

    expect(onBeforeSignIn).toHaveBeenCalledTimes(1)
    expect(mockSubmit).toHaveBeenCalledWith('apple')
    expect(onBeforeSignIn.mock.invocationCallOrder[0]).toBeLessThan(mockSubmit.mock.invocationCallOrder[0])
  })
})
