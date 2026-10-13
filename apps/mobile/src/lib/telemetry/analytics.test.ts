import {
  captureAnalyticsEvent,
  createAnalytics,
  disabledAnalytics,
  featureScreens,
  initAnalytics,
  isAnalyticsCaptureApproved,
  resetAnalytics,
  POSTHOG_HOST,
  type AnalyticsClientPort,
} from './analytics'

const fakeClient = () => {
  const capture = jest.fn()
  return { port: { capture } as AnalyticsClientPort, capture }
}

describe('analytics allowlist boundary', () => {
  afterEach(() => resetAnalytics())

  it('accepts every allowlisted event with exactly its approved properties', () => {
    const { port, capture } = fakeClient()
    const analytics = createAnalytics({ environment: 'local', client: port })

    analytics.capture('sign_up_completed', { provider: 'email' })
    analytics.capture('sign_in_completed', { provider: 'apple' })
    analytics.capture('onboarding_completed')
    analytics.capture('first_account_created', { method: 'bank_connection' })
    analytics.capture('bank_connection_started')
    analytics.capture('bank_connection_completed')
    analytics.capture('bank_connection_failed')
    analytics.capture('feedback_submitted', { category: 'bug' })
    analytics.capture('feature_screen_viewed', { screen: 'portfolio_detail' })

    expect(capture.mock.calls).toEqual([
      ['sign_up_completed', { provider: 'email' }],
      ['sign_in_completed', { provider: 'apple' }],
      ['onboarding_completed', undefined],
      ['first_account_created', { method: 'bank_connection' }],
      ['bank_connection_started', undefined],
      ['bank_connection_completed', undefined],
      ['bank_connection_failed', undefined],
      ['feedback_submitted', { category: 'bug' }],
      ['feature_screen_viewed', { screen: 'portfolio_detail' }],
    ])
  })

  it('refuses anything outside the ADR allowlist at compile time', () => {
    const { port } = fakeClient()
    const analytics = createAnalytics({ environment: 'local', client: port })

    // @ts-expect-error event names are a closed set; adding one means editing the ADR first
    analytics.capture('account_transaction_add', { amount: 1000 })
    // @ts-expect-error web captures this with an email; mobile has no such event
    analytics.capture('user_identified', { email: 'a@b.co' })
    // @ts-expect-error the provider enum is closed
    analytics.capture('sign_in_completed', { provider: 'facebook' })
    // @ts-expect-error no extra property may ride along on an approved event
    analytics.capture('sign_in_completed', { provider: 'email', userId: 'user_1' })
    // @ts-expect-error an approved property may not be swapped for another
    analytics.capture('first_account_created', { accountId: 42 })
    // @ts-expect-error events approved with no properties take none
    analytics.capture('onboarding_completed', { userId: 'user_1' })
    // @ts-expect-error bank connection steps deliberately carry no institution
    analytics.capture('bank_connection_completed', { institution: 'Revolut' })
    // @ts-expect-error screens are identifiers, never raw paths with IDs in them
    analytics.capture('feature_screen_viewed', { screen: '/portfolio/abc123' })
    // @ts-expect-error the feedback message never leaves the mail channel
    analytics.capture('feedback_submitted', { category: 'bug', message: 'it broke' })
  })

  it('exposes no identity, group or free-form capture surface', () => {
    const { port } = fakeClient()
    const analytics = createAnalytics({ environment: 'staging', client: port })

    expect(Object.keys(analytics)).toEqual(['capture'])
    expect(analytics).not.toHaveProperty('identify')
    expect(analytics).not.toHaveProperty('alias')
    expect(analytics).not.toHaveProperty('group')
    expect(analytics).not.toHaveProperty('register')
    expect(analytics).not.toHaveProperty('reset')
    expect(Object.isFrozen(analytics)).toBe(true)
  })

  it('pins the single approved ingest host', () => {
    expect(POSTHOG_HOST).toBe('https://eu.posthog.com')
  })
})

describe('isAnalyticsCaptureApproved', () => {
  it('approves local, staging, and production', () => {
    expect(isAnalyticsCaptureApproved('local')).toBe(true)
    expect(isAnalyticsCaptureApproved('staging')).toBe(true)
    expect(isAnalyticsCaptureApproved('production')).toBe(true)
  })

  it.each(['prod', 'preview', 'test', '', 'LOCAL', 'staging '])('refuses %p', (environment) => {
    expect(isAnalyticsCaptureApproved(environment)).toBe(false)
  })
})

describe('createAnalytics', () => {
  it('reaches the client in production, an approved environment', () => {
    const { port, capture } = fakeClient()

    const analytics = createAnalytics({ environment: 'production', client: port })
    analytics.capture('sign_in_completed', { provider: 'email' })

    expect(capture).toHaveBeenCalledWith('sign_in_completed', { provider: 'email' })
  })

  it('never reaches the client outside an approved environment', () => {
    const { port, capture } = fakeClient()

    const analytics = createAnalytics({ environment: 'preview', client: port })
    analytics.capture('sign_in_completed', { provider: 'email' })
    analytics.capture('onboarding_completed')

    expect(capture).not.toHaveBeenCalled()
    expect(analytics).toBe(disabledAnalytics)
  })

  it('is inert without a client', () => {
    const analytics = createAnalytics({ environment: 'local', client: null })
    expect(analytics.capture('bank_connection_started')).toBeUndefined()
  })
})

describe('initAnalytics', () => {
  afterEach(() => resetAnalytics())

  it('captures nothing until it is installed', () => {
    const { port, capture } = fakeClient()
    captureAnalyticsEvent('onboarding_completed')
    expect(capture).not.toHaveBeenCalled()

    initAnalytics({ config: { environment: 'local', apiKey: 'phc_test' }, createClient: () => port })
    captureAnalyticsEvent('onboarding_completed')

    expect(capture).toHaveBeenCalledWith('onboarding_completed', undefined)
  })

  it('passes the validated key straight to the client factory', () => {
    const { port } = fakeClient()
    const createClient = jest.fn(() => port)

    initAnalytics({ config: { environment: 'staging', apiKey: 'phc_key' }, createClient })

    expect(createClient).toHaveBeenCalledWith({ apiKey: 'phc_key' })
  })

  it('never constructs a client for an unapproved environment', () => {
    const createClient = jest.fn(() => fakeClient().port)

    const analytics = initAnalytics({
      config: { environment: 'preview', apiKey: 'phc_key' },
      createClient,
    })

    expect(createClient).not.toHaveBeenCalled()
    expect(analytics).toBe(disabledAnalytics)
  })

  it('never constructs a client when the environment could not be validated', () => {
    const createClient = jest.fn(() => fakeClient().port)

    const analytics = initAnalytics({ config: undefined, createClient })

    expect(createClient).not.toHaveBeenCalled()
    expect(analytics).toBe(disabledAnalytics)
  })
})

describe('featureScreens', () => {
  it('is a closed set of identifiers, never paths', () => {
    for (const screen of featureScreens) {
      expect(screen).toMatch(/^[a-z][a-z0-9_]*$/)
    }
    expect(new Set(featureScreens).size).toBe(featureScreens.length)
  })
})
