import React from 'react'
import { act, render, waitFor } from '@testing-library/react-native'

const mockPreventAutoHideAsync = jest.fn(async () => undefined)
const mockHideAsync = jest.fn(async () => undefined)
const originalPublicEnvironment = {
  EXPO_PUBLIC_APP_ENV: process.env.EXPO_PUBLIC_APP_ENV,
  EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
  EXPO_PUBLIC_POSTHOG_KEY: process.env.EXPO_PUBLIC_POSTHOG_KEY,
}
let mockReleaseLifecycleStart!: () => void
let mockLifecycleListener: ((state: { status: 'ready'; session: null }) => void) | undefined
let mockDependencyInput: Record<string, unknown> | undefined
const mockLifecycleStartGate = new Promise<void>((resolve) => {
  mockReleaseLifecycleStart = resolve
})

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: mockPreventAutoHideAsync,
  hideAsync: mockHideAsync,
}))

jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en' }],
}))

const mockPasswordRecoverySentinel = { __sentinel: 'passwordRecovery' } as never

// This suite runs with EXPO_PUBLIC_APP_ENV=local, an approved capture
// environment, so the root layout really does reach the Sentry client factory.
// Mocked so the suite never starts the real SDK: no native module lookups, no
// global ErrorUtils patching, no envelope cache written to disk.
const mockSentryInit = jest.fn()
jest.mock('@sentry/react-native', () => ({
  __esModule: true,
  init: (options: Record<string, unknown>) => mockSentryInit(options),
  captureException: jest.fn(),
}))

jest.mock('@/lib/runtime/live-app-dependencies', () => ({
  createLiveAppDependencies: (input: Record<string, unknown>) => {
    mockDependencyInput = input
    return {
    status: 'available',
    dependencies: {
      auth: {},
      transport: {},
      passwordRecovery: mockPasswordRecoverySentinel,
      runtimeFactory: jest.fn(),
      errorReporting: { environment: 'local' },
      apiBaseUrl: 'http://localhost:3001',
      usesDefaultServer: true,
      createSessionLifecycle: () => ({
        state: { status: 'loading' },
        subscribe: (listener: (state: { status: 'ready'; session: null }) => void) => {
          mockLifecycleListener = listener
          return () => { mockLifecycleListener = undefined }
        },
        start: async () => {
          await mockLifecycleStartGate
          mockLifecycleListener?.({ status: 'ready', session: null })
        },
        dispose: async () => undefined,
      }),
    },
    }
  },
}))

jest.mock('expo-router', () => {
  const ReactModule = jest.requireActual<typeof React>('react')
  return {
    DarkTheme: { dark: true },
    DefaultTheme: { dark: false },
    ThemeProvider: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
  }
})

jest.mock('@/features/root/root-router', () => {
  const ReactModule = jest.requireActual<typeof React>('react')
  const Native = jest.requireActual<typeof import('react-native')>('react-native')
  return { RootRouter: () => ReactModule.createElement(Native.Text, null, 'root-router') }
})

let mockPasswordRecoveryAdapter: unknown
jest.mock('@/components/providers/password-recovery-provider', () => {
  const ReactModule = jest.requireActual<typeof React>('react')
  return {
    PasswordRecoveryProvider: ({ adapter, children }: { adapter: unknown; children: React.ReactNode }) => {
      mockPasswordRecoveryAdapter = adapter
      return ReactModule.createElement(ReactModule.Fragment, null, children)
    },
  }
})

jest.mock('react-native-safe-area-context', () => {
  const ReactModule = jest.requireActual<typeof React>('react')
  const Native = jest.requireActual<typeof import('react-native')>('react-native')

  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement(Native.View, null, children),
    SafeAreaView: ({ children, ...props }: React.ComponentProps<typeof Native.View>) =>
      ReactModule.createElement(Native.View, props, children),
  }
})

describe('RootLayout splash and provider integration', () => {
  afterAll(() => {
    for (const [key, value] of Object.entries(originalPublicEnvironment)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('owns splash startup and reveals the router only after translated bootstrap readiness', async () => {
    process.env.EXPO_PUBLIC_APP_ENV = 'local'
    process.env.EXPO_PUBLIC_API_BASE_URL = 'http://localhost:3001'
    process.env.EXPO_PUBLIC_POSTHOG_KEY = 'phc_test'
    // Require after Jest has installed mocks so module-level splash ownership is observable.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const RootLayout = require('../app/_layout').default as React.ComponentType

    expect(mockDependencyInput).toEqual({
      EXPO_PUBLIC_APP_ENV: 'local',
      EXPO_PUBLIC_API_BASE_URL: 'http://localhost:3001',
      EXPO_PUBLIC_POSTHOG_KEY: 'phc_test',
    })

    // Crash reporting is installed from the validated environment at the
    // same point in startup as analytics, before any screen mounts.
    expect(mockSentryInit).toHaveBeenCalledTimes(1)
    expect(mockSentryInit.mock.calls[0]?.[0]).toMatchObject({
      dsn: 'https://397525327286be42f3f2f5d7cc89ac28@o438497.ingest.us.sentry.io/4511944590622720',
      environment: 'local',
      tracesSampleRate: 0,
    })

    expect(mockPreventAutoHideAsync).toHaveBeenCalledTimes(1)
    expect(mockHideAsync).not.toHaveBeenCalled()

    const pendingRender = render(<RootLayout />)
    expect(mockHideAsync).not.toHaveBeenCalled()

    const view = await pendingRender
    // The hidden (display: none) children tree — including PasswordRecoveryProvider — mounts
    // as soon as i18n bootstrap resolves, before the session lifecycle reaches "ready". Asserting
    // reference identity here proves _layout.tsx really routes
    // dependencies.dependencies.passwordRecovery into PasswordRecoveryProvider's adapter prop.
    expect(mockPasswordRecoveryAdapter).toBe(mockPasswordRecoverySentinel)
    expect(view.getByRole('progressbar', { name: 'Loading' })).toBeOnTheScreen()
    expect(view.queryByText('root-router')).not.toBeOnTheScreen()
    expect(mockHideAsync).toHaveBeenCalledTimes(1)

    mockReleaseLifecycleStart()
    await act(async () => {
      await mockLifecycleStartGate
    })
    await waitFor(() => expect(view.getByText('root-router')).toBeOnTheScreen())

    expect(view.queryByRole('progressbar', { name: 'Loading' })).not.toBeOnTheScreen()
    expect(mockHideAsync).toHaveBeenCalledTimes(1)
    await view.unmount()
  })

  it('shows startup recovery for unavailable configuration and releases the splash', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { RootRuntime } = require('../app/_layout') as typeof import('../app/_layout')
    mockHideAsync.mockClear()

    const view = await render(
      <RootRuntime dependencies={{ status: 'unavailable' }} locale="en" />,
    )

    expect(view.getByText('WonderMoney could not start')).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Retry startup' })).toBeOnTheScreen()
    await waitFor(() => expect(mockHideAsync).toHaveBeenCalledTimes(1))
    await view.unmount()
  })
})
