import { useCallback } from 'react'
import { z } from 'zod'

import { useOptionalProductRuntime } from '@/components/providers/product-runtime-provider'
import type { SupportedLocale } from '@/components/providers/session-preferences-provider'
import { writeEndpoint } from '@/lib/api/runtime-schema'

/** The account language the API stores: emails and other server-written texts go out in it. */
export type AccountLanguage = 'EN' | 'ES' | 'PT'

const ACCOUNT_LANGUAGE: Readonly<Record<SupportedLocale, AccountLanguage>> = { en: 'EN', es: 'ES', 'pt-PT': 'PT' }

/** The account language for an app locale (`es` → `ES`, `pt-PT` → `PT`). */
export const toAccountLanguage = (locale: SupportedLocale): AccountLanguage => ACCOUNT_LANGUAGE[locale]

/**
 * `PATCH /v1/user/:userId` with the account language. The API resolves the account from the
 * session; the path names the current principal only because the route has a segment.
 */
export function accountLanguageEndpoint(userId: string) {
  return writeEndpoint({
    method: 'PATCH',
    path: `/v1/user/${encodeURIComponent(userId)}`,
    schema: z.undefined(),
    successStatuses: [200],
  })
}

/**
 * Sends the app language the person picked to their account, so their emails follow it. Nothing
 * without a signed-in runtime; a failed send is dropped, and picking the language again retries.
 */
export function useAccountLanguageSync(): (locale: SupportedLocale) => void {
  const runtime = useOptionalProductRuntime()?.runtime
  return useCallback((locale: SupportedLocale) => {
    if (!runtime) return
    runtime.apiClient
      .write(accountLanguageEndpoint(runtime.principalId), { body: { language: toAccountLanguage(locale) }, commit: () => undefined })
      .catch(() => undefined)
  }, [runtime])
}
