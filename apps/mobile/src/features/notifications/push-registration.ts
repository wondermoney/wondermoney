import type { ApiClient } from '@/lib/api/client'
import type { PushDevicePort, PushTokenStore } from '@/lib/push/push-device'

import {
  pushPreferencesEndpoint,
  registerPushDeviceEndpoint,
  updatePushPreferencesEndpoint,
  type PushCategory,
  type PushPreferencesDto,
} from './push-contract'

type Api = Pick<ApiClient, 'read' | 'write'>

export type PushDeps = Readonly<{
  api: Api
  device: PushDevicePort
  store: PushTokenStore
}>

export type EnablePushOutcome =
  | { status: 'enabled'; preferences: PushPreferencesDto }
  /** The person said no (now or earlier); the category stays off. */
  | { status: 'denied' }
  /** No push token on this phone (a build without a push project, offline, a simulator). */
  | { status: 'unavailable' }

const noop = () => undefined

async function registerToken(deps: PushDeps): Promise<boolean> {
  const { device } = deps
  if (!device.platform) return false
  const token = await device.getToken()
  if (!token) return false
  await deps.api.write(registerPushDeviceEndpoint, {
    body: { token, platform: device.platform, ...(device.appVersion ? { appVersion: device.appVersion } : {}) },
    commit: noop,
  })
  await deps.store.save(token)
  return true
}

/**
 * Turning a push category on is the one moment the app asks for notification permission: never
 * at first launch, never for anything else. Permission first, then the phone's token, then the
 * switch, so a "no" leaves the category off.
 */
export async function enablePushCategory(deps: PushDeps, category: PushCategory): Promise<EnablePushOutcome> {
  let permission = await deps.device.getPermission()
  if (permission === 'undetermined') permission = await deps.device.requestPermission()
  if (permission !== 'granted') return { status: 'denied' }
  if (!(await registerToken(deps))) return { status: 'unavailable' }
  const preferences = await deps.api.write(updatePushPreferencesEndpoint, { body: { [category]: true }, commit: noop })
  return { status: 'enabled', preferences }
}

/** Turning a category off asks the phone for nothing. */
export function disablePushCategory(deps: Pick<PushDeps, 'api'>, category: PushCategory): Promise<PushPreferencesDto> {
  return deps.api.write(updatePushPreferencesEndpoint, { body: { [category]: false }, commit: noop })
}

/**
 * On sign-in, re-register this phone when the person already opted in and already allowed
 * notifications, so a rotated token or a new session keeps receiving. Never prompts.
 */
export async function refreshPushRegistration(deps: PushDeps): Promise<'registered' | 'skipped'> {
  if ((await deps.device.getPermission()) !== 'granted') return 'skipped'
  const preferences = await deps.api.read(pushPreferencesEndpoint)
  if (!Object.values(preferences).some(Boolean)) return 'skipped'
  return (await registerToken(deps)) ? 'registered' : 'skipped'
}
