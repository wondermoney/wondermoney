const mockModule = {
  isSupported: jest.fn(() => true),
  create: jest.fn(),
  get: jest.fn(),
}
jest.mock('react-native-passkeys', () => mockModule)

// eslint-disable-next-line import/first
import { isPasskeyCancellation, nativePasskeyAuthenticator } from './native-passkeys'

describe('nativePasskeyAuthenticator', () => {
  it('hands the server\'s WebAuthn options to the device and returns its credential', async () => {
    mockModule.get.mockResolvedValue({ id: 'cred', response: { signature: 'sig' } })
    const options = { challenge: 'abc', rpId: 'money.example.com' }

    await expect(nativePasskeyAuthenticator.get(options)).resolves.toEqual({ id: 'cred', response: { signature: 'sig' } })
    expect(mockModule.get).toHaveBeenCalledWith(options)

    mockModule.create.mockResolvedValue({ id: 'new' })
    await expect(nativePasskeyAuthenticator.create({ challenge: 'def' })).resolves.toEqual({ id: 'new' })
  })

  it('asks the device once whether it supports passkeys', () => {
    expect(nativePasskeyAuthenticator.isSupported()).toBe(true)
    expect(nativePasskeyAuthenticator.isSupported()).toBe(true)
    expect(mockModule.isSupported).toHaveBeenCalledTimes(1)
  })
})

describe('isPasskeyCancellation', () => {
  it('recognises a closed prompt on iOS and Android, and no passkey on the device', () => {
    expect(isPasskeyCancellation(Object.assign(new Error('User cancelled the passkey interaction'), { code: 'ERR_USER_CANCELLED' }))).toBe(true)
    expect(isPasskeyCancellation(Object.assign(new Error('UserCancelled'), { code: 'Passkey Get' }))).toBe(true)
    expect(isPasskeyCancellation(new Error('NoCredentials'))).toBe(true)
  })

  it('treats anything else as a failure', () => {
    expect(isPasskeyCancellation(new Error('NotConfigured'))).toBe(false)
    expect(isPasskeyCancellation(new Error('DomError: SecurityError - The RP ID is not allowed'))).toBe(false)
    expect(isPasskeyCancellation('UserCancelled')).toBe(false)
    expect(isPasskeyCancellation(null)).toBe(false)
  })
})
