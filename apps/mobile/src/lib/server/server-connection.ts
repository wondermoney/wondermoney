import * as SecureStore from 'expo-secure-store'
import { z } from 'zod'

import { tolerantEnum } from '@/lib/api/runtime-schema'

/**
 * Which WonderMoney server the app talks to. The build has a default (EXPO_PUBLIC_API_BASE_URL);
 * someone running their own server can point the app at it from the sign-in screen. The choice
 * is kept in SecureStore and read synchronously at startup, before the API clients are built.
 */

const SERVER_URL_KEY = 'wondermoney.serverUrl'

export function readSavedServerUrl(): string | null {
  try {
    return SecureStore.getItem(SERVER_URL_KEY)
  } catch {
    return null
  }
}

export async function saveServerUrl(url: string | null): Promise<void> {
  if (url) await SecureStore.setItemAsync(SERVER_URL_KEY, url)
  else await SecureStore.deleteItemAsync(SERVER_URL_KEY)
}

/** An address as typed (`money.example.com/`) to a base URL (`https://money.example.com`), or null. */
export function normalizeServerUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (!url.hostname.includes('.') && url.hostname !== 'localhost' && !/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) return null
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '')
  } catch {
    return null
  }
}

const instanceSchema = z.object({
  apiVersion: z.number().int().positive(),
  features: z.object({
    ai: z.object({ assistant: z.boolean(), csvMapping: z.boolean(), enrichment: z.boolean(), monthlyStory: z.boolean(), ocr: z.boolean() }),
    bankSync: z.boolean(),
    contactForm: z.boolean(),
    email: z.boolean(),
    fileStorage: z.boolean(),
    // Optional so an older server that doesn't report it still parses; the app reads a
    // missing value as "not offered" (see use-instance.ts).
    googleSignIn: z.boolean().optional(),
    marketData: z.boolean(),
  }),
  minAppVersion: z.string().nullable(),
  name: z.string().min(1),
  // A mode this build doesn't know reads as 'unknown' instead of rejecting the server as
  // "not WonderMoney".
  signupMode: tolerantEnum(['open', 'invite', 'closed'], 'unknown'),
})

export type InstanceDescription = z.infer<typeof instanceSchema>

export type ServerCheck =
  | { instance: InstanceDescription; status: 'ok' }
  | { minAppVersion: string; status: 'update-required' }
  | { status: 'not-wondermoney' }
  | { status: 'unreachable' }

export function isOlderVersion(version: string, minimum: string): boolean {
  const parse = (value: string) => value.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const [a, b] = [parse(version), parse(minimum)]
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff !== 0) return diff < 0
  }
  return false
}

type InstanceFetch =
  | { instance: InstanceDescription; status: 'ok' }
  | { status: 'not-wondermoney' }
  | { status: 'unreachable' }

/** `GET /v1/instance` on `baseUrl`, parsed with the tolerant schema above. */
export async function fetchInstance(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<InstanceFetch> {
  let response: Response
  try {
    response = await fetchImpl(`${baseUrl}/v1/instance`, { headers: { Accept: 'application/json' } })
  } catch {
    return { status: 'unreachable' }
  }
  if (!response.ok) return { status: 'not-wondermoney' }
  let parsed
  try {
    parsed = instanceSchema.safeParse(await response.json())
  } catch {
    return { status: 'not-wondermoney' }
  }
  if (!parsed.success) return { status: 'not-wondermoney' }
  return { instance: parsed.data, status: 'ok' }
}

/** Asks a server to describe itself (`GET /v1/instance`) and whether this app version can use it. */
export async function checkServer(
  baseUrl: string,
  deps: { appVersion: string; fetchImpl?: typeof fetch },
): Promise<ServerCheck> {
  const fetched = await fetchInstance(baseUrl, deps.fetchImpl ?? fetch)
  if (fetched.status !== 'ok') return fetched
  const { minAppVersion } = fetched.instance
  if (minAppVersion && isOlderVersion(deps.appVersion, minAppVersion)) return { minAppVersion, status: 'update-required' }
  return fetched
}
