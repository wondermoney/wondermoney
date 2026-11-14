jest.mock('react-native-passkeys', () => {
  throw new Error("Cannot find native module 'ReactNativePasskeys'")
})

// eslint-disable-next-line import/first
import { nativePasskeyAuthenticator } from './native-passkeys'

describe('nativePasskeyAuthenticator without the native module', () => {
  it('reports passkeys as unsupported instead of failing the app (Expo Go, an old dev client)', async () => {
    expect(nativePasskeyAuthenticator.isSupported()).toBe(false)
    await expect(nativePasskeyAuthenticator.get({})).rejects.toThrow('NotSupported')
  })
})
