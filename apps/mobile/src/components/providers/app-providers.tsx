import { QueryClientProvider } from '@tanstack/react-query'
import type { i18n } from 'i18next'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { View } from 'react-native'

import { BootstrapScreen } from '@/features/bootstrap/bootstrap-screen'
import type { SessionLifecycleState } from '@/lib/auth/session-lifecycle'
import { initMobileI18n } from '@/lib/i18n'
import { createQueryClient, wireQueryClientToDeviceState } from '@/lib/query/query-client'

import { AppSessionProvider } from './app-session-context'

export type SessionLifecycle<Session = unknown> = {
  readonly state: SessionLifecycleState<Session>
  start: () => void | Promise<void>
  dispose: () => void | Promise<void>
  subscribe: (listener: (state: SessionLifecycleState<Session>) => void) => () => void
}

export type AppProvidersProps<Session = unknown> = {
  children: ReactNode
  locale: string
  createSessionLifecycle: () => SessionLifecycle<Session>
  onReady?: () => void
}

type ActiveLifecycle<Session> = {
  lifecycle: SessionLifecycle<Session>
  unsubscribe: () => void
}

export function AppProviders<Session>({
  children,
  locale,
  createSessionLifecycle,
  onReady,
}: AppProvidersProps<Session>) {
  const [queryClient] = useState(createQueryClient)
  const [i18nInstance, setI18nInstance] = useState<i18n | null>(null)
  const [lifecycleState, setLifecycleState] = useState<SessionLifecycleState<Session>>({ status: 'loading' })
  const [retryRequest, setRetryRequest] = useState(0)
  const readyNotified = useRef(false)
  const mounted = useRef(false)
  const activeLifecycle = useRef<ActiveLifecycle<Session> | null>(null)
  const latestRequest = useRef(0)
  const replacementQueue = useRef<Promise<void>>(Promise.resolve())

  const requestReplacement = useCallback((factory: () => SessionLifecycle<Session>) => {
    const request = ++latestRequest.current
    replacementQueue.current = replacementQueue.current
      .catch(() => undefined)
      .then(async () => {
        if (!mounted.current || request !== latestRequest.current) return

        const previous = activeLifecycle.current
        activeLifecycle.current = null
        previous?.unsubscribe()
        setLifecycleState({ status: 'loading' })

        if (previous) {
          await disposeLifecycle(previous.lifecycle)
        }

        if (!mounted.current || request !== latestRequest.current) return

        const lifecycle = factory()
        const active: ActiveLifecycle<Session> = {
          lifecycle,
          unsubscribe: () => undefined,
        }
        activeLifecycle.current = active
        setLifecycleState(lifecycle.state)
        active.unsubscribe = lifecycle.subscribe((nextState) => {
          if (mounted.current && activeLifecycle.current === active) {
            setLifecycleState(nextState)
          }
        })
        void Promise.resolve(lifecycle.start()).catch(() => undefined)
      })
  }, [])

  useEffect(() => {
    mounted.current = true

    return () => {
      mounted.current = false
      latestRequest.current += 1
      const active = activeLifecycle.current
      activeLifecycle.current = null
      active?.unsubscribe()
      if (active) void disposeLifecycle(active.lifecycle)
    }
  }, [])

  // Wires React Query's online/focus managers to real NetInfo connectivity and AppState
  // foreground events (see wireQueryClientToDeviceState for why this is required on RN).
  useEffect(() => wireQueryClientToDeviceState(), [])

  useEffect(() => {
    requestReplacement(createSessionLifecycle)
  }, [createSessionLifecycle, requestReplacement, retryRequest])

  useEffect(() => {
    let current = true
    if (i18nInstance) {
      void i18nInstance.changeLanguage(locale)
      return () => { current = false }
    }
    void initMobileI18n(locale).then((instance) => { if (current) setI18nInstance(instance) })

    return () => {
      current = false
    }
  }, [i18nInstance, locale])

  useEffect(() => {
    if (i18nInstance && onReady && !readyNotified.current) {
      readyNotified.current = true
      onReady()
    }
  }, [i18nInstance, onReady])

  const retry = useCallback(() => {
    setRetryRequest((current) => current + 1)
  }, [])

  if (!i18nInstance) return null

  const bootstrapLabels = {
    loadingLabel: i18nInstance.t('loading'),
    errorLabel: i18nInstance.t('error'),
    retryLabel: i18nInstance.t('retry'),
  }

  let bootstrap: ReactNode = null
  if (lifecycleState.status === 'loading') {
    bootstrap = <BootstrapScreen status="loading" {...bootstrapLabels} />
  } else if (lifecycleState.status === 'recoverable-error') {
    bootstrap = <BootstrapScreen status="recoverable-error" onRetry={retry} {...bootstrapLabels} />
  } else if (lifecycleState.status === 'disposed') {
    bootstrap = <BootstrapScreen status="loading" {...bootstrapLabels} />
  }

  const productVisible = lifecycleState.status === 'ready'
  const session = productVisible ? lifecycleState.session : null

  return (
    <I18nextProvider i18n={i18nInstance}>
      <QueryClientProvider client={queryClient}>
        <View style={{ flex: 1 }}>
          <View
            style={{ flex: 1, display: productVisible ? 'flex' : 'none' }}
            pointerEvents={productVisible ? 'auto' : 'none'}
            accessibilityElementsHidden={!productVisible}
            importantForAccessibility={productVisible ? 'auto' : 'no-hide-descendants'}
          >
            <AppSessionProvider session={session}>{children}</AppSessionProvider>
          </View>
          {bootstrap}
        </View>
      </QueryClientProvider>
    </I18nextProvider>
  )
}

async function disposeLifecycle(lifecycle: SessionLifecycle) {
  try {
    await lifecycle.dispose()
  } catch {
    // Disposal failure must not break serialized replacement or unmount cleanup.
  }
}
