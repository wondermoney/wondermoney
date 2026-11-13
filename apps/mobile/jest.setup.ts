import { timeoutManager } from '@tanstack/react-query'

// Skia has no JS-only implementation; its own jest setup swaps in a headless mock so
// components using it (charts) can render in tests without native bindings.
import '@shopify/react-native-skia/jestSetup'

// Gesture handler 3 (pulled in by expo-router and victory-native) installs native UI-runtime
// bindings when it loads; its own jest setup swaps in the mocked native module.
import 'react-native-gesture-handler/jestSetup'

// victory-native (the chart library) pulls in reanimated transitively; its native worklets
// module has no JS fallback, so tests need reanimated's own official jest mock.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'))

// Gesture handler 3 also reads the worklets UI runtime when it loads, which the non-native
// worklets build (see jest.config.js's resolver) refuses; worklets' own jest mock stands in.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'))

// NetInfo has no JS-only implementation either; use its official jest mock so code that
// wires React Query's onlineManager to it (see src/lib/query/query-client.ts) can run in tests.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@react-native-community/netinfo', () => require('@react-native-community/netinfo/jest/netinfo-mock'))

// React Query keeps an unused query or mutation for its gcTime (five minutes by default) on a real
// timer, and MutationCache.clear() leaves a mutation's timer running. A run in one process (as on
// a two-core CI runner, where maxWorkers resolves to 1) then sat idle for five minutes after the
// last test before Jest could exit. Unref'd timers still fire while the process is alive, so no
// test behaves differently; they just no longer keep it alive. The global timer functions are
// looked up at call time, so a test's fake timers still take over.
const unref = <T>(timer: T): T => {
  ;(timer as { unref?: () => void } | undefined)?.unref?.()
  return timer
}
timeoutManager.setTimeoutProvider({
  setTimeout: (callback, delay) => unref(setTimeout(callback, delay)),
  clearTimeout: (timer) => clearTimeout(timer),
  setInterval: (callback, delay) => unref(setInterval(callback, delay)),
  clearInterval: (timer) => clearInterval(timer),
})

// expo-notifications' native emitter has no jest stand-in: its listeners come back without
// `remove`. The signed-in shell subscribes to notification taps (features/notifications), so
// every test that renders it gets inert listeners; a test of that wiring mocks the module itself.
jest.mock('expo-notifications', () => ({
  ...jest.requireActual('expo-notifications'),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  clearLastNotificationResponseAsync: jest.fn(() => Promise.resolve()),
  getLastNotificationResponseAsync: jest.fn(() => Promise.resolve(null)),
  setNotificationHandler: jest.fn(),
}))
