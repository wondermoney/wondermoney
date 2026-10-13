import {
  captureError,
  createErrorReporting,
  disabledErrorReporting,
  initErrorReporting,
  resetErrorReporting,
  SENTRY_DSN,
  type ErrorReporterPort,
} from './error-reporting'

const fakeClient = () => {
  const captureException = jest.fn()
  return { port: { captureException } as ErrorReporterPort, captureException }
}

describe('error reporting boundary', () => {
  afterEach(() => resetErrorReporting())

  it('forwards the error and nothing else', () => {
    const { port, captureException } = fakeClient()
    const reporting = createErrorReporting({ environment: 'local', client: port })
    const error = new Error('The server response was invalid.')

    reporting.captureError(error)

    expect(captureException).toHaveBeenCalledTimes(1)
    expect(captureException).toHaveBeenCalledWith(error)
    // The ADR's rule 4 in its observable form: whatever a call site did, the
    // vendor never receives a tags/contexts/extra argument.
    expect(captureException.mock.calls[0]).toHaveLength(1)
  })

  it('refuses a context argument at compile time', () => {
    const { port } = fakeClient()
    const reporting = createErrorReporting({ environment: 'local', client: port })

    // @ts-expect-error the ADR closes off exactly this: no extra at the call site
    reporting.captureError(new Error('boom'), { extra: { accountId: 'account_1' } })
    // @ts-expect-error nor tags
    captureError(new Error('boom'), { tags: { screen: 'portfolio_detail' } })
    // @ts-expect-error nor a scope callback
    captureError(new Error('boom'), (scope: unknown) => scope)
  })

  it('exposes no identity, scope or breadcrumb surface', () => {
    const { port } = fakeClient()
    const reporting = createErrorReporting({ environment: 'staging', client: port })

    expect(Object.keys(reporting)).toEqual(['captureError'])
    expect(reporting).not.toHaveProperty('setUser')
    expect(reporting).not.toHaveProperty('setTag')
    expect(reporting).not.toHaveProperty('setContext')
    expect(reporting).not.toHaveProperty('setExtra')
    expect(reporting).not.toHaveProperty('addBreadcrumb')
    expect(reporting).not.toHaveProperty('withScope')
    expect(Object.isFrozen(reporting)).toBe(true)
  })

  it('pins the single approved DSN', () => {
    expect(SENTRY_DSN).toBe('https://397525327286be42f3f2f5d7cc89ac28@o438497.ingest.us.sentry.io/4511944590622720')
  })
})

describe('createErrorReporting environment gate', () => {
  it('never reaches the client outside an approved environment', () => {
    const { port, captureException } = fakeClient()

    const reporting = createErrorReporting({ environment: 'preview', client: port })
    reporting.captureError(new Error('boom'))

    expect(captureException).not.toHaveBeenCalled()
    expect(reporting).toBe(disabledErrorReporting)
  })

  it('is inert without a client', () => {
    const reporting = createErrorReporting({ environment: 'local', client: null })
    expect(reporting.captureError(new Error('boom'))).toBeUndefined()
  })

  it.each(['local', 'staging', 'production'])('captures in %p', (environment) => {
    const { port, captureException } = fakeClient()
    createErrorReporting({ environment, client: port }).captureError(new Error('boom'))
    expect(captureException).toHaveBeenCalledTimes(1)
  })

  it.each(['prod', 'preview', 'test', '', 'LOCAL', 'staging '])(
    'refuses %p, exactly as the PostHog boundary does — one shared allowlist, not two',
    (environment) => {
      const { port, captureException } = fakeClient()
      createErrorReporting({ environment, client: port }).captureError(new Error('boom'))
      expect(captureException).not.toHaveBeenCalled()
    },
  )
})

describe('initErrorReporting', () => {
  afterEach(() => resetErrorReporting())

  it('captures nothing until it is installed', () => {
    const { port, captureException } = fakeClient()
    captureError(new Error('before init'))
    expect(captureException).not.toHaveBeenCalled()

    initErrorReporting({ config: { environment: 'local' }, createClient: () => port })
    captureError(new Error('after init'))

    expect(captureException).toHaveBeenCalledTimes(1)
  })

  it('passes the validated environment straight to the client factory', () => {
    const { port } = fakeClient()
    const createClient = jest.fn(() => port)

    initErrorReporting({ config: { environment: 'staging' }, createClient })

    expect(createClient).toHaveBeenCalledWith({ environment: 'staging' })
  })

  it('never initializes the SDK for an unapproved environment', () => {
    const createClient = jest.fn(() => fakeClient().port)

    const reporting = initErrorReporting({ config: { environment: 'preview' }, createClient })

    expect(createClient).not.toHaveBeenCalled()
    expect(reporting).toBe(disabledErrorReporting)
  })

  it('never initializes the SDK when the environment could not be validated', () => {
    const createClient = jest.fn(() => fakeClient().port)

    const reporting = initErrorReporting({ config: undefined, createClient })

    expect(createClient).not.toHaveBeenCalled()
    expect(reporting).toBe(disabledErrorReporting)
  })

  it('goes inert again on reset', () => {
    const { port, captureException } = fakeClient()
    initErrorReporting({ config: { environment: 'local' }, createClient: () => port })

    resetErrorReporting()
    captureError(new Error('boom'))

    expect(captureException).not.toHaveBeenCalled()
  })
})
