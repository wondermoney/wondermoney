import type { Event } from '@sentry/react-native'

const mockInit = jest.fn()
const mockCaptureException = jest.fn()

jest.mock('@sentry/react-native', () => ({
  __esModule: true,
  init: (options: Record<string, unknown>) => mockInit(options),
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}))

// Required after Jest has installed the mock, so the module under test never
// reaches the real SDK — no native module lookups, no global handler patching.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createSentryErrorClient, scrubSentryEvent } = require('./sentry-error-client') as typeof import('./sentry-error-client')

const initOptions = (): Record<string, unknown> => {
  createSentryErrorClient({ environment: 'staging' })
  return mockInit.mock.calls[0]?.[0] as Record<string, unknown>
}

describe('createSentryErrorClient', () => {
  beforeEach(() => {
    mockInit.mockReset()
    mockCaptureException.mockReset()
  })

  it('initializes against the reused DSN with the environment it was handed', () => {
    const options = initOptions()

    expect(options.dsn).toBe('https://397525327286be42f3f2f5d7cc89ac28@o438497.ingest.us.sentry.io/4511944590622720')
    expect(options.environment).toBe('staging')
    expect(options.beforeSend).toBe(scrubSentryEvent)
  })

  it('never enables Session Replay at any rate', () => {
    const options = initOptions()

    // The SDK only installs mobileReplayIntegration when one of these is a
    // number, so their absence — not a zero — is what keeps replay off.
    expect(options).not.toHaveProperty('replaysSessionSampleRate')
    expect(options).not.toHaveProperty('replaysOnErrorSampleRate')
    expect(options).not.toHaveProperty('integrations')
    expect(options).not.toHaveProperty('_experiments')
  })

  it('turns off every option that would send more than a stack trace', () => {
    const options = initOptions()

    expect(options.sendDefaultPii).toBe(false)
    expect(options.enableLogs).toBe(false)
    expect(options.attachScreenshot).toBe(false)
    expect(options.attachViewHierarchy).toBe(false)
    expect(options.enableCaptureFailedRequests).toBe(false)
    expect(options.debug).toBe(false)
  })

  it('keeps performance tracing off, including the integrations a zero sample rate still installs', () => {
    const options = initOptions()

    expect(options.tracesSampleRate).toBe(0)
    expect(options.enableAutoPerformanceTracing).toBe(false)
    expect(options.enableUserInteractionTracing).toBe(false)
    expect(options.enableStallTracking).toBe(false)
    expect(options.enableAppStartTracking).toBe(false)
    expect(options.enableNativeFramesTracking).toBe(false)
  })

  it('forwards the error alone, with no context argument', () => {
    const client = createSentryErrorClient({ environment: 'local' })
    const error = new Error('The server response was invalid.')

    client.captureException(error)

    expect(mockCaptureException).toHaveBeenCalledWith(error)
    expect(mockCaptureException.mock.calls[0]).toHaveLength(1)
  })

  it('exposes captureException alone, so no setUser or scope can be reached through it', () => {
    const client = createSentryErrorClient({ environment: 'local' })

    expect(Object.keys(client)).toEqual(['captureException'])
    expect(client).not.toHaveProperty('setUser')
    expect(client).not.toHaveProperty('withScope')
    expect(Object.isFrozen(client)).toBe(true)
  })
})

/**
 * The regression test the ADR is really asking for. A scrubbing bug is invisible
 * in manual testing — the app behaves identically and the leak only shows up in
 * the Sentry dashboard — so every claim `beforeSend` makes is asserted against a
 * synthetic event carrying values that must never leave the device.
 */
