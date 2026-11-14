import type { Href } from 'expo-router'

/**
 * Where a tapped notification goes. The server names an in-app path (`data.url`); only the
 * screens a notification can be about are accepted, so a notification can never send the app
 * somewhere else.
 */
const ROUTES: readonly RegExp[] = [
  /^\/budgets$/u,
  /^\/budgets\/\d{1,10}\/\d{4}\/(?:[1-9]|1[0-2])$/u,
  /^\/accounts\/\d{1,10}$/u,
  /^\/more\/banking$/u,
  /^\/settings\/notifications$/u,
]

export function notificationHref(data: unknown): Href | null {
  if (!data || typeof data !== 'object') return null
  const url = (data as { url?: unknown }).url
  if (typeof url !== 'string') return null
  return ROUTES.some((route) => route.test(url)) ? (url as Href) : null
}
