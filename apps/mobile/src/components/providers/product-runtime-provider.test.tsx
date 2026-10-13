import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, render, waitFor } from '@testing-library/react-native'
import { useEffect, useLayoutEffect, useState } from 'react'
import { Text } from 'react-native'
import { z } from 'zod'

import { readEndpoint } from '@/lib/api/runtime-schema'
import { setPendingInviteToken, takePendingInviteToken } from '@/lib/auth/invite-token-store'
import { provisionAppUser } from '@/lib/auth/provision-app-user'
import { createSessionOperationScope } from '@/lib/auth/session-operation-scope'

import { AppSessionProvider } from './app-session-context'
import { AuthenticatedRouteBoundary } from './authenticated-route-boundary'
import {
  ProductRuntimeProvider,
  useProductRuntime,
  type ProductRuntime,
  type ProductRuntimeContextValue,
} from './product-runtime-provider'

jest.mock('@/lib/auth/provision-app-user', () => ({
  provisionAppUser: jest.fn(),
  authCallbackEndpoint: { method: 'POST', path: '/v1/auth/callback' },
}))

const session = (id: string, token = `token-${id}`) => ({
  user: { id },
  accessToken: token,
}) as never

const deferred = <Value,>() => {
  let resolve!: (value: Value) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<Value>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const createAuth = () => ({
  signInWithPassword: jest.fn(),
  signInWithIdToken: jest.fn(),
  signOutLocal: jest.fn(async () => ({ error: null })),
  getSession: jest.fn(async () => ({ data: { session: null }, error: null })),
  onAuthStateChange: jest.fn(),
  startAutoRefresh: jest.fn(),
  stopAutoRefresh: jest.fn(),
  refreshSession: jest.fn(),
  getAuthenticatorAssuranceLevel: jest.fn(),
  classifyAuthError: jest.fn(() => 'transient'),
  mfaEnrollTotp: jest.fn(),
  mfaChallenge: jest.fn(),
  mfaVerify: jest.fn(),
  mfaUnenroll: jest.fn(),
  mfaListFactors: jest.fn(),
  changePassword: jest.fn(),
})

function Probe({ capture }: { capture: (value: ProductRuntimeContextValue) => void }) {
  const value = useProductRuntime()
  useEffect(() => {
    capture(value)
  }, [capture, value])
  return <Text>{`${value.routeState.status}:${value.runtime?.principalId ?? 'none'}:${value.runtime?.epochId ?? 'none'}`}</Text>
}

function FinancialChild({ events = [] }: { events?: string[] }) {
  useEffect(() => {
    events.push('child-mounted')
    return () => { events.push('child-cleanup') }
  }, [events])
  return <Text>financial-content</Text>
}

type HarnessOptions = {
  auth?: ReturnType<typeof createAuth>
  queryClient?: QueryClient
  operationScope?: ReturnType<typeof createSessionOperationScope>
  createRuntime?: (input: Parameters<NonNullable<React.ComponentProps<typeof ProductRuntimeProvider>['createRuntime']>>[0]) => ProductRuntime
  boundaryChild?: React.ReactNode
  withBoundary?: boolean
}

async function createHarness(initialSession = session('a'), options: HarnessOptions = {}) {
  const auth = options.auth ?? createAuth()
  const queryClient = options.queryClient ?? new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  let latest!: ProductRuntimeContextValue
  const tree = (value: ReturnType<typeof session> | null) => (
    <QueryClientProvider client={queryClient}>
      <AppSessionProvider session={value}>
        <ProductRuntimeProvider
          auth={auth as never}
          transport={{ request: jest.fn() } as never}
          operationScope={options.operationScope}
          createRuntime={options.createRuntime}
        >
          <Probe capture={(next) => { latest = next }} />
          {options.withBoundary === false ? null : (
            <AuthenticatedRouteBoundary>
              {options.boundaryChild ?? <FinancialChild />}
            </AuthenticatedRouteBoundary>
          )}
        </ProductRuntimeProvider>
      </AppSessionProvider>
    </QueryClientProvider>
  )
  const view = await render(tree(initialSession))
  await waitFor(() => expect(latest?.routeState.status).toBe('authenticated'))
  return {
    auth,
    queryClient,
    view,
    current: () => latest,
    rerenderSession: (value: ReturnType<typeof session> | null) => view.rerender(tree(value)),
    cleanup: async () => {
      await view.unmount()
      queryClient.clear()
    },
  }
}

describe('ProductRuntimeProvider integration', () => {
  it('orders logout through child cleanup, query purge, and then Supabase sign-out', async () => {
    const events: string[] = []
    const realScope = createSessionOperationScope()
    const operationScope = {
      ...realScope,
      invalidate: jest.fn(() => {
        events.push('invalidate')
        realScope.invalidate()
      }),
    }
    const queryClient = new QueryClient()
    let view: Awaited<ReturnType<typeof render>>
    const originalClear = queryClient.clear.bind(queryClient)
    jest.spyOn(queryClient, 'cancelQueries').mockImplementation(async () => {
      events.push('cancel')
      expect(view.queryByText('financial-content')).not.toBeOnTheScreen()
      expect(events).toContain('child-cleanup')
    })
    jest.spyOn(queryClient, 'clear').mockImplementation(() => {
      events.push('clear')
      originalClear()
    })
    const auth = createAuth()
    auth.signOutLocal.mockImplementation(async () => {
      events.push('sign-out')
      return { error: null }
    })
    const harness = await createHarness(session('a'), {
      auth,
      queryClient,
      operationScope,
      boundaryChild: <FinancialChild events={events} />,
    })
    view = harness.view
    queryClient.setQueryData(['sensitive'], 'secret')

    let logout!: Promise<void>
    await act(() => { logout = harness.current().signOut() })
    await act(async () => { await logout })

    expect(events).toEqual([
      'child-mounted',
      'invalidate',
      'child-cleanup',
      'cancel',
      'clear',
      'sign-out',
    ])
    expect(queryClient.getQueryData(['sensitive'])).toBeUndefined()
    expect(harness.current().routeState.status).toBe('signed-out')
    await harness.cleanup()
  })

  it('does not reintroduce cache or financial UI when an abort-ignoring query resolves after logout', async () => {
    const pending = deferred<string>()
    function PendingFinancialQuery() {
      const result = useQuery({ queryKey: ['net-worth-like'], queryFn: () => pending.promise })
      return <Text>{result.data ?? 'financial-loading'}</Text>
    }
    const harness = await createHarness(session('a'), { boundaryChild: <PendingFinancialQuery /> })
    await waitFor(() => expect(harness.view.getByText('financial-loading')).toBeOnTheScreen())

    let logout!: Promise<void>
    await act(() => { logout = harness.current().signOut() })
    await act(async () => { await logout })
    expect(harness.view.queryByText('financial-loading')).not.toBeOnTheScreen()

    pending.resolve('late-financial-success')
    await act(async () => { await pending.promise })

    expect(harness.view.queryByText('late-financial-success')).not.toBeOnTheScreen()
    expect(harness.current().runtime).toBeNull()
    expect(harness.queryClient.getQueryData(['net-worth-like'])).toBeUndefined()
    await harness.cleanup()
  })

  it.each(['mfa-required'] as const)(
    'purges financial state before entering %s without signing out Supabase',
    async (reason) => {
      const events: string[] = []
      const queryClient = new QueryClient()
      const originalClear = queryClient.clear.bind(queryClient)
      jest.spyOn(queryClient, 'cancelQueries').mockImplementation(async () => { events.push('cancel') })
      jest.spyOn(queryClient, 'clear').mockImplementation(() => {
        events.push('clear')
        originalClear()
      })
      const auth = createAuth()
      const harness = await createHarness(session('a'), {
        auth,
        queryClient,
        boundaryChild: <FinancialChild events={events} />,
      })
      queryClient.setQueryData(['cached-financial'], 'secret')

      await act(() => { harness.current().blockAccess(reason) })
      await waitFor(() => expect(harness.current().routeState.status).toBe(reason))

      expect(events).toEqual(['child-mounted', 'child-cleanup', 'cancel', 'clear'])
      expect(harness.view.queryByText('financial-content')).not.toBeOnTheScreen()
      expect(queryClient.getQueryData(['cached-financial'])).toBeUndefined()
      expect(auth.signOutLocal).not.toHaveBeenCalled()
      await harness.cleanup()
    },
  )

  it('starts revocation synchronously and lets the initiating query settle without cancellation deadlock', async () => {
    const endpoint = readEndpoint({ method: 'GET', path: '/v1/revocation-test', schema: z.object({ ok: z.boolean() }) })
    const auth = createAuth()
    auth.getSession.mockResolvedValue({ data: { session: session('a') }, error: null })
    auth.refreshSession.mockResolvedValue({ data: { session: null }, error: null })
    auth.signOutLocal.mockResolvedValue({ error: null })
    const events: string[] = []
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const originalCancel = queryClient.cancelQueries.bind(queryClient)
    jest.spyOn(queryClient, 'cancelQueries').mockImplementation(async (...args) => {
      events.push('cancel')
      await originalCancel(...args)
    })
    const transport = { request: jest.fn(async () => ({ status: 401, body: {} })) }
    let latest!: ProductRuntimeContextValue
    function RevokingQuery() {
      const runtime = useProductRuntime().runtime
      const query = useQuery({
        queryKey: ['revoking-query'],
        enabled: runtime !== null,
        retry: false,
        queryFn: () => runtime!.apiClient.read(endpoint),
      })
      return <Text>{query.isPending ? 'request-pending' : 'request-settled'}</Text>
    }
    const view = await render(
      <QueryClientProvider client={queryClient}>
        <AppSessionProvider session={session('a')}>
          <ProductRuntimeProvider auth={auth as never} transport={transport as never}>
            <Probe capture={(value) => { latest = value }} />
            <AuthenticatedRouteBoundary><RevokingQuery /></AuthenticatedRouteBoundary>
          </ProductRuntimeProvider>
        </AppSessionProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(transport.request).toHaveBeenCalled())
    await waitFor(() => expect(events).toContain('cancel'))
    await waitFor(() => expect(latest.routeState.status).toBe('signed-out'))
    expect(auth.signOutLocal).toHaveBeenCalledTimes(1)
    expect(view.queryByText('request-pending')).not.toBeOnTheScreen()
    await view.unmount()
    queryClient.clear()
  })

  it('coalesces logout while a null session races sign-out completion', async () => {
    const signingOut = deferred<{ error: null }>()
    const auth = createAuth()
    auth.signOutLocal.mockReturnValue(signingOut.promise)
    const harness = await createHarness(session('a'), { auth })

    let first!: Promise<void>
    let concurrent!: Promise<void>
    await act(() => {
      first = harness.current().signOut()
      concurrent = harness.current().signOut()
    })
    expect(concurrent).toBe(first)
    await harness.rerenderSession(null)
    expect(auth.signOutLocal).toHaveBeenCalledTimes(1)

    signingOut.resolve({ error: null })
    await act(async () => { await first })
    expect(harness.current().routeState.status).toBe('signed-out')
    expect(auth.signOutLocal).toHaveBeenCalledTimes(1)
    await harness.cleanup()
  })

  it('treats a sign-out error with a null verified session as signed out', async () => {
    const auth = createAuth()
    auth.signOutLocal.mockResolvedValue({ error: { code: 'unavailable' } } as never)
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    const harness = await createHarness(session('a'), { auth })

    let logout!: Promise<void>
    await act(() => { logout = harness.current().signOut() })
    await act(async () => { await logout })

    expect(harness.current().routeState.status).toBe('signed-out')
    await harness.cleanup()
  })

  it('fails closed when the session remains after sign-out and permits a successful retry', async () => {
    const auth = createAuth()
    auth.signOutLocal
      .mockResolvedValueOnce({ error: { code: 'unavailable' } } as never)
      .mockResolvedValueOnce({ error: null })
    auth.getSession.mockResolvedValue({ data: { session: session('a') }, error: null })
    const harness = await createHarness(session('a'), { auth })

    let logout!: Promise<void>
    await act(() => { logout = harness.current().signOut() })
    await act(async () => { await logout })
    expect(harness.current().routeState.status).toBe('sign-out-failed')
    expect(harness.current().runtime).toBeNull()

    let retry!: Promise<void>
    await act(() => { retry = harness.current().retrySignOut() })
    await act(async () => { await retry })
    expect(harness.current().routeState.status).toBe('signed-out')
    expect(auth.signOutLocal).toHaveBeenCalledTimes(2)
    await harness.cleanup()
  })

  it('keeps one runtime for same-principal refresh and retires A before activating B', async () => {
    const queryClient = new QueryClient()
    const clear = jest.spyOn(queryClient, 'clear')
    const createRuntime = jest.fn((input): ProductRuntime => ({
      epochId: input.epochId,
      principalId: input.principalId,
      apiClient: {} as never,
    }))
    const harness = await createHarness(session('a'), { queryClient, createRuntime })
    expect(harness.view.getByText('authenticated:a:1')).toBeOnTheScreen()

    await harness.rerenderSession(session('a', 'refreshed-token'))
    expect(createRuntime).toHaveBeenCalledTimes(1)

    await harness.rerenderSession(session('b'))
    await waitFor(() => expect(harness.view.getByText('authenticated:b:2')).toBeOnTheScreen())
    expect(clear.mock.invocationCallOrder[0]).toBeLessThan(createRuntime.mock.invocationCallOrder[1]!)
    await harness.cleanup()
  })

  it('prevents an abort-ignoring A completion from overwriting B after a direct swap', async () => {
    const pendingA = deferred<string>()
    function EpochQuery() {
      const { runtime } = useProductRuntime()
      const query = useQuery({
        queryKey: ['shared-financial'],
        enabled: runtime !== null,
        retry: false,
        queryFn: () => runtime?.principalId === 'a' ? pendingA.promise : Promise.resolve('value-b'),
      })
      return <Text>{query.data ?? 'epoch-loading'}</Text>
    }
    const harness = await createHarness(session('a'), { boundaryChild: <EpochQuery /> })
    await waitFor(() => expect(harness.view.getByText('epoch-loading')).toBeOnTheScreen())

    await harness.rerenderSession(session('b'))
    await waitFor(() => expect(harness.view.getByText('value-b')).toBeOnTheScreen())
    expect(harness.queryClient.getQueryData(['shared-financial'])).toBe('value-b')

    pendingA.resolve('late-value-a')
    await act(async () => { await pendingA.promise })
    expect(harness.view.getByText('value-b')).toBeOnTheScreen()
    expect(harness.queryClient.getQueryData(['shared-financial'])).toBe('value-b')
    await harness.cleanup()
  })

  it('completes logout immediately when no authenticated boundary is registered', async () => {
    const harness = await createHarness(session('a'), { withBoundary: false })

    let logout!: Promise<void>
    await act(() => { logout = harness.current().signOut() })
    await act(async () => { await logout })

    expect(harness.current().routeState.status).toBe('signed-out')
    expect(harness.auth.signOutLocal).toHaveBeenCalledTimes(1)
    await harness.cleanup()
  })

  it('registers the boundary before a child passive effect can begin an access transition', async () => {
    const events: string[] = []
    const queryClient = new QueryClient()
    const originalClear = queryClient.clear.bind(queryClient)
    jest.spyOn(queryClient, 'cancelQueries').mockImplementation(async () => {
      events.push('cancel')
      expect(events).toContain('child-cleanup')
    })
    jest.spyOn(queryClient, 'clear').mockImplementation(() => {
      events.push('clear')
      originalClear()
    })
    let latest!: ProductRuntimeContextValue
    function ImmediateAccessBlock() {
      const { blockAccess } = useProductRuntime()
      useEffect(() => {
        events.push('child-effect')
        blockAccess('mfa-required')
        return () => { events.push('child-cleanup') }
      }, [blockAccess])
      return <Text>first-commit-financial</Text>
    }
    const view = await render(
      <QueryClientProvider client={queryClient}>
        <AppSessionProvider session={session('a')}>
          <ProductRuntimeProvider auth={createAuth() as never} transport={{ request: jest.fn() } as never}>
            <Probe capture={(value) => { latest = value }} />
            <AuthenticatedRouteBoundary><ImmediateAccessBlock /></AuthenticatedRouteBoundary>
          </ProductRuntimeProvider>
        </AppSessionProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(latest?.routeState.status).toBe('mfa-required'))
    expect(events).toEqual(['child-effect', 'child-cleanup', 'cancel', 'clear'])
    expect(view.queryByText('first-commit-financial')).not.toBeOnTheScreen()
    await view.unmount()
    queryClient.clear()
  })

  it('does not hang a pending transition when the authenticated boundary unexpectedly unmounts', async () => {
    const events: string[] = []
    const queryClient = new QueryClient()
    const cancel = jest.spyOn(queryClient, 'cancelQueries').mockImplementation(async () => {
      events.push('cancel')
      expect(events).toContain('child-cleanup')
    })
    const auth = createAuth()
    let latest!: ProductRuntimeContextValue
    let hideBoundary!: () => void
    let logout!: Promise<void>
    function UnmountingFinancialChild() {
      const { signOut } = useProductRuntime()
      useLayoutEffect(() => () => {
        events.push('layout-transition')
        logout = signOut()
        // The boundary's layout registration may already be gone, but its
        // committed passive presence must still hold cancellation.
        expect(cancel).not.toHaveBeenCalled()
      }, [signOut])
      useEffect(() => () => { events.push('child-cleanup') }, [])
      return <Text>unexpected-unmount-financial</Text>
    }
    function BoundaryHost() {
      const [shown, setShown] = useState(true)
      useEffect(() => {
        hideBoundary = () => setShown(false)
      }, [])
      return shown ? (
        <AuthenticatedRouteBoundary><UnmountingFinancialChild /></AuthenticatedRouteBoundary>
      ) : null
    }
    const view = await render(
      <QueryClientProvider client={queryClient}>
        <AppSessionProvider session={session('a')}>
          <ProductRuntimeProvider auth={auth as never} transport={{ request: jest.fn() } as never}>
            <Probe capture={(value) => { latest = value }} />
            <BoundaryHost />
          </ProductRuntimeProvider>
        </AppSessionProvider>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(latest?.routeState.status).toBe('authenticated'))

    await act(() => { hideBoundary() })
    await act(async () => { await logout })

    expect(cancel).toHaveBeenCalled()
    expect(events).toEqual(['layout-transition', 'child-cleanup', 'cancel'])
    expect(latest.routeState.status).toBe('signed-out')
    await view.unmount()
    queryClient.clear()
  })

  it('shares one terminal flight for concurrent revocation and logout', async () => {
    const endpoint = readEndpoint({ method: 'GET', path: '/v1/concurrent-revocation', schema: z.object({ ok: z.boolean() }) })
    const cancelGate = deferred<void>()
    const queryClient = new QueryClient()
    const cancel = jest.spyOn(queryClient, 'cancelQueries').mockImplementation(() => cancelGate.promise)
    const auth = createAuth()
    auth.getSession.mockResolvedValue({ data: { session: session('a') }, error: null })
    auth.refreshSession.mockResolvedValue({ data: { session: null }, error: null })
    const transport = { request: jest.fn(async () => ({ status: 401, body: {} })) }
    let latest!: ProductRuntimeContextValue
    const view = await render(
      <QueryClientProvider client={queryClient}>
        <AppSessionProvider session={session('a')}>
          <ProductRuntimeProvider auth={auth as never} transport={transport as never}>
            <Probe capture={(value) => { latest = value }} />
            <AuthenticatedRouteBoundary><FinancialChild /></AuthenticatedRouteBoundary>
          </ProductRuntimeProvider>
        </AppSessionProvider>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(latest?.runtime).not.toBeNull())

    const initiatingRequest = latest.runtime!.apiClient.read(endpoint).catch((error: unknown) => error)
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1))
    // Recovery returns immediately rather than waiting on the cancellation it initiated.
    await expect(initiatingRequest).resolves.toBeDefined()
    const concurrentLogout = latest.signOut()
    expect(auth.signOutLocal).not.toHaveBeenCalled()

    cancelGate.resolve()
    await act(async () => { await concurrentLogout })

    expect(cancel).toHaveBeenCalledTimes(1)
    expect(auth.signOutLocal).toHaveBeenCalledTimes(1)
    expect(latest.routeState.status).toBe('signed-out')
    await view.unmount()
    queryClient.clear()
  })

  it('invalidates operations and purges the stable QueryClient on provider unmount', async () => {
    const realScope = createSessionOperationScope()
    const operationScope = {
      ...realScope,
      invalidate: jest.fn(() => realScope.invalidate()),
    }
    const queryClient = new QueryClient()
    const cancel = jest.spyOn(queryClient, 'cancelQueries')
    queryClient.setQueryData(['unmount-sensitive'], 'secret')
    const harness = await createHarness(session('a'), {
      queryClient,
      operationScope,
      withBoundary: false,
    })

    await harness.view.unmount()
    await waitFor(() => expect(cancel).toHaveBeenCalled())

    expect(operationScope.invalidate).toHaveBeenCalled()
    expect(queryClient.getQueryData(['unmount-sensitive'])).toBeUndefined()
    queryClient.clear()
  })

  it('provisions the app user before entering authenticated', async () => {
    ;(provisionAppUser as jest.Mock).mockReset().mockResolvedValue('provisioned')
    let latest!: ProductRuntimeContextValue
    const queryClient = new QueryClient()
    const view = await render(
      <QueryClientProvider client={queryClient}>
        <AppSessionProvider session={session('a')}>
          <ProductRuntimeProvider auth={createAuth() as never} transport={{ request: jest.fn() } as never}>
            <Probe capture={(value) => { latest = value }} />
          </ProductRuntimeProvider>
        </AppSessionProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(latest.routeState.status).toBe('authenticated'))
    expect(provisionAppUser).toHaveBeenCalledTimes(1)
    await view.unmount()
    queryClient.clear()
  })

  it('on provisioning failure, signs out and surfaces activationError', async () => {
    ;(provisionAppUser as jest.Mock).mockReset().mockResolvedValue('failed')
    const auth = createAuth()
    let latest!: ProductRuntimeContextValue
    const queryClient = new QueryClient()
    const view = await render(
      <QueryClientProvider client={queryClient}>
        <AppSessionProvider session={session('a')}>
          <ProductRuntimeProvider auth={auth as never} transport={{ request: jest.fn() } as never}>
            <Probe capture={(value) => { latest = value }} />
          </ProductRuntimeProvider>
        </AppSessionProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(latest.routeState.status).toBe('signed-out'))
    expect(latest.activationError).toBe('provision-failed')
    expect(auth.signOutLocal).toHaveBeenCalledTimes(1)
    await view.unmount()
    queryClient.clear()
  })

  it('does not let a stale provisioning result overwrite a newer activation outcome', async () => {
    const provisioning = [deferred<'provisioned' | 'failed'>(), deferred<'provisioned' | 'failed'>()]
    let callIndex = 0
    ;(provisionAppUser as jest.Mock).mockReset().mockImplementation(() => provisioning[callIndex++]!.promise)
    const auth = createAuth()
    let latest!: ProductRuntimeContextValue
    const queryClient = new QueryClient()
    const tree = (value: ReturnType<typeof session>) => (
      <QueryClientProvider client={queryClient}>
        <AppSessionProvider session={value}>
          <ProductRuntimeProvider auth={auth as never} transport={{ request: jest.fn() } as never}>
            <Probe capture={(next) => { latest = next }} />
          </ProductRuntimeProvider>
        </AppSessionProvider>
      </QueryClientProvider>
    )

    const view = await render(tree(session('a')))
    await waitFor(() => expect(provisionAppUser).toHaveBeenCalledTimes(1))

    // A same-user session update (e.g. TOKEN_REFRESHED) races in while the first
    // activation's provisioning call is still in flight. runtimeRef is still null at
    // this point, so the same-principal skip guard does not catch it — a second,
    // concurrent activation starts.
    await act(async () => { view.rerender(tree(session('a', 'refreshed-token'))) })
    await waitFor(() => expect(provisionAppUser).toHaveBeenCalledTimes(2))

    // The newer (second) activation resolves first and fails: signs out and surfaces
    // the error. This is the correct state at this instant.
    await act(async () => {
      provisioning[1]!.resolve('failed')
      await provisioning[1]!.promise
    })
    await waitFor(() => expect(latest.routeState.status).toBe('signed-out'))
    expect(latest.activationError).toBe('provision-failed')
    expect(auth.signOutLocal).toHaveBeenCalledTimes(1)

    // The stale first activation resolves late with success. Without the freshness
    // guard this would resurrect access after the sign-out above.
    await act(async () => {
      provisioning[0]!.resolve('provisioned')
      await provisioning[0]!.promise
    })

    expect(latest.routeState.status).toBe('signed-out')
    expect(latest.activationError).toBe('provision-failed')
    expect(latest.runtime).toBeNull()
    expect(auth.signOutLocal).toHaveBeenCalledTimes(1)
    await view.unmount()
    queryClient.clear()
  })

  it('does not resurrect access when the session clears while activation provisioning is still in flight', async () => {
    const provisioning = deferred<'provisioned' | 'failed'>()
    ;(provisionAppUser as jest.Mock).mockReset().mockImplementation(() => provisioning.promise)
    const auth = createAuth()
    let latest!: ProductRuntimeContextValue
    const queryClient = new QueryClient()
    const tree = (value: ReturnType<typeof session> | null) => (
      <QueryClientProvider client={queryClient}>
        <AppSessionProvider session={value}>
          <ProductRuntimeProvider auth={auth as never} transport={{ request: jest.fn() } as never}>
            <Probe capture={(next) => { latest = next }} />
          </ProductRuntimeProvider>
        </AppSessionProvider>
      </QueryClientProvider>
    )

    const view = await render(tree(session('a')))
    await waitFor(() => expect(provisionAppUser).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(latest.routeState.status).toBe('activating'))

    // The session is cleared externally (e.g. a SIGNED_OUT event or token revocation)
    // while provisioning for the first activation is still in flight. No new activate()
    // call happens for a null session — the activation effect sets signed-out directly —
    // so epochCounter is untouched. Only activationVersion advances.
    await act(async () => { view.rerender(tree(null)) })
    await waitFor(() => expect(latest.routeState.status).toBe('signed-out'))

    // The stale provisioning call now resolves successfully. Without the
    // activationVersion freshness guard this would wrongly commit 'authenticated'
    // with a null/stale session.
    await act(async () => {
      provisioning.resolve('provisioned')
      await provisioning.promise
    })

    expect(latest.routeState.status).toBe('signed-out')
    expect(latest.runtime).toBeNull()
    await view.unmount()
    queryClient.clear()
  })

  it('proxies native ID-token sign-in and refuses it while a terminal transition is in flight', async () => {
    const signingOut = deferred<{ error: null }>()
    const auth = createAuth()
    auth.signInWithIdToken.mockResolvedValue({ status: 'accepted' })
    const harness = await createHarness(session('a'), { auth })

    let accepted: Awaited<ReturnType<ProductRuntimeContextValue['signInWithIdToken']>> | undefined
    await act(async () => {
      accepted = await harness.current().signInWithIdToken('apple', 'id-token', 'raw-nonce')
    })
    expect(accepted).toEqual({ status: 'accepted' })
    expect(auth.signInWithIdToken).toHaveBeenCalledWith('apple', 'id-token', 'raw-nonce')

    auth.signOutLocal.mockReturnValue(signingOut.promise)
    let logout!: Promise<void>
    await act(() => { logout = harness.current().signOut() })

    let blocked: Awaited<ReturnType<ProductRuntimeContextValue['signInWithIdToken']>> | undefined
    await act(async () => {
      blocked = await harness.current().signInWithIdToken('google', 'id-token', 'raw-nonce')
    })
    expect(blocked).toEqual({ status: 'unavailable' })
    expect(auth.signInWithIdToken).toHaveBeenCalledTimes(1)

    signingOut.resolve({ error: null })
    await act(async () => { await logout })
    await harness.cleanup()
  })

  it('returns unavailable from signUp while a terminal transition is in flight', async () => {
    const signingOut = deferred<{ error: null }>()
    const auth = createAuth()
    auth.signOutLocal.mockReturnValue(signingOut.promise)
    const harness = await createHarness(session('a'), { auth })

    let logout!: Promise<void>
    await act(() => { logout = harness.current().signOut() })

    let signUpResult: Awaited<ReturnType<ProductRuntimeContextValue['signUp']>> | undefined
    await act(async () => {
      signUpResult = await harness.current().signUp('a@b.co', 'pw12345678')
    })
    expect(signUpResult).toEqual({ status: 'unavailable' })

    signingOut.resolve({ error: null })
    await act(async () => { await logout })
    await harness.cleanup()
  })
})

