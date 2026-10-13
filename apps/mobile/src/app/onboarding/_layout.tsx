import { Stack } from 'expo-router'

/**
 * RAD-193 — this folder was the only route group in the app without an
 * explicit layout declaring its screens and their order. Without one,
 * Expo Router has no declared initial route for the implicit stack behind
 * the bare `Stack.Screen name="onboarding"` entry in root-router.tsx, and
 * `create-account` sorts before `index` alphabetically — reproduced in
 * production builds as every single sign-in landing directly on
 * create-account with no params, rather than the onboarding journey.
 */
export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'none' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="create-account" />
    </Stack>
  )
}
