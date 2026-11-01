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

  it('returns failed when the write throws', async () => {
    const write = jest.fn().mockRejectedValue(new ApiError('network'))
    await expect(provisionAppUser(clientWith(write), 'en')).resolves.toBe('failed')
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
