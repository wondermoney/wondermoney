import { Stack } from 'expo-router'

/**
 * Declares this route group's screens and their order explicitly. Without
 * it, Expo Router has no declared initial route for the implicit stack behind
 * the bare `Stack.Screen name="onboarding"` entry in root-router.tsx, and
 * `create-account` sorts before `index` alphabetically, so every sign-in
 * would land directly on create-account with no params rather than the
 * onboarding journey.
 */
export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'none' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="create-account" />
    </Stack>
  )
}
