import { checkServer, isOlderVersion, normalizeServerUrl } from './server-connection'

const instance = (overrides: Record<string, unknown> = {}) => ({
  apiVersion: 1,
  features: { ai: { assistant: true, csvMapping: true, enrichment: true, monthlyStory: true, ocr: true }, bankSync: true, contactForm: false, email: true, fileStorage: true, marketData: false },
  minAppVersion: null,
  name: 'Casa',
  signupMode: 'open',
  ...overrides,
})

const respond = (body: unknown, ok = true) => jest.fn().mockResolvedValue({ ok, json: () => Promise.resolve(body) })

describe('normalizeServerUrl', () => {
  it('adds https and drops a trailing slash', () => {
    expect(normalizeServerUrl(' money.example.com/ ')).toBe('https://money.example.com')
    expect(normalizeServerUrl('http://192.168.1.10:3001')).toBe('http://192.168.1.10:3001')
  })

  it('rejects anything that is not a web address', () => {
    expect(normalizeServerUrl('')).toBeNull()
    expect(normalizeServerUrl('ftp://example.com')).toBeNull()
    expect(normalizeServerUrl('not a url')).toBeNull()
  })
})

describe('isOlderVersion', () => {
  it('compares semantic versions numerically', () => {
    expect(isOlderVersion('2.0.9', '2.1.0')).toBe(true)
    expect(isOlderVersion('2.10.0', '2.9.0')).toBe(false)
    expect(isOlderVersion('2.1.0', '2.1.0')).toBe(false)
  })
})

describe('checkServer', () => {
  it('accepts a WonderMoney server and returns its description', async () => {
    const fetchImpl = respond(instance())
    await expect(checkServer('https://money.example.com', { appVersion: '1.0.0', fetchImpl })).resolves.toEqual({ instance: expect.objectContaining({ name: 'Casa' }), status: 'ok' })
    expect(fetchImpl).toHaveBeenCalledWith('https://money.example.com/v1/instance', expect.anything())
  })

  it('reports an address that does not answer', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('offline'))
    await expect(checkServer('https://down.example.com', { appVersion: '1.0.0', fetchImpl })).resolves.toEqual({ status: 'unreachable' })
  })

  it('reports a server that is not a WonderMoney API', async () => {
    await expect(checkServer('https://example.com', { appVersion: '1.0.0', fetchImpl: respond({ hello: 'world' }) })).resolves.toEqual({ status: 'not-wondermoney' })
    await expect(checkServer('https://example.com', { appVersion: '1.0.0', fetchImpl: respond({}, false) })).resolves.toEqual({ status: 'not-wondermoney' })
  })

  it('still recognises a newer server that adds fields, features or a signup mode', async () => {
    const body = instance({ signupMode: 'waitlist', region: 'eu', features: { ...instance().features, payments: true } })
    const result = await checkServer('https://money.example.com', { appVersion: '1.0.0', fetchImpl: respond(body) })
    expect(result).toMatchObject({ status: 'ok', instance: { signupMode: 'unknown' } })
    expect(result.status === 'ok' && result.instance).not.toHaveProperty('region')
  })

  it('asks for an app update when the server needs a newer version', async () => {
    await expect(checkServer('https://money.example.com', { appVersion: '1.0.0', fetchImpl: respond(instance({ minAppVersion: '1.2.0' })) })).resolves.toEqual({ minAppVersion: '1.2.0', status: 'update-required' })
  })
})
