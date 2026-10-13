import * as SecureStore from 'expo-secure-store'
import { z } from 'zod'

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
    marketData: z.boolean(),
  }),
  minAppVersion: z.string().nullable(),
  name: z.string().min(1),
  signupMode: z.enum(['open', 'invite', 'closed']),
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

/** Asks a server to describe itself (`GET /v1/instance`) and whether this app version can use it. */
export async function checkServer(
  baseUrl: string,
  deps: { appVersion: string; fetchImpl?: typeof fetch },
): Promise<ServerCheck> {
  let response: Response
  try {
    response = await (deps.fetchImpl ?? fetch)(`${baseUrl}/v1/instance`, { headers: { Accept: 'application/json' } })
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
  const { minAppVersion } = parsed.data
  if (minAppVersion && isOlderVersion(deps.appVersion, minAppVersion)) return { minAppVersion, status: 'update-required' }
  return { instance: parsed.data, status: 'ok' }
}
