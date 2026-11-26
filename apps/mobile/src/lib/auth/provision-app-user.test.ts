import type { ApiClient } from '@/lib/api/client'
import { ApiError } from '@/lib/api/errors'
import { authCallbackEndpoint, provisionAppUser } from './provision-app-user'

const clientWith = (write: ApiClient['write']): ApiClient => ({ read: jest.fn(), write, readRaw: jest.fn() })

describe('provisionAppUser', () => {
  it('POSTs the callback with the locale and returns provisioned on success', async () => {
    const write = jest.fn().mockImplementation(async (_endpoint, opts) => { opts.commit({}); return {} })
    const result = await provisionAppUser(clientWith(write), 'pt')
    expect(write).toHaveBeenCalledWith(authCallbackEndpoint, expect.objectContaining({ body: { locale: 'pt' } }))
    expect(result).toBe('provisioned')
  })

  it('returns failed when the server refuses the callback', async () => {
    const write = jest.fn().mockRejectedValue(new ApiError('http', 400))
    await expect(provisionAppUser(clientWith(write), 'en')).resolves.toBe('failed')
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('signs in with en on a server that predates the Italian account language', async () => {
    // A server without the Italian account language rejects `it` in its locale enum with a plain
    // validation 400 before any handler runs; refusing the callback there would sign every
    // Italian-language person out.
    const write = jest.fn()
      .mockRejectedValueOnce(new ApiError('http', 400, { serverCode: 'bad_request' }))
      .mockImplementationOnce(async (_endpoint, opts) => { opts.commit({}); return {} })
    await expect(provisionAppUser(clientWith(write), 'it', 'invite-tok-1')).resolves.toBe('provisioned')
    expect(write.mock.calls.map(([, opts]) => opts.body)).toEqual([
      { inviteToken: 'invite-tok-1', locale: 'it' },
      { inviteToken: 'invite-tok-1', locale: 'en' },
    ])
  })

  it('returns failed when the server refuses the en retry too', async () => {
    const write = jest.fn().mockRejectedValue(new ApiError('http', 400, { serverCode: 'bad_request' }))
    await expect(provisionAppUser(clientWith(write), 'it')).resolves.toBe('failed')
    expect(write).toHaveBeenCalledTimes(2)
  })

  it('does not ask again after the unverified reconnect, which has already sent its email', async () => {
    const write = jest.fn().mockRejectedValue(new ApiError('http', 400, { serverCode: 'account_reconnect_email_unverified' }))
    await expect(provisionAppUser(clientWith(write), 'it')).resolves.toBe('failed')
    expect(write).toHaveBeenCalledTimes(1)
  })

  it.each([['en'], ['pt'], ['es']] as const)('does not ask again in en for a %s validation reject', async (locale) => {
    const write = jest.fn().mockRejectedValue(new ApiError('http', 400, { serverCode: 'bad_request' }))
    await expect(provisionAppUser(clientWith(write), locale)).resolves.toBe('failed')
    expect(write).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a 400 without a code', new ApiError('http', 400), 'failed'],
    ['a forbidden callback', new ApiError('http', 403), 'failed'],
    ['a transient failure', new ApiError('http', 503), 'unavailable'],
  ] as const)('does not ask again in en after %s', async (_label, error, outcome) => {
    const write = jest.fn().mockRejectedValue(error)
    await expect(provisionAppUser(clientWith(write), 'it')).resolves.toBe(outcome)
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('returns failed for a non-API error', async () => {
    const write = jest.fn().mockRejectedValue(new Error('boom'))
    await expect(provisionAppUser(clientWith(write), 'en')).resolves.toBe('failed')
  })

  it.each([
    ['a network failure', new ApiError('network')],
    ['a server error', new ApiError('http', 503)],
    ['rate limiting', new ApiError('http', 429)],
  ])('returns unavailable (transient) for %s', async (_label, error) => {
    const write = jest.fn().mockRejectedValue(error)
    await expect(provisionAppUser(clientWith(write), 'en')).resolves.toBe('unavailable')
  })

  it('includes the invite token in the body when provided', async () => {
    const write = jest.fn().mockImplementation(async (_endpoint, opts) => { opts.commit({}); return {} })
    const result = await provisionAppUser(clientWith(write), 'en', 'invite-tok-1')
    expect(write).toHaveBeenCalledWith(authCallbackEndpoint, expect.objectContaining({
      body: { inviteToken: 'invite-tok-1', locale: 'en' },
    }))
    expect(result).toBe('provisioned')
  })

  it('omits the invite token when not provided', async () => {
    const write = jest.fn().mockImplementation(async (_endpoint, opts) => { opts.commit({}); return {} })
    await provisionAppUser(clientWith(write), 'en', undefined)
    expect(write).toHaveBeenCalledWith(authCallbackEndpoint, expect.objectContaining({ body: { locale: 'en' } }))
  })

  it('targets POST /v1/auth/callback', () => {
    expect(authCallbackEndpoint.method).toBe('POST')
    expect(authCallbackEndpoint.path).toBe('/v1/auth/callback')
  })
})