describe('ProductRuntimeProvider MFA', () => {
  it('exposes thin proxies to the injected auth adapter MFA operations', async () => {
    const auth = createAuth()
    auth.mfaEnrollTotp.mockResolvedValue({ status: 'enrolled', factorId: 'f1', totp: { qrCode: 'x', secret: 's', uri: 'u' } })
    auth.mfaChallenge.mockResolvedValue({ status: 'challenged', challengeId: 'c1' })
    auth.mfaVerify.mockResolvedValue({ status: 'verified' })
    auth.mfaUnenroll.mockResolvedValue({ status: 'unenrolled' })
    auth.mfaListFactors.mockResolvedValue({ status: 'available', totpFactors: [] })
    const harness = await createHarness(session('a'), { auth })

    await expect(harness.current().mfaEnrollTotp()).resolves.toEqual({ status: 'enrolled', factorId: 'f1', totp: { qrCode: 'x', secret: 's', uri: 'u' } })
    await expect(harness.current().mfaChallenge('f1')).resolves.toEqual({ status: 'challenged', challengeId: 'c1' })
    expect(auth.mfaChallenge).toHaveBeenCalledWith('f1')
    await expect(harness.current().mfaVerify('f1', 'c1', '123456')).resolves.toEqual({ status: 'verified' })
    expect(auth.mfaVerify).toHaveBeenCalledWith('f1', 'c1', '123456')
    await expect(harness.current().mfaUnenroll('f1')).resolves.toEqual({ status: 'unenrolled' })
    expect(auth.mfaUnenroll).toHaveBeenCalledWith('f1')
    await expect(harness.current().mfaListFactors()).resolves.toEqual({ status: 'available', totpFactors: [] })
    await harness.cleanup()
  })

  it('exposes a thin proxy to the injected auth adapter password-change operation', async () => {
    const auth = createAuth()
    auth.changePassword.mockResolvedValue({ status: 'updated' })
    const harness = await createHarness(session('a'), { auth })

    await expect(harness.current().changePassword('person@example.com', 'oldpw12345', 'newpw12345')).resolves.toEqual({ status: 'updated' })
    expect(auth.changePassword).toHaveBeenCalledWith('person@example.com', 'oldpw12345', 'newpw12345')
    await harness.cleanup()
  })

  it('resumes to authenticated after a verified MFA step-up, re-provisioning the app user', async () => {
    ;(provisionAppUser as jest.Mock).mockReset().mockResolvedValue('provisioned')
    const auth = createAuth()
    const harness = await createHarness(session('a'), { auth })

    await act(() => { harness.current().blockAccess('mfa-required') })
    await waitFor(() => expect(harness.current().routeState.status).toBe('mfa-required'))
    expect(harness.current().runtime).toBeNull()

    auth.getSession.mockResolvedValue({ data: { session: session('a', 'aal2-token') }, error: null })
    await act(async () => { await harness.current().completeMfaVerification() })

    expect(harness.current().routeState.status).toBe('authenticated')
    expect(harness.current().runtime?.principalId).toBe('a')
    expect(provisionAppUser).toHaveBeenCalledTimes(2)
    await harness.cleanup()
  })

  it('does nothing when called outside the mfa-required state', async () => {
    const auth = createAuth()
    const harness = await createHarness(session('a'), { auth })

    await act(async () => { await harness.current().completeMfaVerification() })

    expect(harness.current().routeState.status).toBe('authenticated')
    expect(auth.getSession).not.toHaveBeenCalled()
    await harness.cleanup()
  })

  it('fails closed to sign-out-failed when no session is found after a claimed verification', async () => {
    const auth = createAuth()
    const harness = await createHarness(session('a'), { auth })

    await act(() => { harness.current().blockAccess('mfa-required') })
    await waitFor(() => expect(harness.current().routeState.status).toBe('mfa-required'))

    auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    await act(async () => { await harness.current().completeMfaVerification() })

    expect(harness.current().routeState.status).toBe('sign-out-failed')
    await harness.cleanup()
  })
})

