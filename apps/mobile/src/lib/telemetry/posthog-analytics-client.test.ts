const mockCapture = jest.fn()
const mockConstructor = jest.fn()

jest.mock('posthog-react-native', () => ({
  __esModule: true,
  default: class {
    capture = mockCapture
    constructor(apiKey: string, options: Record<string, unknown>) {
      mockConstructor(apiKey, options)
    }
  },
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createPostHogAnalyticsClient } = require('./posthog-analytics-client') as typeof import('./posthog-analytics-client')

describe('createPostHogAnalyticsClient', () => {
  beforeEach(() => {
    mockCapture.mockReset()
    mockConstructor.mockReset()
  })

  it('sends to the approved EU host with every unapproved capture surface switched off', () => {
    createPostHogAnalyticsClient({ apiKey: 'phc_key' })

    expect(mockConstructor).toHaveBeenCalledWith('phc_key', {
      host: 'https://eu.posthog.com',
      captureAppLifecycleEvents: false,
      enableSessionReplay: false,
      disableSurveys: true,
      disableRemoteConfig: true,
      disableRemoteFeatureFlags: true,
      preloadFeatureFlags: false,
      sendFeatureFlagEvent: false,
      personProfiles: 'never',
    })
  })

  it('forwards an allowlisted capture unchanged', () => {
    const client = createPostHogAnalyticsClient({ apiKey: 'phc_key' })

    client.capture('feedback_submitted', { category: 'bug' })

    expect(mockCapture).toHaveBeenCalledWith('feedback_submitted', { category: 'bug' })
  })

  it('exposes capture alone, so no identify or reset can be reached through it', () => {
    const client = createPostHogAnalyticsClient({ apiKey: 'phc_key' })

    expect(Object.keys(client)).toEqual(['capture'])
    expect(client).not.toHaveProperty('identify')
    expect(Object.isFrozen(client)).toBe(true)
  })
})
