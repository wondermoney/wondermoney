import { useEffect, useState } from 'react'

import { useOptionalProductRuntime } from '@/components/providers/product-runtime-provider'
import { useServerSwitch } from '@/components/providers/server-switch-provider'

/** What an `expo-image` `source` takes for a remote image. */
export type RemoteImageSource = Readonly<{ uri: string; headers?: Readonly<Record<string, string>> }>

const originOf = (value: string): string | null => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null
  } catch {
    return null
  }
}

/**
 * Whether `url` is served by the API this app talks to (same scheme, host and port), and so may
 * carry the session's bearer token. Anything else, and anything unparseable, is third-party.
 */
export function isApiOriginUrl(url: string, apiBaseUrl: string | null | undefined): boolean {
  if (!apiBaseUrl) return false
  const origin = originOf(url)
  return origin !== null && origin === originOf(apiBaseUrl)
}

/**
 * The image source for `uri`. A third-party URL loads as a plain request, with no credentials.
 * A URL on the API's own origin (the merchant logo proxy) loads with the session's bearer token,
 * and is `null` until the token is read, or when there is no session, so nothing is requested
 * that can only fail. Null for no `uri`.
 */
export function useRemoteImageSource(uri: string | null): RemoteImageSource | null {
  const apiBaseUrl = useServerSwitch()?.apiBaseUrl ?? null
  const authorize = useOptionalProductRuntime()?.runtime?.imageAuthorization ?? null
  const needsAuthorization = uri !== null && isApiOriginUrl(uri, apiBaseUrl)
  const [resolved, setResolved] = useState<Readonly<{ uri: string; authorization: string | null }> | null>(null)

  useEffect(() => {
    if (!uri || !needsAuthorization || !authorize) return
    let live = true
    void authorize().then(
      (authorization) => { if (live) setResolved({ uri, authorization }) },
      () => { if (live) setResolved({ uri, authorization: null }) },
    )
    return () => { live = false }
  }, [authorize, needsAuthorization, uri])

  if (!uri) return null
  if (!needsAuthorization) return { uri }
  if (!authorize || resolved?.uri !== uri || !resolved.authorization) return null
  return { uri, headers: { Authorization: resolved.authorization } }
}
