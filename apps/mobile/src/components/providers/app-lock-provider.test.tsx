import { act, render, waitFor } from '@testing-library/react-native'
import { useEffect } from 'react'
import { Text } from 'react-native'

import type { AppStatePort } from '@/lib/auth/session-lifecycle'
import { getAppLockPreference, setAppLockPreference } from '@/lib/security/app-lock-preference'
import { authenticateWithDeviceAsync, checkLocalAuthCapability } from '@/lib/security/local-authentication-adapter'

import { AppLockProvider, type AppLockContextValue, useAppLock } from './app-lock-provider'

jest.mock('@/lib/security/app-lock-preference')
jest.mock('@/lib/security/local-authentication-adapter')

function createAppState(): { appState: AppStatePort; emit: (state: string) => void } {
  let listener: ((state: string) => void) | null = null
  return {
    appState: {
      currentState: 'active',
      addEventListener: jest.fn((_event, callback) => {
        listener = callback
        return { remove: jest.fn(() => { listener = null }) }
      }),
    },
    emit: (state) => listener?.(state),
  }
}

function Probe({ capture }: { capture: (value: AppLockContextValue) => void }) {
  const value = useAppLock()
  useEffect(() => { capture(value) }, [capture, value])
  return <Text>{`${value.isLoaded}:${value.enabled}:${value.locked}`}</Text>
}

async function renderProvider(appState: AppStatePort) {
  let current: AppLockContextValue | null = null
  const view = await render(<AppLockProvider appState={appState}><Probe capture={(value) => { current = value }} /></AppLockProvider>)
  await waitFor(() => expect(current?.isLoaded).toBe(true))
  return { view, current: () => current! }
}

