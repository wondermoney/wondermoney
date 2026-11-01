import { createGoogleIdentityProvider, type GooglePort } from './google-identity-provider'
import { googleOAuthClients } from './google-oauth-clients'

const googlePort = () => ({
  configure: jest.fn(),
  checkPlayServices: jest.fn(async () => undefined),
  presentExplicitSignIn: jest.fn(async () => ({
    type: 'success',
    data: { idToken: 'google-id-token', user: {}, scopes: [], serverAuthCode: null },
  })),
}) as unknown as GooglePort & { configure: jest.Mock; checkPlayServices: jest.Mock; presentExplicitSignIn: jest.Mock }

const nonce = async () => ({ raw: 'raw-nonce', hashed: 'hashed-nonce' })

describe('Google identity provider', () => {
  it('hands the API the same nonce Google embeds in the token', async () => {
    // The API's Google verifier compares the token's `nonce` claim to this value exactly
    // (Apple's also accepts the raw half and hashes it; Google's does not), and Google
    // copies the configured nonce into the claim verbatim.
    const google = googlePort()
    const provider = createGoogleIdentityProvider({ google, createNonce: nonce })

    await expect(provider.requestIdentity()).resolves.toEqual({
      status: 'obtained',
      idToken: 'google-id-token',
      nonce: 'hashed-nonce',
    })
    expect(google.configure).toHaveBeenCalledWith({
      webClientId: googleOAuthClients.webClientId,
      iosClientId: googleOAuthClients.iosClientId,
      nonce: 'hashed-nonce',
    })
    expect(google.checkPlayServices).toHaveBeenCalledTimes(1)
  })

  it('always uses the explicit sheet, so the token carries this attempt nonce', async () => {
    const google = googlePort()

    await createGoogleIdentityProvider({ google, createNonce: nonce }).requestIdentity()

    expect(google.presentExplicitSignIn).toHaveBeenCalledTimes(1)
    expect(google.configure.mock.invocationCallOrder[0])
      .toBeLessThan(google.presentExplicitSignIn.mock.invocationCallOrder[0])
  })

  it('treats a dismissed sheet as a cancellation whether it resolves or throws', async () => {
    const google = googlePort()
    google.presentExplicitSignIn.mockResolvedValue({ type: 'cancelled', data: null })
    const provider = createGoogleIdentityProvider({ google, createNonce: nonce })

    await expect(provider.requestIdentity()).resolves.toEqual({ status: 'cancelled' })

    google.presentExplicitSignIn.mockRejectedValue(
      Object.assign(new Error('cancelled'), { code: 'SIGN_IN_CANCELLED' }),
    )
    await expect(provider.requestIdentity()).resolves.toEqual({ status: 'cancelled' })
  })

  it('reports unavailable without echoing the provider error', async () => {
    const google = googlePort()
    google.checkPlayServices.mockRejectedValue(
      Object.assign(new Error('play services missing for google-id-token'), { code: 'PLAY_SERVICES_NOT_AVAILABLE' }),
    )
    const provider = createGoogleIdentityProvider({ google, createNonce: nonce })

    const outcome = await provider.requestIdentity()

    expect(outcome).toEqual({ status: 'unavailable' })
    expect(JSON.stringify(outcome)).not.toContain('google-id-token')
    expect(google.presentExplicitSignIn).not.toHaveBeenCalled()
  })

  it('reports unavailable when the sheet returns no credential', async () => {
    const google = googlePort()
    google.presentExplicitSignIn.mockResolvedValue({ type: 'noSavedCredentialFound', data: null })

    await expect(createGoogleIdentityProvider({ google, createNonce: nonce }).requestIdentity())
      .resolves.toEqual({ status: 'unavailable' })
  })

  it('is offered on every platform', async () => {
    await expect(createGoogleIdentityProvider({ google: googlePort(), createNonce: nonce }).isAvailable())
      .resolves.toBe(true)
  })
})