describe('scrubSentryEvent', () => {
  const bearerToken = 'Bearer eyJhbGciOiJIUzI1NiJ9.super-secret-access-token'
  const requestBody = '{"amount":1234.56,"description":"Rent for the flat"}'
  const responseBody = '{"email":"someone@example.com","balance":98765.43}'

  const dirtyEvent = (): Event => ({
    event_id: 'event_1',
    user: { id: 'supabase-user-1', email: 'someone@example.com', ip_address: '10.0.0.1' },
    extra: { componentStack: 'at AccountRow (balance=98765.43)', accountId: 'account_1' },
    contexts: {
      react: { componentStack: '\n    in AccountRow (balance="98765.43")' },
      device: { model: 'iPhone17,1' },
      os: { name: 'iOS', version: '26.0' },
    },
    request: {
      url: 'https://staging.api.wonder.money/v1/accounts?access_token=super-secret-access-token',
      method: 'POST',
      data: requestBody,
      cookies: { sb_session: 'super-secret-access-token' },
      headers: { Authorization: bearerToken, Cookie: 'sb_session=super-secret-access-token' },
      query_string: 'access_token=super-secret-access-token',
    },
    breadcrumbs: [
      {
        category: 'console',
        level: 'log',
        message: `submitting ${requestBody}`,
        data: { arguments: [requestBody] },
      },
      {
        category: 'xhr',
        type: 'http',
        level: 'info',
        data: {
          url: 'https://staging.api.wonder.money/v1/transactions?access_token=super-secret-access-token',
          method: 'POST',
          status_code: 200,
          request_body: requestBody,
          response_body: responseBody,
          headers: { Authorization: bearerToken },
        },
      },
      { category: 'app.lifecycle', type: 'navigation', level: 'info', message: 'foreground' },
    ],
  })

  const serialized = () => JSON.stringify(scrubSentryEvent(dirtyEvent()))

  it('drops every identity field, so no user reaches Sentry even if something sets one', () => {
    const scrubbed = scrubSentryEvent(dirtyEvent())

    expect(scrubbed).not.toHaveProperty('user')
    expect(serialized()).not.toContain('supabase-user-1')
    expect(serialized()).not.toContain('someone@example.com')
    expect(serialized()).not.toContain('10.0.0.1')
  })

  it('drops extra and the React error-boundary component stack, keeping device/os context', () => {
    const scrubbed = scrubSentryEvent(dirtyEvent())

    expect(scrubbed).not.toHaveProperty('extra')
    expect(scrubbed.contexts).not.toHaveProperty('react')
    expect(scrubbed.contexts).toEqual({ device: { model: 'iPhone17,1' }, os: { name: 'iOS', version: '26.0' } })
    expect(serialized()).not.toContain('AccountRow')
    expect(serialized()).not.toContain('account_1')
  })

  it('strips the request body, cookies, headers and query string, keeping method and path', () => {
    const scrubbed = scrubSentryEvent(dirtyEvent())

    expect(scrubbed.request).toEqual({
      url: 'https://staging.api.wonder.money/v1/accounts',
      method: 'POST',
    })
    expect(serialized()).not.toContain('Authorization')
    expect(serialized()).not.toContain('super-secret-access-token')
    expect(serialized()).not.toContain('Rent for the flat')
    expect(serialized()).not.toContain('1234.56')
  })

  it('drops console breadcrumbs entirely', () => {
    const scrubbed = scrubSentryEvent(dirtyEvent())

    expect(scrubbed.breadcrumbs?.some((breadcrumb) => breadcrumb.category === 'console')).toBe(false)
    expect(serialized()).not.toContain('submitting')
  })

  it('reduces an HTTP breadcrumb to method, status and a query-less URL', () => {
    const scrubbed = scrubSentryEvent(dirtyEvent())
    const http = scrubbed.breadcrumbs?.find((breadcrumb) => breadcrumb.category === 'xhr')

    expect(http).toEqual({
      category: 'xhr',
      type: 'http',
      level: 'info',
      data: {
        url: 'https://staging.api.wonder.money/v1/transactions',
        method: 'POST',
        status_code: 200,
      },
    })
    expect(serialized()).not.toContain('98765.43')
    expect(serialized()).not.toContain('response_body')
  })

  it('passes non-HTTP, non-console breadcrumbs through untouched', () => {
    const scrubbed = scrubSentryEvent(dirtyEvent())

    expect(scrubbed.breadcrumbs?.at(-1)).toEqual({
      category: 'app.lifecycle',
      type: 'navigation',
      level: 'info',
      message: 'foreground',
    })
  })

  it('keeps the exception and event identity a report is useless without', () => {
    const scrubbed = scrubSentryEvent({
      event_id: 'event_1',
      exception: { values: [{ type: 'ApiError', value: 'The server response was invalid.' }] },
    })

    expect(scrubbed.event_id).toBe('event_1')
    expect(scrubbed.exception?.values?.[0]).toEqual({
      type: 'ApiError',
      value: 'The server response was invalid.',
    })
  })

  it('does not mutate the event it was given', () => {
    const original = dirtyEvent()
    scrubSentryEvent(original)

    expect(original.user).toEqual({ id: 'supabase-user-1', email: 'someone@example.com', ip_address: '10.0.0.1' })
    expect(original.breadcrumbs).toHaveLength(3)
  })

  it('survives an event with nothing to scrub', () => {
    expect(scrubSentryEvent({})).toEqual({})
  })
})
