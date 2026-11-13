import type { PushDevicePort, PushPermission } from '@/lib/push/push-device'
import { unregisterPushDevice } from '@/lib/push/push-sign-out'
import type { PushTokenStore } from '@/lib/push/push-token-store'

import type { PushPreferencesDto } from './push-contract'
import { disablePushCategory, enablePushCategory, refreshPushRegistration } from './push-registration'

const TOKEN = 'ExponentPushToken[phone-0001]'
const OFF: PushPreferencesDto = { bankSyncAlerts: false, budgetAlerts: false, creditCardDueReminders: false }

function fakes(permission: PushPermission, answer: PushPermission = 'granted', stored: PushPreferencesDto = OFF) {
  const device = {
    appVersion: '1.0.2',
    getPermission: jest.fn(() => Promise.resolve(permission)),
    getToken: jest.fn(() => Promise.resolve<string | null>(TOKEN)),
    platform: 'ios' as const,
    requestPermission: jest.fn(() => Promise.resolve(answer)),
  } satisfies PushDevicePort
  const writes: { body?: unknown; method: string; path: string }[] = []
  const api = {
    read: jest.fn(() => Promise.resolve(stored)),
    write: jest.fn((endpoint: { method: string; path: string }, options: { body?: unknown }) => {
      writes.push({ body: options.body, method: endpoint.method, path: endpoint.path })
      return Promise.resolve(endpoint.path.endsWith('push-preferences') ? { ...OFF, ...(options.body as object) } : undefined)
    }),
  }
  let saved: string | null = null
  const store: PushTokenStore = {
    clear: jest.fn(() => { saved = null; return Promise.resolve() }),
    load: jest.fn(() => Promise.resolve(saved)),
    save: jest.fn((token: string) => { saved = token; return Promise.resolve() }),
  }
  return { api: api as never, device, store, writes }
}

/*
 * Notification permission is asked for at one moment only: when the person turns a push category
 * on. Nothing at launch, at sign-in or when a category is turned off may show the prompt.
 */
describe('push permission and registration', () => {
  it('asks for permission when a category is turned on, then registers the phone and the switch', async () => {
    const deps = fakes('undetermined')

    const outcome = await enablePushCategory(deps, 'budgetAlerts')

    expect(deps.device.requestPermission).toHaveBeenCalledTimes(1)
    expect(outcome).toEqual({ preferences: { ...OFF, budgetAlerts: true }, status: 'enabled' })
    expect(deps.writes).toEqual([
      { body: { appVersion: '1.0.2', platform: 'ios', token: TOKEN }, method: 'POST', path: '/v1/user/me/push-devices' },
      { body: { budgetAlerts: true }, method: 'PATCH', path: '/v1/user/me/push-preferences' },
    ])
    await expect(deps.store.load()).resolves.toBe(TOKEN)
  })

  it('leaves the category off and the server untouched when the person says no', async () => {
    const deps = fakes('undetermined', 'denied')

    await expect(enablePushCategory(deps, 'budgetAlerts')).resolves.toEqual({ status: 'denied' })
    expect(deps.writes).toEqual([])
  })

  it('does not prompt again once permission was refused', async () => {
    const deps = fakes('denied')

    await expect(enablePushCategory(deps, 'creditCardDueReminders')).resolves.toEqual({ status: 'denied' })
    expect(deps.device.requestPermission).not.toHaveBeenCalled()
  })

  it('does not prompt when permission was already given', async () => {
    const deps = fakes('granted')

    await enablePushCategory(deps, 'bankSyncAlerts')

    expect(deps.device.requestPermission).not.toHaveBeenCalled()
  })

  it('reports a phone without a push token instead of saving a switch that cannot deliver', async () => {
    const deps = fakes('granted')
    deps.device.getToken.mockResolvedValue(null)

    await expect(enablePushCategory(deps, 'budgetAlerts')).resolves.toEqual({ status: 'unavailable' })
    expect(deps.writes).toEqual([])
  })

  it('turns a category off without asking the phone anything', async () => {
    const deps = fakes('undetermined')

    await disablePushCategory(deps, 'budgetAlerts')

    expect(deps.device.getPermission).not.toHaveBeenCalled()
    expect(deps.device.requestPermission).not.toHaveBeenCalled()
    expect(deps.writes).toEqual([{ body: { budgetAlerts: false }, method: 'PATCH', path: '/v1/user/me/push-preferences' }])
  })

  it('never prompts at sign-in, and re-registers only an opted-in phone that already allowed it', async () => {
    const undecided = fakes('undetermined', 'granted', { ...OFF, budgetAlerts: true })
    await expect(refreshPushRegistration(undecided)).resolves.toBe('skipped')
    expect(undecided.device.requestPermission).not.toHaveBeenCalled()
    expect(undecided.writes).toEqual([])

    const optedOut = fakes('granted')
    await expect(refreshPushRegistration(optedOut)).resolves.toBe('skipped')
    expect(optedOut.writes).toEqual([])

    const optedIn = fakes('granted', 'granted', { ...OFF, budgetAlerts: true })
    await expect(refreshPushRegistration(optedIn)).resolves.toBe('registered')
    expect(optedIn.device.requestPermission).not.toHaveBeenCalled()
    expect(optedIn.writes.map((write) => write.path)).toEqual(['/v1/user/me/push-devices'])
  })
})

describe('signing out', () => {
  it('removes the registered token from the account and forgets it', async () => {
    const deps = fakes('granted')
    await deps.store.save(TOKEN)

    await unregisterPushDevice(deps)

    expect(deps.writes).toEqual([{ body: undefined, method: 'DELETE', path: `/v1/user/me/push-devices/${encodeURIComponent(TOKEN)}` }])
    await expect(deps.store.load()).resolves.toBeNull()
  })

  it('does nothing on a phone that never registered', async () => {
    const deps = fakes('granted')

    await unregisterPushDevice(deps)

    expect(deps.writes).toEqual([])
  })

  it('still signs out when the server cannot be reached, or does not answer in time', async () => {
    const offline = fakes('granted')
    await offline.store.save(TOKEN)
    ;(offline.api as unknown as { write: jest.Mock }).write.mockRejectedValue(new Error('offline'))
    await expect(unregisterPushDevice(offline)).resolves.toBeUndefined()
    await expect(offline.store.load()).resolves.toBeNull()

    const slow = fakes('granted')
    await slow.store.save(TOKEN)
    ;(slow.api as unknown as { write: jest.Mock }).write.mockReturnValue(new Promise(() => undefined))
    await expect(unregisterPushDevice(slow, 10)).resolves.toBeUndefined()
    await expect(slow.store.load()).resolves.toBeNull()
  })
})
