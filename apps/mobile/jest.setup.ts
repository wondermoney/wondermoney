// Skia has no JS-only implementation; its own jest setup swaps in a headless mock so
// components using it (charts) can render in tests without native bindings.
import '@shopify/react-native-skia/jestSetup'

// victory-native (the chart library) pulls in reanimated transitively; its native worklets
// module has no JS fallback, so tests need reanimated's own official jest mock.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'))

// NetInfo has no JS-only implementation either; use its official jest mock so code that
// wires React Query's onlineManager to it (see src/lib/query/query-client.ts) can run in tests.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@react-native-community/netinfo', () => require('@react-native-community/netinfo/jest/netinfo-mock'))
