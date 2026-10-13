import * as AppleAuthentication from 'expo-apple-authentication'

import { createAppleIdentityProvider, type ApplePort } from './apple-identity-provider'

const applePort = () => ({
  isAvailableAsync: jest.fn(async () => true),
  signInAsync: jest.fn(async () => ({ identityToken: 'apple-id-token', state: 'attempt-state' })),
}) as unknown as ApplePort & { isAvailableAsync: jest.Mock; signInAsync: jest.Mock }

const nonce = async () => ({ raw: 'raw-nonce', hashed: 'hashed-nonce' })
const state = async () => 'attempt-state'

describe('Apple identity provider', () => {
  it('sends only the hashed nonce to Apple and keeps the raw half for Supabase', async () => {
    const apple = applePort()
    const provider = createAppleIdentityProvider({ apple, createNonce: nonce, createState: state })

    await expect(provider.requestIdentity()).resolves.toEqual({
      status: 'obtained',
      idToken: 'apple-id-token',
      nonce: 'raw-nonce',
    })
    expect(apple.signInAsync).toHaveBeenCalledWith({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: 'hashed-nonce',
      state: 'attempt-state',
    })
  })

  it('discards a credential whose state is not the one this attempt sent', async () => {
    const apple = applePort()
    apple.signInAsync.mockResolvedValue({ identityToken: 'apple-id-token', state: 'someone-elses-state' })

    await expect(createAppleIdentityProvider({ apple, createNonce: nonce, createState: state }).requestIdentity())
      .resolves.toEqual({ status: 'unavailable' })
  })

  it('treats a dismissed sheet as a cancellation, not a failure', async () => {
    const apple = applePort()
    apple.signInAsync.mockRejectedValue(Object.assign(new Error('canceled'), { code: 'ERR_REQUEST_CANCELED' }))
    const provider = createAppleIdentityProvider({ apple, createNonce: nonce, createState: state })

    await expect(provider.requestIdentity()).resolves.toEqual({ status: 'cancelled' })
  })

  it('reports unavailable without echoing the provider error or a partial credential', async () => {
    const apple = applePort()
    apple.signInAsync.mockRejectedValue(
      Object.assign(new Error('request failed for token apple-id-token'), { code: 'ERR_REQUEST_FAILED' }),
    )
    const provider = createAppleIdentityProvider({ apple, createNonce: nonce, createState: state })

    const outcome = await provider.requestIdentity()

    expect(outcome).toEqual({ status: 'unavailable' })
    expect(JSON.stringify(outcome)).not.toContain('apple-id-token')

    apple.signInAsync.mockResolvedValue({ identityToken: null, state: 'attempt-state' })
    await expect(provider.requestIdentity()).resolves.toEqual({ status: 'unavailable' })
  })

  it('reports unavailable on platforms where the native module is absent', async () => {
    const apple = applePort()
    apple.isAvailableAsync.mockResolvedValue(false)
    await expect(createAppleIdentityProvider({ apple, createNonce: nonce, createState: state }).isAvailable()).resolves.toBe(false)

    apple.isAvailableAsync.mockRejectedValue(new Error('no native module'))
    await expect(createAppleIdentityProvider({ apple, createNonce: nonce, createState: state }).isAvailable()).resolves.toBe(false)
  })
})
