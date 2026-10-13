module.exports = {
  preset: 'jest-expo',
  // Jest's default worker count (numCPUs - 1) assumes the machine is otherwise idle. On this
  // dev box that's frequently not true (other local processes -- emulators, browser automation,
  // other concurrent test runs -- routinely push load average well above the core count), and
  // under that contention several heavier component suites (multiple providers, i18n init,
  // several re-renders) sporadically exceeded the default 5000ms test timeout -- a different
  // set of suites failing each full-suite run, while every one of them passed instantly in
  // isolation. Keeping our own worker count modest avoids compounding that contention with
  // self-inflicted time-slicing.
  maxWorkers: '25%',
  // Generous headroom above the 5000ms default for the same contention reason above: legitimate,
  // non-slow tests can still need much more wall-clock time when the OS scheduler is starving
  // worker processes under heavy host load. This is a safety margin on top of the maxWorkers
  // fix, not a substitute for it -- a genuinely hanging test still fails, just with more slack
  // for scheduling jitter that has nothing to do with the test itself.
  testTimeout: 20000,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testPathIgnorePatterns: ['<rootDir>/.slim/', '<rootDir>/.worktrees/', '<rootDir>/.claude/worktrees/'],
  modulePathIgnorePatterns: ['<rootDir>/.slim/', '<rootDir>/.worktrees/', '<rootDir>/.claude/worktrees/'],
  moduleNameMapper: {
    // Mirrors tsconfig.json's paths: '@/assets/*' resolves to the repo-root assets
    // folder and must be matched before the general '@/*' -> src/* mapping below.
    '^@/assets/(.*)$': '<rootDir>/assets/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // Forces react-native-worklets (reanimated's native engine, pulled in transitively by
  // victory-native) to resolve its non-native build in tests instead of its native module.
  resolver: 'react-native-worklets/jest/resolver.js',
  // better-auth's Expo plugin is published as ESM .mjs modules. Transform those
  // modules with the same Expo Babel preset used for the application's JS.
  transform: {
    '^.+\\.mjs$': [
      'babel-jest',
      {
        root: '<rootDir>',
        babelrcRoots: '<rootDir>',
        babelrc: true,
        configFile: true,
        presets: ['expo/internal/babel-preset'],
        caller: { name: 'metro', bundler: 'metro', platform: 'ios' },
      },
    ],
  },
  // jest-expo's default transformIgnorePatterns doesn't cover victory-native/react-native-skia
  // (they ship untranspiled ESM), so the chart feature's imports fail to parse without this.
  transformIgnorePatterns: [
    '/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|standard-navigation|victory-native|@shopify/react-native-skia|@better-auth|@better-fetch|@better-call|better-auth|jose|nanostores|d3-.*|internmap))',
    '/node_modules/react-native-reanimated/plugin/',
    '/node_modules/@react-native/babel-preset/',
  ],
}
