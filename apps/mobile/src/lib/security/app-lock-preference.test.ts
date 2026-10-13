import * as SecureStore from 'expo-secure-store'

import { getAppLockPreference, setAppLockPreference } from './app-lock-preference'

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn() }))

describe('app lock preference', () => {
  beforeEach(() => jest.clearAllMocks())

  it('reads a persisted "true" value as enabled', async () => {
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue('true')
    await expect(getAppLockPreference()).resolves.toBe(true)
  })

  it('treats any non-"true" stored value, including null, as disabled', async () => {
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null)
    await expect(getAppLockPreference()).resolves.toBe(false)
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue('garbage')
    await expect(getAppLockPreference()).resolves.toBe(false)
  })

  it('fails closed to disabled when the read throws', async () => {
    jest.mocked(SecureStore.getItemAsync).mockRejectedValue(new Error('boom'))
    await expect(getAppLockPreference()).resolves.toBe(false)
  })

  it('persists the boolean as an explicit string', async () => {
    await setAppLockPreference(true)
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('wondermoney.app-lock-enabled', 'true')
    await setAppLockPreference(false)
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('wondermoney.app-lock-enabled', 'false')
  })
})
