import * as SecureStore from 'expo-secure-store'

import { secureStorePreferenceStorage } from './preference-storage'

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>()
  return {
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value)
    }),
  }
})

describe('preference storage: privacy mode', () => {
  it('is unset until a choice is saved', async () => {
    await expect(secureStorePreferenceStorage.load()).resolves.toMatchObject({ privacyMode: null })
  })

  it('round-trips the choice through SecureStore', async () => {
    await secureStorePreferenceStorage.savePrivacyMode(true)
    expect(SecureStore.setItemAsync).toHaveBeenLastCalledWith('wondermoney.privacy-mode', 'on')
    await expect(secureStorePreferenceStorage.load()).resolves.toMatchObject({ privacyMode: true })

    await secureStorePreferenceStorage.savePrivacyMode(false)
    await expect(secureStorePreferenceStorage.load()).resolves.toMatchObject({ privacyMode: false })
  })

  it('reads an unrecognised stored value as unset', async () => {
    await SecureStore.setItemAsync('wondermoney.privacy-mode', 'garbage')
    await expect(secureStorePreferenceStorage.load()).resolves.toMatchObject({ privacyMode: null })
  })

  it('reads as unset when SecureStore throws', async () => {
    jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error('locked')).mockRejectedValueOnce(new Error('locked')).mockRejectedValueOnce(new Error('locked'))
    await expect(secureStorePreferenceStorage.load()).resolves.toEqual({ theme: null, language: null, privacyMode: null })
  })
})
