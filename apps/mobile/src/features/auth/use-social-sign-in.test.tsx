import { act, renderHook, waitFor } from '@testing-library/react-native'

import type { NativeIdentityProviders } from '@/lib/auth/native-identity'
import { captureAnalyticsEvent } from '@/lib/telemetry/analytics'

import { useSocialSignIn, type SocialSignInFlow } from './use-social-sign-in'

const mockSignInWithIdToken = jest.fn()
jest.mock('@/components/providers/product-runtime-provider', () => ({
  useProductRuntime: () => ({ signInWithIdToken: mockSignInWithIdToken }),
}))
jest.mock('@/lib/telemetry/analytics', () => ({ captureAnalyticsEvent: jest.fn() }))
const captured = jest.mocked(captureAnalyticsEvent)

const providers = () => ({
  apple: {
    isAvailable: jest.fn(async () => true),
    requestIdentity: jest.fn(async () => ({ status: 'obtained', idToken: 'apple-token', nonce: 'apple-nonce' })),
  },
  google: {
    isAvailable: jest.fn(async () => true),
    requestIdentity: jest.fn(async () => ({ status: 'obtained', idToken: 'google-token', nonce: 'google-nonce' })),
  },
}) as unknown as NativeIdentityProviders & {
  apple: { isAvailable: jest.Mock; requestIdentity: jest.Mock }
  google: { isAvailable: jest.Mock; requestIdentity: jest.Mock }
}

const renderSocialSignIn = async (fakes: ReturnType<typeof providers>, flow?: SocialSignInFlow) => {
  const hook = await renderHook(() => useSocialSignIn(fakes, flow))
  await waitFor(() => expect(hook.result.current.available.length).toBeGreaterThan(0))
  return hook
}

describe('useSocialSignIn', () => {
  beforeEach(() => {
    mockSignInWithIdToken.mockReset()
    captured.mockClear()
  })

  it('offers Apple ahead of Google wherever both are supported', async () => {
    const hook = await renderSocialSignIn(providers())

    expect(hook.result.current.available).toEqual(['apple', 'google'])
  })

  it('offers Google alone where Sign in with Apple is unsupported', async () => {
    const fakes = providers()
    fakes.apple.isAvailable.mockResolvedValue(false)

    const hook = await renderSocialSignIn(fakes)

    expect(hook.result.current.available).toEqual(['google'])
  })

  it('exchanges the provider token and its raw nonce for a session', async () => {
    mockSignInWithIdToken.mockResolvedValue({ status: 'accepted' })
    const fakes = providers()
    const hook = await renderSocialSignIn(fakes)

    await act(async () => { await hook.result.current.submit('apple') })

    expect(mockSignInWithIdToken).toHaveBeenCalledWith('apple', 'apple-token', 'apple-nonce')
    expect(hook.result.current.failure).toBeNull()
    expect(hook.result.current.pending).toBeNull()
  })

  it('stays silent when the user backs out of the native sheet', async () => {
    const fakes = providers()
    fakes.google.requestIdentity.mockResolvedValue({ status: 'cancelled' })
    const hook = await renderSocialSignIn(fakes)

    await act(async () => { await hook.result.current.submit('google') })

    expect(mockSignInWithIdToken).not.toHaveBeenCalled()
    expect(hook.result.current.failure).toBeNull()
  })

  it('surfaces a safe failure when the provider or the exchange fails', async () => {
    const fakes = providers()
    fakes.google.requestIdentity.mockResolvedValue({ status: 'unavailable' })
    const hook = await renderSocialSignIn(fakes)

    await act(async () => { await hook.result.current.submit('google') })
    expect(hook.result.current.failure).toBe('unavailable')
    expect(mockSignInWithIdToken).not.toHaveBeenCalled()

    fakes.google.requestIdentity.mockResolvedValue({ status: 'obtained', idToken: 'google-token', nonce: 'google-nonce' })
    mockSignInWithIdToken.mockResolvedValue({ status: 'unavailable' })
    await act(async () => { await hook.result.current.submit('google') })
    expect(hook.result.current.failure).toBe('unavailable')

    fakes.google.requestIdentity.mockRejectedValue(new Error('native crash for google-token'))
    await act(async () => { await hook.result.current.submit('google') })
    expect(hook.result.current.failure).toBe('unavailable')
  })

  it.each([
    ['apple', 'sign_in' as const, 'sign_in_completed'],
    ['google', 'sign_in' as const, 'sign_in_completed'],
    ['apple', 'sign_up' as const, 'sign_up_completed'],
    ['google', 'sign_up' as const, 'sign_up_completed'],
  ])('captures %s in the %s funnel as %s with the provider alone (RAD-518)', async (provider, flow, event) => {
    mockSignInWithIdToken.mockResolvedValue({ status: 'accepted' })
    const hook = await renderSocialSignIn(providers(), flow)

    await act(async () => { await hook.result.current.submit(provider as 'apple' | 'google') })

    expect(captured.mock.calls).toEqual([[event, { provider }]])
    const serialized = JSON.stringify(captured.mock.calls)
    expect(serialized).not.toContain('token')
    expect(serialized).not.toContain('nonce')
  })

  it('captures nothing when the sheet is cancelled or the exchange is refused', async () => {
    const fakes = providers()
    fakes.google.requestIdentity.mockResolvedValue({ status: 'cancelled' })
    const hook = await renderSocialSignIn(fakes)
    await act(async () => { await hook.result.current.submit('google') })
    expect(captured).not.toHaveBeenCalled()

    fakes.google.requestIdentity.mockResolvedValue({ status: 'obtained', idToken: 'google-token', nonce: 'google-nonce' })
    mockSignInWithIdToken.mockResolvedValue({ status: 'unavailable' })
    await act(async () => { await hook.result.current.submit('google') })
    expect(captured).not.toHaveBeenCalled()
  })

  it('ignores a second press while a sheet is already open', async () => {
    let resolveIdentity!: (value: { status: 'cancelled' }) => void
    const fakes = providers()
    fakes.apple.requestIdentity.mockReturnValue(new Promise((resolve) => { resolveIdentity = resolve }))
    const hook = await renderSocialSignIn(fakes)

    let first!: Promise<void>
    await act(() => { first = hook.result.current.submit('apple') })
    expect(hook.result.current.pending).toBe('apple')
    await act(() => { void hook.result.current.submit('google') })
    expect(fakes.google.requestIdentity).not.toHaveBeenCalled()

    await act(async () => {
      resolveIdentity({ status: 'cancelled' })
      await first
    })
    expect(hook.result.current.pending).toBeNull()
  })
})
