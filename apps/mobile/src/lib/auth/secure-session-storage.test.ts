import * as SecureStore from 'expo-secure-store'

import { createBetterAuthExpoStorage, createSecureSessionStorage } from './secure-session-storage'

describe('secure session storage', () => {
  const key = 'sb-test-auth-token'
  const value = JSON.stringify({ access_token: 'token', refresh_token: 'refresh' })
  const nativeConstant = SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY

  const createStore = () => ({
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: nativeConstant,
    getItemAsync: jest.fn(),
    setItemAsync: jest.fn(),
    deleteItemAsync: jest.fn(),
  })

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    expect(console.log).not.toHaveBeenCalled()
    expect(console.warn).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
    jest.restoreAllMocks()
  })

  it('forwards set/get/remove with the injected secure-store options and no biometrics', async () => {
    const store = createStore()
    store.setItemAsync.mockResolvedValue(undefined)
    store.getItemAsync.mockResolvedValue(value)
    store.deleteItemAsync.mockResolvedValue(undefined)

    const sessionStorage = createSecureSessionStorage(store)

    await expect(sessionStorage.setItem(key, value)).resolves.toBeUndefined()
    await expect(sessionStorage.getItem(key)).resolves.toBe(value)
    await expect(sessionStorage.removeItem(key)).resolves.toBeUndefined()

    const expectedOptions = {
      keychainAccessible: nativeConstant,
      requireAuthentication: false,
    }
    expect(store.setItemAsync).toHaveBeenCalledWith(key, value, expectedOptions)
    expect(store.getItemAsync).toHaveBeenCalledWith(key, expectedOptions)
    expect(store.deleteItemAsync).toHaveBeenCalledWith(key, expectedOptions)
  })

  it('round-trips stored strings and treats only null as missing', async () => {
    const store = createStore()
    store.getItemAsync.mockResolvedValueOnce(null)
    store.getItemAsync.mockResolvedValueOnce('{bad json')
    store.getItemAsync.mockResolvedValueOnce(value)

    const sessionStorage = createSecureSessionStorage(store)

    await expect(sessionStorage.getItem(key)).resolves.toBeNull()
    await expect(sessionStorage.getItem(key)).resolves.toBe('{bad json')
    await expect(sessionStorage.getItem(key)).resolves.toBe(value)
  })

  it('throws on non-string native reads as corruption', async () => {
    const store = createStore()
    store.getItemAsync.mockResolvedValueOnce(123)
    const sessionStorage = createSecureSessionStorage(store)

    await expect(sessionStorage.getItem(key)).rejects.toMatchObject({
      name: 'SecureSessionStorageError',
      message: 'Secure session storage operation failed',
      operation: 'read',
    })
  })

  it.each([
    ['write', 'setItemAsync', new Error('store write failed')],
    ['read', 'getItemAsync', new Error('store read failed')],
    ['delete', 'deleteItemAsync', new Error('store delete failed')],
    ['unavailable', 'getItemAsync', new Error('store unavailable')],
    ['large-write', 'setItemAsync', new Error('value too large')],
  ])('wraps %s failures as sanitized typed storage errors', async (_label, method, cause) => {
    const store = createStore()
    if (method === 'setItemAsync') {
      store.setItemAsync.mockRejectedValue(cause)
    } else if (method === 'deleteItemAsync') {
      store.deleteItemAsync.mockRejectedValue(cause)
    } else {
      store.getItemAsync.mockRejectedValue(cause)
    }
    const sessionStorage = createSecureSessionStorage(store)

    const error = await (
      method === 'setItemAsync'
        ? sessionStorage.setItem(key, value)
        : method === 'deleteItemAsync'
          ? sessionStorage.removeItem(key)
          : sessionStorage.getItem(key)
    ).catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      name: 'SecureSessionStorageError',
      message: 'Secure session storage operation failed',
      operation: method === 'setItemAsync' ? 'write' : method === 'deleteItemAsync' ? 'delete' : 'read',
    })
    expect(error).not.toHaveProperty('cause')
    expect(JSON.stringify(error)).not.toContain(key)
    expect(JSON.stringify(error)).not.toContain(value)
    expect(JSON.stringify(error)).not.toContain(cause.message)
  })

  it('does not fall back to plaintext or log session data in messages', async () => {
    const store = createStore()
    store.getItemAsync.mockRejectedValue(new Error('secret key token refresh should stay hidden'))
    const sessionStorage = createSecureSessionStorage(store)

    await expect(sessionStorage.getItem(key)).rejects.toHaveProperty('message', 'Secure session storage operation failed')
    await expect(sessionStorage.getItem(key)).rejects.not.toHaveProperty('message', expect.stringContaining(key))
    await expect(sessionStorage.getItem(key)).rejects.not.toHaveProperty('message', expect.stringContaining(value))
  })

  it('exposes the vendor-neutral async storage method names', () => {
    const store = createStore()
    const sessionStorage = createSecureSessionStorage(store)

    expect(sessionStorage).toEqual(expect.objectContaining({
      getItem: expect.any(Function),
      setItem: expect.any(Function),
      removeItem: expect.any(Function),
    }))
  })

  it('classifies read failures as recoverable and write/delete failures as destructive', async () => {
    const store = createStore()
    store.getItemAsync.mockRejectedValue(new Error('locked'))
    store.setItemAsync.mockRejectedValue(new Error('locked'))
    store.deleteItemAsync.mockRejectedValue(new Error('locked'))
    const sessionStorage = createSecureSessionStorage(store)

    const read = await sessionStorage.getItem(key).catch((error: unknown) => error)
    expect(read).toHaveProperty('failure', 'recoverable')

    const write = await sessionStorage.setItem(key, value).catch((error: unknown) => error)
    expect(write).toHaveProperty('failure', 'destructive')

    const remove = await sessionStorage.removeItem(key).catch((error: unknown) => error)
    expect(remove).toHaveProperty('failure', 'destructive')
  })
})

describe('createBetterAuthExpoStorage', () => {
  const key = 'better-auth.session_token'

  it('exposes sync and async accessors over the hardened store', async () => {
    const store = {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      getItem: jest.fn(() => 'sync-value'),
      setItem: jest.fn(),
      getItemAsync: jest.fn(async () => 'async-value'),
      setItemAsync: jest.fn(async () => undefined),
      deleteItemAsync: jest.fn(async () => undefined),
    }

    const storage = createBetterAuthExpoStorage(store)

    expect(storage.getItem(key)).toBe('sync-value')
    await expect(storage.getItemAsync(key)).resolves.toBe('async-value')
    storage.setItem(key, 'v')
    await storage.setItemAsync(key, 'v')

    const options = {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      requireAuthentication: false,
    }
    expect(store.getItem).toHaveBeenCalledWith(key, options)
    expect(store.setItem).toHaveBeenCalledWith(key, 'v', options)
    expect(store.getItemAsync).toHaveBeenCalledWith(key, options)
    expect(store.setItemAsync).toHaveBeenCalledWith(key, 'v', options)
  })

  it('fails closed on a sync read/write error instead of returning plaintext', () => {
    const store = {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      getItem: jest.fn(() => { throw new Error('locked') }),
      setItem: jest.fn(() => { throw new Error('locked') }),
      getItemAsync: jest.fn(async () => null),
      setItemAsync: jest.fn(async () => undefined),
      deleteItemAsync: jest.fn(async () => undefined),
    }

    const storage = createBetterAuthExpoStorage(store)

    expect(() => storage.getItem(key)).toThrow('Secure session storage operation failed')
    expect(() => storage.setItem(key, 'v')).toThrow('Secure session storage operation failed')
  })
})