describe('ProductRuntimeProvider household invites (RAD-499)', () => {
  it('threads a pending invite token into provisioning and clears it afterward', async () => {
    ;(provisionAppUser as jest.Mock).mockReset().mockResolvedValue('provisioned')
    setPendingInviteToken('invite-tok-1')

    let latest!: ProductRuntimeContextValue
    const queryClient = new QueryClient()
    const view = await render(
      <QueryClientProvider client={queryClient}>
        <AppSessionProvider session={session('a')}>
          <ProductRuntimeProvider auth={createAuth() as never} transport={{ request: jest.fn() } as never}>
            <Probe capture={(value) => { latest = value }} />
          </ProductRuntimeProvider>
        </AppSessionProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(latest.routeState.status).toBe('authenticated'))
    expect(provisionAppUser).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'invite-tok-1')
    expect(takePendingInviteToken()).toBeNull()
    await view.unmount()
    queryClient.clear()
  })

  it('provisions without an invite token when none is pending', async () => {
    ;(provisionAppUser as jest.Mock).mockReset().mockResolvedValue('provisioned')

    let latest!: ProductRuntimeContextValue
    const queryClient = new QueryClient()
    const view = await render(
      <QueryClientProvider client={queryClient}>
        <AppSessionProvider session={session('a')}>
          <ProductRuntimeProvider auth={createAuth() as never} transport={{ request: jest.fn() } as never}>
            <Probe capture={(value) => { latest = value }} />
          </ProductRuntimeProvider>
        </AppSessionProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(latest.routeState.status).toBe('authenticated'))
    expect(provisionAppUser).toHaveBeenCalledWith(expect.anything(), expect.anything(), undefined)
    await view.unmount()
    queryClient.clear()
  })

  it('exposes a pre-auth household-invite validation proxy backed by the raw transport', async () => {
    const request = jest.fn().mockResolvedValue({
      status: 200,
      body: { email: 'partner@example.com', expiresAt: '2024-01-08T00:00:00.000Z', inviterName: 'Alex' },
    })
    let latest!: ProductRuntimeContextValue
    const queryClient = new QueryClient()
    const view = await render(
      <QueryClientProvider client={queryClient}>
        <AppSessionProvider session={null}>
          <ProductRuntimeProvider auth={createAuth() as never} transport={{ request } as never}>
            <Probe capture={(value) => { latest = value }} />
          </ProductRuntimeProvider>
        </AppSessionProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(latest.routeState.status).toBe('signed-out'))
    expect(latest.runtime).toBeNull()
    await expect(latest.validateHouseholdInvite('tok-1')).resolves.toEqual({
      status: 'valid',
      invite: { email: 'partner@example.com', expiresAt: '2024-01-08T00:00:00.000Z', inviterName: 'Alex' },
    })
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'GET',
      path: '/v1/household/invites/validate?token=tok-1',
    }))
    await view.unmount()
    queryClient.clear()
  })
})
