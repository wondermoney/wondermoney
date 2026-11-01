import type { ExpoConfig } from 'expo/config'

// JSON, not the sibling .ts module: Expo's config loader transpiles app.config.ts alone
// and cannot resolve a TypeScript import. See src/lib/auth/google-oauth-clients.ts.
import googleOAuthClients from './src/lib/auth/google-oauth-clients.json'

const config: ExpoConfig = {
  name: 'WonderMoney',
  slug: 'wondermoney',
  version: '1.0.1',
  orientation: 'default',
  icon: './assets/images/icon.png',
  scheme: 'wondermoney',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: 'money.wonder.app',
    supportsTablet: true,
    icon: './assets/images/icon.png',
    // Adds the com.apple.developer.applesignin entitlement the native flow needs.
    usesAppleSignIn: true,
    infoPlist: {
      // The app only uses standard HTTPS/TLS (exempt) and SHA-256 hashing for
      // OAuth nonces (not encryption) — no proprietary/non-exempt encryption.
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: 'money.wonder.app',
    adaptiveIcon: {
      backgroundColor: '#845EC2',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // SYSTEM_ALERT_WINDOW is a leftover React Native dev-menu/error-overlay permission
    // that was leaking into the main manifest (and so into release builds too, not just
    // the debug-only manifest that legitimately wants it) -- unused by anything this app
    // ships and a Play Store review flag for a financial app. Blocking it here strips it
    // from every variant, including local debug builds; if that turns out to actually
    // break the RN dev menu/error overlay on-device, delete this line -- it's a one-line
    // revert, not a rebuild-from-scratch.
    blockedPermissions: ['android.permission.SYSTEM_ALERT_WINDOW'],
  },
  web: {
    output: 'static',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#ffffff',
        image: './assets/images/wondermoney-logo.png',
        imageWidth: 240,
      },
    ],
    // Both plugins write the same Info.plist key (NSFaceIDUsageDescription); giving
    // expo-secure-store `false` here silently deleted expo-local-authentication's real
    // string regardless of array order (Expo's mod composition doesn't apply per-plugin
    // Info.plist edits in array order for a shared key). SecureStore itself never
    // triggers a biometric prompt in this app (see secure-session-storage.ts's
    // `requireAuthentication: false`), so the same real copy is accurate for both.
    ['expo-secure-store', { faceIDPermission: 'Allow WonderMoney to use Face ID to unlock the app.' }],
    ['expo-local-authentication', { faceIDPermission: 'Allow WonderMoney to use Face ID to unlock the app.' }],
    'expo-apple-authentication',
    // Registers the reversed iOS client ID as a URL scheme so Google's SDK can hand the
    // sign-in result back to the app. Android needs no scheme (Credential Manager).
    ['react-native-nitro-google-signin', { iosUrlScheme: googleOAuthClients.iosUrlScheme }],
    // Sentry source-map upload. This plugin does nothing at runtime: during prebuild it
    // writes ios/android `sentry.properties` from the values below and injects the upload
    // step into each native build (an Xcode "Upload Debug Symbols" phase, `sentry.gradle`
    // on Android), so a release build ships symbolicated stack traces. The org and project
    // slugs are not secrets, but they must stay consistent with the DSN in
    // src/lib/telemetry/error-reporting.ts — a mismatch uploads source maps to one project
    // while events land in another, which silently costs you symbolication.
    // The auth token is deliberately not passed here — the plugin would write it into the
    // app package. It is read from SENTRY_AUTH_TOKEN, which must exist as an EAS secret
    // before the first production build.
    [
      '@sentry/react-native/expo',
      {
        url: 'https://sentry.io/',
        organization: 'wonder-money',
        project: 'mobile',
      },
    ],
    'expo-localization',
    'expo-image',
    'expo-web-browser',
    'expo-sharing',
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  owner: 'nip10',
  extra: {
    eas: {
      projectId: '2245b75c-7f6f-42b6-9e80-f03178b9ebdb',
    },
  },
}

export default config
