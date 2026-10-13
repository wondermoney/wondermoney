import * as LocalAuthentication from 'expo-local-authentication'

import { authenticateWithDeviceAsync, checkLocalAuthCapability } from './local-authentication-adapter'

jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(),
  isEnrolledAsync: jest.fn(),
  authenticateAsync: jest.fn(),
}))

describe('local authentication adapter', () => {
  beforeEach(() => jest.clearAllMocks())

  describe('checkLocalAuthCapability', () => {
    it('reports no-hardware when the device has no scanner', async () => {
      jest.mocked(LocalAuthentication.hasHardwareAsync).mockResolvedValue(false)
      await expect(checkLocalAuthCapability()).resolves.toBe('no-hardware')
      expect(LocalAuthentication.isEnrolledAsync).not.toHaveBeenCalled()
    })

    it('reports not-enrolled when hardware exists but nothing is enrolled', async () => {
      jest.mocked(LocalAuthentication.hasHardwareAsync).mockResolvedValue(true)
      jest.mocked(LocalAuthentication.isEnrolledAsync).mockResolvedValue(false)
      await expect(checkLocalAuthCapability()).resolves.toBe('not-enrolled')
    })

    it('reports available when hardware and enrollment are both present', async () => {
      jest.mocked(LocalAuthentication.hasHardwareAsync).mockResolvedValue(true)
      jest.mocked(LocalAuthentication.isEnrolledAsync).mockResolvedValue(true)
      await expect(checkLocalAuthCapability()).resolves.toBe('available')
    })

    it('fails closed to no-hardware when a check throws', async () => {
      jest.mocked(LocalAuthentication.hasHardwareAsync).mockRejectedValue(new Error('boom'))
      await expect(checkLocalAuthCapability()).resolves.toBe('no-hardware')
    })
  })

  describe('authenticateWithDeviceAsync', () => {
    it('forwards the prompt message and returns the success flag', async () => {
      jest.mocked(LocalAuthentication.authenticateAsync).mockResolvedValue({ success: true })
      await expect(authenticateWithDeviceAsync('Unlock WonderMoney')).resolves.toBe(true)
      expect(LocalAuthentication.authenticateAsync).toHaveBeenCalledWith({ promptMessage: 'Unlock WonderMoney' })
    })

    it('reports failure without throwing on a declined or errored prompt', async () => {
      jest.mocked(LocalAuthentication.authenticateAsync).mockResolvedValue({ success: false, error: 'user_cancel' })
      await expect(authenticateWithDeviceAsync('Unlock WonderMoney')).resolves.toBe(false)
      jest.mocked(LocalAuthentication.authenticateAsync).mockRejectedValue(new Error('boom'))
      await expect(authenticateWithDeviceAsync('Unlock WonderMoney')).resolves.toBe(false)
    })
  })
})
