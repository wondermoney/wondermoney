import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { type ReactNode, useEffect, useSyncExternalStore } from 'react'
import { Pressable, Text } from 'react-native'
import { useTranslation } from 'react-i18next'

import type { SessionLifecycleState } from '@/lib/auth/session-lifecycle'

import { AuthenticatedRouteBoundary } from './authenticated-route-boundary'
import { AppProviders, type SessionLifecycle } from './app-providers'
import { useAppSession } from './app-session-context'
import {
  ProductRuntimeProvider,
  useProductRuntime,
  type ProductRuntime,
} from './product-runtime-provider'
import {
  SessionPreferencesProvider,
  type ThemePreference,
  useSessionPreferences,
} from './session-preferences-provider'

jest.mock('@/lib/auth/provision-app-user', () => ({
  provisionAppUser: jest.fn(async () => 'provisioned'),
  authCallbackEndpoint: { method: 'POST', path: '/v1/auth/callback' },
}))

type TestSession = { userId: string }

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

function lifecycle<Session = TestSession>(
  initialState: SessionLifecycleState<Session> = { status: 'loading' },
) {
  let state = initialState
  const listeners = new Set<(next: SessionLifecycleState<Session>) => void>()
  const value: SessionLifecycle<Session> & {
    emit: (next: SessionLifecycleState<Session>) => void
  } = {
    get state() {
      return state
    },
    start: jest.fn(async () => undefined),
    dispose: jest.fn(async () => undefined),
    subscribe: jest.fn((listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    emit(next) {
      state = next
      listeners.forEach((listener) => listener(next))
    },
  }
  return value
}

function Shell({ queryClients }: { queryClients?: unknown[] }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  queryClients?.push(queryClient)
  return <Text>{`${t('common.refresh')}|${t('loading')}`}</Text>
}

function SessionProbe() {
  const { session } = useAppSession<TestSession>()
  return <Text>{session?.userId ?? 'none'}</Text>
}

describe('AppProviders', () => {
  it.each([
    ['en', 'Refresh|Loading'],
    ['pt-PT', 'Atualizar|A carregar'],
  ])('waits for isolated %s translations before rendering children', async (locale, label) => {
    const session = lifecycle({ status: 'ready', session: null })
    const view = await render(
      <AppProviders locale={locale} createSessionLifecycle={() => session}>
        <Shell />
      </AppProviders>,
    )

    expect(view.queryByText(/common\.refresh|loading/)).not.toBeOnTheScreen()
    expect(view.getByText(label)).toBeOnTheScreen()
  })

  it('renders translated designer loading and recoverable-error states', async () => {
    const session = lifecycle()
    const view = await render(
      <AppProviders locale="pt-PT" createSessionLifecycle={() => session}>
        <Shell />
      </AppProviders>,
    )

    expect(view.getByText('A carregar')).toBeOnTheScreen()

    await act(async () => session.emit({ status: 'recoverable-error' }))

    expect(view.getByRole('alert', { name: 'Não foi possível carregar a aplicação' })).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Tentar novamente' })).toBeOnTheScreen()
  })

  it('keeps one QueryClient while retry replaces, disposes, and starts the lifecycle epoch', async () => {
    const first = lifecycle({ status: 'ready', session: null })
    const second = lifecycle({ status: 'ready', session: null })
    const factory = jest.fn().mockReturnValueOnce(first).mockReturnValueOnce(second)
    const queryClients: unknown[] = []
    const view = await render(
      <AppProviders locale="en" createSessionLifecycle={factory}>
        <Shell queryClients={queryClients} />
      </AppProviders>,
    )
    view.getByText('Refresh|Loading')

    await act(async () => first.emit({ status: 'recoverable-error' }))
    await fireEvent.press(view.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(view.getByText('Refresh|Loading')).toBeOnTheScreen())

    expect(factory).toHaveBeenCalledTimes(2)
    expect(first.start).toHaveBeenCalledTimes(1)
    expect(first.dispose).toHaveBeenCalledTimes(1)
    expect(second.start).toHaveBeenCalledTimes(1)
    expect(new Set(queryClients).size).toBe(1)
  })

  it('changes the interface locale without recreating auth lifecycle or QueryClient', async () => {
    const session = lifecycle({ status: 'ready', session: null })
    const factory = jest.fn(() => session)
    const queryClients: unknown[] = []
    const view = await render(<AppProviders locale="en" createSessionLifecycle={factory}><Shell queryClients={queryClients} /></AppProviders>)
    expect(view.getByText('Refresh|Loading')).toBeOnTheScreen()
    await view.rerender(<AppProviders locale="pt-PT" createSessionLifecycle={factory}><Shell queryClients={queryClients} /></AppProviders>)
    await waitFor(() => expect(view.getByText('Atualizar|A carregar')).toBeOnTheScreen())
    expect(factory).toHaveBeenCalledTimes(1)
    expect(session.dispose).not.toHaveBeenCalled()
    expect(new Set(queryClients).size).toBe(1)
  })

  it('keeps QueryClient, auth lifecycle, and i18n stable across atomic Light, Dark, and System changes', async () => {
    type NativeScheme = 'light' | 'dark' | 'unspecified'
    let deviceScheme: 'light' | 'dark' = 'light'
    let override: NativeScheme = 'unspecified'
    const listeners = new Set<() => void>()
    const setColorScheme = jest.fn((scheme: NativeScheme) => {
      override = scheme
      listeners.forEach((listener) => listener())
    })
    const useTestColorScheme = () => useSyncExternalStore(
      (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      () => override === 'unspecified' ? deviceScheme : override,
    )
    const session = lifecycle({ status: 'ready', session: null })
    const factory = jest.fn(() => session)
    const queryClients: QueryClient[] = []
    const i18nInstances: unknown[] = []
    const languages: string[] = []
    const themeSnapshots: { preference: ThemePreference; native: string; setterCalls: number }[] = []

    function StabilityProbe() {
      const queryClient = useQueryClient()
      const { i18n } = useTranslation()
      const preferences = useSessionPreferences()
      const nativeTheme = useTestColorScheme() === 'dark' ? 'dark' : 'light'
      queryClients.push(queryClient)
      i18nInstances.push(i18n)
      languages.push(i18n.language)
      themeSnapshots.push({ preference: preferences.themePreference, native: nativeTheme, setterCalls: setColorScheme.mock.calls.length })
      return <>
        <Text>{`${preferences.themePreference}|${nativeTheme}|${i18n.language}`}</Text>
        {(['light', 'dark', 'system'] as const).map((value) => (
          <Pressable key={value} accessibilityRole="button" accessibilityLabel={`theme-${value}`} onPress={() => preferences.setThemePreference(value)}>
            <Text>{value}</Text>
          </Pressable>
        ))}
      </>
    }

    function TestSessionPreferencesProvider({ children }: { children: ReactNode }) {
      const deviceTheme = useTestColorScheme()
      return <SessionPreferencesProvider deviceLocale="en" appearance={{ setColorScheme }} deviceTheme={deviceTheme}>{children}</SessionPreferencesProvider>
    }

    const view = await render(
      <TestSessionPreferencesProvider>
        <AppProviders locale="en" createSessionLifecycle={factory}>
          <StabilityProbe />
        </AppProviders>
      </TestSessionPreferencesProvider>,
    )
    expect(view.getByText('system|light|en')).toBeOnTheScreen()

    await fireEvent.press(view.getByRole('button', { name: 'theme-light' }))
    expect(setColorScheme).toHaveBeenLastCalledWith('light')
    expect(view.getByText('light|light|en')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'theme-dark' }))
    expect(setColorScheme).toHaveBeenLastCalledWith('dark')
    expect(view.getByText('dark|dark|en')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'theme-system' }))
    expect(setColorScheme).toHaveBeenLastCalledWith('unspecified')
    expect(view.getByText('system|light|en')).toBeOnTheScreen()

    expect(new Set(queryClients).size).toBe(1)
    expect(new Set(i18nInstances).size).toBe(1)
    expect(new Set(languages)).toEqual(new Set(['en']))
    expect(factory).toHaveBeenCalledTimes(1)
    expect(session.start).toHaveBeenCalledTimes(1)
    expect(session.dispose).not.toHaveBeenCalled()
    expect(themeSnapshots.filter(({ preference }) => preference !== 'system').every(({ preference, native, setterCalls }) => setterCalls > 0 && preference === native)).toBe(true)
    expect(themeSnapshots.some(({ preference, native, setterCalls }) => preference === 'system' && native === deviceScheme && setterCalls === 3)).toBe(true)
  })

  it('awaits prior disposal before starting a retry lifecycle', async () => {
    const disposal = deferred()
    const first = lifecycle({ status: 'recoverable-error' })
    first.dispose = jest.fn(() => disposal.promise)
    const second = lifecycle({ status: 'ready', session: null })
    const factory = jest.fn().mockReturnValueOnce(first).mockReturnValueOnce(second)
    const view = await render(
      <AppProviders locale="en" createSessionLifecycle={factory}>
        <Shell />
      </AppProviders>,
    )

    await fireEvent.press(view.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(first.dispose).toHaveBeenCalledTimes(1))
    expect(second.start).not.toHaveBeenCalled()

    disposal.resolve()
    await waitFor(() => expect(second.start).toHaveBeenCalledTimes(1))
    expect(view.getByText('Refresh|Loading')).toBeOnTheScreen()
  })

  it('serializes a genuinely changed factory without restarting for the same factory', async () => {
    const disposal = deferred()
    const first = lifecycle()
    first.dispose = jest.fn(() => disposal.promise)
    const second = lifecycle({ status: 'ready', session: null })
    const firstFactory = jest.fn(() => first)
    const secondFactory = jest.fn(() => second)
    const view = await render(
      <AppProviders locale="en" createSessionLifecycle={firstFactory}>
        <Shell />
      </AppProviders>,
    )

    await view.rerender(
      <AppProviders locale="en" createSessionLifecycle={firstFactory}>
        <Shell />
      </AppProviders>,
    )
    expect(firstFactory).toHaveBeenCalledTimes(1)

    await view.rerender(
      <AppProviders locale="en" createSessionLifecycle={secondFactory}>
        <Shell />
      </AppProviders>,
    )
    await waitFor(() => expect(first.dispose).toHaveBeenCalledTimes(1))
    expect(secondFactory).not.toHaveBeenCalled()
    expect(second.start).not.toHaveBeenCalled()

    disposal.resolve()
    await waitFor(() => expect(second.start).toHaveBeenCalledTimes(1))
    expect(secondFactory).toHaveBeenCalledTimes(1)
  })

  it('ignores stale notifications from a replaced lifecycle', async () => {
    const first = lifecycle()
    const second = lifecycle()
    const factory = jest.fn().mockReturnValueOnce(first).mockReturnValueOnce(second)
    const view = await render(
      <AppProviders locale="en" createSessionLifecycle={factory}>
        <Shell />
      </AppProviders>,
    )
    view.getByText('Loading')
    await act(async () => first.emit({ status: 'recoverable-error' }))
    await fireEvent.press(view.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(second.start).toHaveBeenCalledTimes(1))
    await act(async () => {
      first.emit({ status: 'ready', session: { userId: 'stale' } })
      second.emit({ status: 'recoverable-error' })
    })

    expect(view.getByRole('alert', { name: 'Could not load the app' })).toBeOnTheScreen()
    expect(view.queryByText('Refresh|Loading')).not.toBeOnTheScreen()
  })

  it('ignores completion and notifications from a prior started lifecycle', async () => {
    const oldStart = deferred()
    const first = lifecycle({ status: 'recoverable-error' })
    first.start = jest.fn(() => oldStart.promise)
    const second = lifecycle({ status: 'recoverable-error' })
    const factory = jest.fn().mockReturnValueOnce(first).mockReturnValueOnce(second)
    const view = await render(
      <AppProviders locale="en" createSessionLifecycle={factory}>
        <Shell />
      </AppProviders>,
    )

    await fireEvent.press(view.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(second.start).toHaveBeenCalledTimes(1))
    oldStart.resolve()
    await act(async () => {
      await oldStart.promise
      first.emit({ status: 'ready', session: { userId: 'stale' } })
    })

    expect(view.getByRole('alert', { name: 'Could not load the app' })).toBeOnTheScreen()
    expect(view.queryByText('Refresh|Loading')).not.toBeOnTheScreen()
  })

  it('renders children only while ready and removes them when disposed', async () => {
    const session = lifecycle()
    const view = await render(
      <AppProviders locale="en" createSessionLifecycle={() => session}>
        <Shell />
      </AppProviders>,
    )
    view.getByText('Loading')

    await act(async () => session.emit({ status: 'ready', session: null }))
    expect(view.getByText('Refresh|Loading')).toBeOnTheScreen()

    await act(async () => session.emit({ status: 'disposed' }))
    expect(view.queryByText('Refresh|Loading')).not.toBeOnTheScreen()
  })

  it('starts and subscribes once, then unsubscribes and disposes on unmount', async () => {
    const session = lifecycle()
    const unsubscribe = jest.fn()
    session.subscribe = jest.fn(() => unsubscribe)
    const view = await render(
      <AppProviders locale="en" createSessionLifecycle={() => session}>
        <Shell />
      </AppProviders>,
    )
    view.getByText('Loading')

    expect(session.start).toHaveBeenCalledTimes(1)
    expect(session.subscribe).toHaveBeenCalledTimes(1)
    await view.unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(session.dispose).toHaveBeenCalledTimes(1)
  })

  it('calls onReady once after translations can render', async () => {
    const onReady = jest.fn()
    const session = lifecycle()
    const factory = () => session
    const view = await render(
      <AppProviders locale="en" createSessionLifecycle={factory} onReady={onReady}>
        <Shell />
      </AppProviders>,
    )
    view.getByText('Loading')
    expect(onReady).toHaveBeenCalledTimes(1)

    await view.rerender(
      <AppProviders locale="en" createSessionLifecycle={factory} onReady={onReady}>
        <Shell />
      </AppProviders>,
    )
    expect(onReady).toHaveBeenCalledTimes(1)
  })

  it('exposes only the ready lifecycle session to descendants', async () => {
    const session = lifecycle({ status: 'ready', session: { userId: 'principal-a' } })
    const view = await render(
      <AppProviders locale="en" createSessionLifecycle={() => session}>
        <SessionProbe />
      </AppProviders>,
    )
    expect(view.getByText('principal-a')).toBeOnTheScreen()
  })

  it('retains the product runtime across lifecycle retry and purges A before activating B', async () => {
    type RuntimeSession = { user: { id: string }; access_token: string }
    const sessionA: RuntimeSession = { user: { id: 'a' }, access_token: 'token-a' }
    const sessionB: RuntimeSession = { user: { id: 'b' }, access_token: 'token-b' }
    const first = lifecycle<RuntimeSession>({ status: 'ready', session: sessionA })
    const second = lifecycle<RuntimeSession>({ status: 'ready', session: sessionB })
    const factory = jest.fn().mockReturnValueOnce(first).mockReturnValueOnce(second)
    const pendingA = deferred<string>()
    const runtimeMounts: string[] = []
    let observedClient!: QueryClient
    const createRuntime = jest.fn((input): ProductRuntime => ({
      epochId: input.epochId,
      principalId: input.principalId,
      apiClient: {} as never,
    }))
    const auth = {
      signInWithPassword: jest.fn(),
      signOutLocal: jest.fn(async () => ({ error: null })),
      getSession: jest.fn(async () => ({ data: { session: null }, error: null })),
    } as never

    function RuntimeFinancialObserver() {
      const { runtime } = useProductRuntime()
      const queryClient = useQueryClient()
      useEffect(() => {
        observedClient = queryClient
        runtimeMounts.push('mounted')
        return () => { runtimeMounts.push('unmounted') }
      }, [queryClient])
      const query = useQuery({
        queryKey: ['net-worth', runtime?.epochId ?? 'inactive'],
        enabled: runtime !== null,
        retry: false,
        queryFn: () => runtime?.principalId === 'a' ? pendingA.promise : Promise.resolve('value-b'),
      })
      return <Text>{`${runtime?.principalId ?? 'none'}:${runtime?.epochId ?? 'none'}:${query.data ?? 'loading'}`}</Text>
    }

    const view = await render(
      <AppProviders locale="en" createSessionLifecycle={factory}>
        <ProductRuntimeProvider
          auth={auth}
          transport={{ request: jest.fn() } as never}
          createRuntime={createRuntime}
        >
          <AuthenticatedRouteBoundary><RuntimeFinancialObserver /></AuthenticatedRouteBoundary>
        </ProductRuntimeProvider>
      </AppProviders>,
    )
    await waitFor(() => expect(view.getByText('a:1:loading')).toBeOnTheScreen())
    observedClient.setQueryData(['net-worth', 1], 'cached-a')

    await act(async () => first.emit({ status: 'recoverable-error' }))
    await waitFor(() => expect(observedClient.getQueryData(['net-worth', 1])).toBeUndefined())
    expect(view.queryByText(/a:1:/)).not.toBeOnTheScreen()

    await fireEvent.press(view.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(view.getByText('b:2:value-b')).toBeOnTheScreen())
    expect(createRuntime.mock.calls.map(([input]) => input.epochId)).toEqual([1, 2])
    expect(runtimeMounts).toEqual(['mounted', 'unmounted', 'mounted'])

    pendingA.resolve('late-a')
    await act(async () => { await pendingA.promise })
    expect(observedClient.getQueryData(['net-worth', 1])).toBeUndefined()
    expect(view.getByText('b:2:value-b')).toBeOnTheScreen()
    await view.unmount()
    observedClient.clear()
  })
})
