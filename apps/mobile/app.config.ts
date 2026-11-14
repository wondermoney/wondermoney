import { parseEnv } from '@expo/env'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ExpoConfig } from 'expo/config'
import { type ConfigPlugin, withGradleProperties, withProjectBuildGradle } from 'expo/config-plugins'

// JSON, not the sibling .ts module: Expo's config loader transpiles app.config.ts alone
// and cannot resolve a TypeScript import. See src/lib/auth/google-oauth-clients.ts.
import googleOAuthClients from './src/lib/auth/google-oauth-clients.json'

// EAS's free Android builder (4 vCPUs, 16 GB) runs out of memory on a release build, the
// kernel kills the Gradle daemon, and the build ends "Gradle build daemon disappeared
// unexpectedly". Three things share the memory:
// - The Gradle daemon. EAS fixes its heap at 4 GB through GRADLE_OPTS, which outranks
//   gradle.properties.
// - The Kotlin daemon. Without its own setting it inherits that 4 GB heap, and it keeps the
//   memory after the Kotlin compiles finish. It gets its own 2 GB cap here.
// - C++ compilers. Each native module's CMake build runs Ninja, which starts nproc + 2
//   (six) compilers at once whatever Gradle's worker count is. So two Gradle workers meant
//   up to twelve clang processes on four CPUs, each holding up to about a gigabyte for
//   React Native's headers. A Ninja job pool caps each build at two compiles: two workers
//   then run four compilers, one per CPU, which is no slower.
// `bundleRelease` (production AAB) runs the native builds last, after every Kotlin compile,
// so they hit full JVMs. `assembleRelease` (preview APK) runs them first, which is why only
// production builds failed. Phones only need the two ARM ABIs (x86/x86_64 are emulators and
// some Chromebooks).
const NATIVE_COMPILE_JOBS_PER_BUILD = 2
const RELEASE_GRADLE_PROPERTIES: Record<string, string> = {
  reactNativeArchitectures: 'armeabi-v7a,arm64-v8a',
  'org.gradle.workers.max': '2',
  'kotlin.daemon.jvmargs': '-Xmx2g -XX:MaxMetaspaceSize=1g',
}

const withReleaseGradleProperties: ConfigPlugin = (expoConfig) =>
  withGradleProperties(expoConfig, (gradleConfig) => {
    for (const [key, value] of Object.entries(RELEASE_GRADLE_PROPERTIES)) {
      gradleConfig.modResults = gradleConfig.modResults.filter(
        (item) => item.type !== 'property' || item.key !== key,
      )
      gradleConfig.modResults.push({ type: 'property', key, value })
    }
    return gradleConfig
  })

// Adds the Ninja job pools to every Android module's CMake arguments. finalizeDsl runs after
// each module's own build script, so the arguments are added to the module's own, not
// replaced. This is how the React Native Gradle plugin adds its defaults. The block must come
// before the root-project plugins: com.facebook.react.rootproject evaluates the subprojects
// as it is applied, and finalizeDsl can't be registered once a module has been evaluated.
const NATIVE_JOB_POOL_MARKER = '// wondermoney: native compile job pool (app.config.ts)'
const NATIVE_JOB_POOL_GRADLE = `${NATIVE_JOB_POOL_MARKER}
subprojects { subproject ->
  ['com.android.application', 'com.android.library'].each { pluginId ->
    subproject.pluginManager.withPlugin(pluginId) {
      subproject.extensions.getByName('androidComponents').finalizeDsl { android ->
        android.defaultConfig.externalNativeBuild.cmake.arguments.addAll([
          '-DCMAKE_JOB_POOLS=compile=${NATIVE_COMPILE_JOBS_PER_BUILD};link=1',
          '-DCMAKE_JOB_POOL_COMPILE=compile',
          '-DCMAKE_JOB_POOL_LINK=link',
        ])
      }
    }
  }
}
`

const withNativeJobPool: ConfigPlugin = (expoConfig) =>
  withProjectBuildGradle(expoConfig, (gradleConfig) => {
    if (gradleConfig.modResults.language !== 'groovy') {
      throw new Error('withNativeJobPool expects a Groovy android/build.gradle')
    }
    const { contents } = gradleConfig.modResults
    if (contents.includes(NATIVE_JOB_POOL_MARKER)) return gradleConfig
    const firstPluginApply = contents.search(/^apply plugin:/m)
    if (firstPluginApply === -1) {
      throw new Error('withNativeJobPool found no `apply plugin:` line in android/build.gradle')
    }
    gradleConfig.modResults.contents =
      contents.slice(0, firstPluginApply) + NATIVE_JOB_POOL_GRADLE + '\n' + contents.slice(firstPluginApply)
    return gradleConfig
  })