describe('AppLockProvider', () => {
  beforeEach(() => jest.clearAllMocks())

  it('loads the persisted preference and starts locked when it was enabled', async () => {
    jest.mocked(getAppLockPreference).mockResolvedValue(true)
    const { appState } = createAppState()
    const { current, view } = await renderProvider(appState)
    expect(current()).toMatchObject({ enabled: true, locked: true })
    await view.unmount()
  })

  it('starts unlocked when the persisted preference was disabled', async () => {
    jest.mocked(getAppLockPreference).mockResolvedValue(false)
    const { appState } = createAppState()
    const { current, view } = await renderProvider(appState)
    expect(current()).toMatchObject({ enabled: false, locked: false })
    await view.unmount()
  })

  it('re-locks on backgrounding while enabled, but not while disabled', async () => {
    jest.mocked(getAppLockPreference).mockResolvedValue(true)
    jest.mocked(authenticateWithDeviceAsync).mockResolvedValue(true)
    const { appState, emit } = createAppState()
    const { current, view } = await renderProvider(appState)
    await act(async () => { await current()!.unlock('Unlock') })
    expect(current()?.locked).toBe(false)

    await act(async () => { emit('background') })
    expect(current()?.locked).toBe(true)

    await act(async () => { await current()!.setEnabled(false, 'Confirm') })
    expect(current()?.enabled).toBe(false)
    await act(async () => { emit('background') })
    expect(current()?.locked).toBe(false)
    await view.unmount()
  })

  it('re-locks on the "inactive" transition (app switcher / system overlay), not just "background"', async () => {
    jest.mocked(getAppLockPreference).mockResolvedValue(true)
    jest.mocked(authenticateWithDeviceAsync).mockResolvedValue(true)
    const { appState, emit } = createAppState()
    const { current, view } = await renderProvider(appState)
    await act(async () => { await current()!.unlock('Unlock') })
    expect(current()?.locked).toBe(false)

    await act(async () => { emit('inactive') })
    expect(current()?.locked).toBe(true)

    await act(async () => { await current()!.setEnabled(false, 'Confirm') })
    expect(current()?.enabled).toBe(false)
    await act(async () => { emit('inactive') })
    expect(current()?.locked).toBe(false)
    await view.unmount()
  })

  describe('setEnabled', () => {
    it('requires a successful device prompt before persisting enabled', async () => {
      jest.mocked(getAppLockPreference).mockResolvedValue(false)
      jest.mocked(checkLocalAuthCapability).mockResolvedValue('available')
      jest.mocked(authenticateWithDeviceAsync).mockResolvedValue(true)
      const { appState } = createAppState()
      const { current, view } = await renderProvider(appState)

      let outcome
      await act(async () => { outcome = await current()!.setEnabled(true, 'Confirm') })
      expect(outcome).toEqual({ status: 'enabled' })
      expect(setAppLockPreference).toHaveBeenCalledWith(true)
      expect(current()?.enabled).toBe(true)
      await view.unmount()
    })

    it('reports unavailable without prompting when the device has no usable biometrics', async () => {
      jest.mocked(getAppLockPreference).mockResolvedValue(false)
      jest.mocked(checkLocalAuthCapability).mockResolvedValue('not-enrolled')
      const { appState } = createAppState()
      const { current, view } = await renderProvider(appState)

      let outcome
      await act(async () => { outcome = await current()!.setEnabled(true, 'Confirm') })
      expect(outcome).toEqual({ status: 'unavailable', capability: 'not-enrolled' })
      expect(authenticateWithDeviceAsync).not.toHaveBeenCalled()
      expect(setAppLockPreference).not.toHaveBeenCalled()
      await view.unmount()
    })

    it('reports auth-failed and never persists when the confirmation prompt is declined', async () => {
      jest.mocked(getAppLockPreference).mockResolvedValue(false)
      jest.mocked(checkLocalAuthCapability).mockResolvedValue('available')
      jest.mocked(authenticateWithDeviceAsync).mockResolvedValue(false)
      const { appState } = createAppState()
      const { current, view } = await renderProvider(appState)

      let outcome
      await act(async () => { outcome = await current()!.setEnabled(true, 'Confirm') })
      expect(outcome).toEqual({ status: 'auth-failed' })
      expect(setAppLockPreference).not.toHaveBeenCalled()
      expect(current()?.enabled).toBe(false)
      await view.unmount()
    })

    it('disables immediately without requiring a device prompt', async () => {
      jest.mocked(getAppLockPreference).mockResolvedValue(true)
      const { appState } = createAppState()
      const { current, view } = await renderProvider(appState)

      let outcome
      await act(async () => { outcome = await current()!.setEnabled(false, 'Confirm') })
      expect(outcome).toEqual({ status: 'disabled' })
      expect(authenticateWithDeviceAsync).not.toHaveBeenCalled()
      expect(current()).toMatchObject({ enabled: false, locked: false })
      await view.unmount()
    })
  })

  describe('unlock', () => {
    it('unlocks on a successful prompt', async () => {
      jest.mocked(getAppLockPreference).mockResolvedValue(true)
      jest.mocked(authenticateWithDeviceAsync).mockResolvedValue(true)
      const { appState } = createAppState()
      const { current, view } = await renderProvider(appState)

      let outcome
      await act(async () => { outcome = await current()!.unlock('Unlock WonderMoney') })
      expect(outcome).toBe(true)
      expect(authenticateWithDeviceAsync).toHaveBeenCalledWith('Unlock WonderMoney')
      expect(current()?.locked).toBe(false)
      await view.unmount()
    })

    it('stays locked on a failed prompt', async () => {
      jest.mocked(getAppLockPreference).mockResolvedValue(true)
      jest.mocked(authenticateWithDeviceAsync).mockResolvedValue(false)
      const { appState } = createAppState()
      const { current, view } = await renderProvider(appState)

      let outcome
      await act(async () => { outcome = await current()!.unlock('Unlock WonderMoney') })
      expect(outcome).toBe(false)
      expect(current()?.locked).toBe(true)
      await view.unmount()
    })
  })
})
