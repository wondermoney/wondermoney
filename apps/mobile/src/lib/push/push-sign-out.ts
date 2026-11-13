import { z } from 'zod'

import type { ApiClient } from '@/lib/api/client'
import { writeEndpoint } from '@/lib/api/runtime-schema'

import type { PushTokenStore } from './push-token-store'

export const unregisterPushDeviceEndpoint = (token: string) => writeEndpoint({
  method: 'DELETE',
  path: `/v1/user/me/push-devices/${encodeURIComponent(token)}`,
  schema: z.undefined(),
  successStatuses: [204],
})

/**
 * Signing out removes this phone from the account first, while the session can still say so. Best
 * effort and bounded: the server also drops the device when the session ends.
 */
export async function unregisterPushDevice(deps: Readonly<{ api: Pick<ApiClient, 'write'>; store: PushTokenStore }>, timeoutMs = 3000): Promise<void> {
  const token = await deps.store.load()
  if (!token) return
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      deps.api.write(unregisterPushDeviceEndpoint(token), { commit: () => undefined }),
      new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs) }),
    ])
  } catch {
    // Offline or already signed out: the server removes it with the session.
  } finally {
    if (timer) clearTimeout(timer)
    await deps.store.clear()
  }
}