// The Expo CLI loads .env files before evaluating this config, but EAS CLI turns that off
// (EXPO_NO_DOTENV), so read these keys from the gitignored .env.local here. A value already
// in the environment (an EAS Build worker, or the shell) wins.
const EAS_PROJECT_KEYS = ['WONDERMONEY_EXPO_OWNER', 'WONDERMONEY_EAS_PROJECT_ID', 'WONDERMONEY_GOOGLE_SERVICES_FILE', 'WONDERMONEY_PASSKEY_DOMAINS'] as const
const localEnvFile = join(__dirname, '.env.local')
if (existsSync(localEnvFile)) {
  const localEnv = parseEnv(readFileSync(localEnvFile, 'utf8'))
  for (const key of EAS_PROJECT_KEYS) {
    if (!process.env[key] && localEnv[key]) process.env[key] = localEnv[key]
  }
}

const EXPO_OWNER = process.env.WONDERMONEY_EXPO_OWNER
const EAS_PROJECT_ID = process.env.WONDERMONEY_EAS_PROJECT_ID
// Android push goes through Firebase Cloud Messaging, which needs the Firebase project's
// google-services.json in the build. A path (an EAS file environment variable, or a local file
// kept out of the repository); without it the app builds and runs, but Android gets no push token.
const GOOGLE_SERVICES_FILE = process.env.WONDERMONEY_GOOGLE_SERVICES_FILE
// Passkeys (react-native-passkeys): the hostnames whose passkeys this build may use, comma-separated
// (`money.example.com`). A passkey belongs to the web app's hostname, the relying party ID the
// server reports as `features.passkeyRpId`, and iOS and Android hand one to an app only when that
// hostname's `/.well-known` files name the app (served by the web app, from its environment).
// iOS also needs a `webcredentials:` entitlement per hostname, which needs the Associated Domains
// capability on the App ID. Fixed at build time, so the app hides passkeys on any other server.
// Empty: no entitlement and no passkeys. README.md, "Passkeys".
const PASSKEY_DOMAINS = [...new Set((process.env.WONDERMONEY_PASSKEY_DOMAINS ?? '')
  .split(',')
  .map((domain: string) => domain.trim().toLowerCase())
  .filter((domain: string) => /^[a-z\d-]+(?:\.[a-z\d-]+)+$/.test(domain)))]

const config: ExpoConfig = {
  name: 'WonderMoney',
  slug: 'wondermoney',
  version: '1.0.3',
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
    ...(PASSKEY_DOMAINS.length > 0 ? { associatedDomains: PASSKEY_DOMAINS.map((domain) => `webcredentials:${domain}`) } : {}),
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
    ...(GOOGLE_SERVICES_FILE ? { googleServicesFile: GOOGLE_SERVICES_FILE } : {}),
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
    // Transaction attachments: a photo of a receipt or document. The picker is also used to
    // choose an existing image, so both usage strings are set.
    ['expo-image-picker', {
      cameraPermission: 'Allow WonderMoney to take a photo of a receipt or document.',
      photosPermission: 'Allow WonderMoney to choose a photo of a receipt or document.',
    }],
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
    // Push notifications (features/notifications). The app asks for permission only when a
    // person turns a push category on. `default` is the Android channel the API sends to.
    ['expo-notifications', { defaultChannel: 'default' }],
    // The QR pairing scanner. The plugin writes iOS's NSCameraUsageDescription and Android's
    // CAMERA permission; without it the camera module has no usage string and iOS rejects the
    // request at runtime.
    ['expo-camera', { cameraPermission: 'Allow WonderMoney to scan the QR code that connects this phone to your server.' }],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  // The Expo account and EAS project are the maintainer's (or a fork's), not part of the
  // source: they come from the environment, with no defaults. Without them the app still
  // runs locally; EAS commands need both. See README.md, "EAS configuration".
  ...(EXPO_OWNER ? { owner: EXPO_OWNER } : {}),
  extra: {
    ...(EAS_PROJECT_ID ? { eas: { projectId: EAS_PROJECT_ID } } : {}),
    // Read at runtime by src/lib/auth/passkey-availability.ts.
    passkeyDomains: PASSKEY_DOMAINS,
  },
}

export default withNativeJobPool(withReleaseGradleProperties(config))
