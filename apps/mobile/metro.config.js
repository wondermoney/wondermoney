// This Metro config exists only so Sentry can stamp a Debug ID into the JS
// bundle and the matching source map.
//
// `getSentryExpoConfig` is Expo's own `getDefaultConfig(__dirname)` with Sentry's
// serializer wrapped around it, so the bundling behaviour is otherwise unchanged.
// Without the Debug ID, the source maps the `@sentry/react-native/expo` config
// plugin uploads during a release build cannot be matched to the bundle that
// produced a stack trace, and crash reports stay minified.
//
// See docs/telemetry-adr-sentry.md and app.config.ts's Sentry plugin entry.
const { getSentryExpoConfig } = require('@sentry/react-native/metro')

const config = getSentryExpoConfig(__dirname)

// Test files are colocated with routes under src/app (e.g. src/app/sign-in.test.tsx).
// Expo Router's file-based routing (and its typed-routes require.context sweep)
// picks them up as routes and tries to bundle @testing-library/react-native into
// the app itself, which references Node's `console` module and can't resolve in
// a React Native bundle. Test files should never ship in any bundle regardless,
// so exclude them from Metro entirely; Jest resolves modules independently and
// is unaffected.
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList) ? config.resolver.blockList : [config.resolver.blockList].filter(Boolean)),
  /\.test\.[jt]sx?$/,
  /\/__tests__\//,
]

module.exports = config
