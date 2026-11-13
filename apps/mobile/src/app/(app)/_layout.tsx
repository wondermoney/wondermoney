import { Stack, usePathname } from 'expo-router'
import { View } from 'react-native'

import { AuthenticatedRouteBoundary } from '@/components/providers/authenticated-route-boundary'
import { useOptionalProductRuntime } from '@/components/providers/product-runtime-provider'
import { showsTopBar } from '@/components/shell/navigation'
import { UnderTopBarProvider } from '@/components/ui/screen-safe-area'
import { DemoBanner, useIsDemoAccount } from '@/features/navigation/demo-banner'
import { usePushNotificationNavigation, usePushRegistrationRefresh } from '@/features/notifications/use-push-lifecycle'
import { installForegroundNotificationHandler } from '@/lib/push/push-device'
import { ShellTopBar } from '@/features/navigation/shell-top-bar'
import { OnboardingGate } from '@/features/onboarding/onboarding-gate'
import { AppLockGate } from '@/features/security/app-lock-gate'

// A notification that arrives while the app is open shows as a banner, as it would outside it.
installForegroundNotificationHandler()

export default function AuthenticatedLayout() {
  return (
    <AuthenticatedRouteBoundary>
      <AppLockGate>
        <OnboardingGate>
          <ProductShell />
        </OnboardingGate>
      </AppLockGate>
    </AuthenticatedRouteBoundary>
  )
}

/**
 * The demo strip needs the profile, which exists only with a signed-in runtime (and its query
 * client). Without one — tests, a transition — the shell renders without it, as the top bar does.
 */
function ProductShell() {
  return useOptionalProductRuntime()?.runtime ? <SignedInShell /> : <Shell demo={false} />
}

function SignedInShell() {
  // A tapped notification opens its screen; an opted-in phone stays registered (features/notifications).
  usePushNotificationNavigation()
  usePushRegistrationRefresh()
  return <Shell demo={useIsDemoAccount()} />
}

function Shell({ demo }: { demo: boolean }) {
  const pathname = usePathname()
  const topBar = showsTopBar(pathname)
  return (
    // One top bar for every product page (web TopBar.tsx), above the stack so it stays put
    // while pages change beneath it. It owns the top safe area, so screens' SafeAreaViews
    // (components/ui/screen-safe-area) drop their top edge while it shows. The demo strip sits
    // under it on every page, and takes the top safe area itself where the bar is hidden.
    <View style={{ flex: 1 }}>
      <ShellTopBar />
      {demo ? <DemoBanner ownsTopInset={!topBar} /> : null}
      <UnderTopBarProvider active={topBar || demo}>
        <Stack screenOptions={{ animation: 'none', headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="home/customize" />
          <Stack.Screen name="net-worth/history" />
          <Stack.Screen name="accounts/[accountId]" />
          <Stack.Screen name="accounts/create" />
          <Stack.Screen name="accounts/transactions" />
          <Stack.Screen name="accounts/transactions/create" />
          <Stack.Screen name="accounts/recurring" />
          <Stack.Screen name="accounts/[accountId]/transactions" />
          <Stack.Screen name="budgets/index" />
          <Stack.Screen name="budgets/create" />
          <Stack.Screen name="budgets/[budgetId]/[year]/[month]" />
          <Stack.Screen name="budgets/[budgetId]/edit" />
          <Stack.Screen name="budgets/[budgetId]/categories/add" />
          <Stack.Screen name="loans/index" />
          <Stack.Screen name="loans/[loanId]" />
          <Stack.Screen name="loans/[loanId]/edit" />
          <Stack.Screen name="assets/index" />
          <Stack.Screen name="assets/[assetId]" />
          <Stack.Screen name="assets/[assetId]/value" />
          <Stack.Screen name="assets/[assetId]/edit" />
          <Stack.Screen name="goals/[goalId]" />
          <Stack.Screen name="goals/create" />
          <Stack.Screen name="portfolio/[portfolioId]" />
          <Stack.Screen name="portfolio/create" />
          <Stack.Screen name="portfolio/[portfolioId]/settings" />
          <Stack.Screen name="portfolio/activity" />
          <Stack.Screen name="portfolio/[portfolioId]/activity" />
          <Stack.Screen name="settings/profile" />
          <Stack.Screen name="settings/profile/edit" />
          <Stack.Screen name="more/banking" />
          <Stack.Screen name="more/pending-changes" />
          <Stack.Screen name="settings/preferences" />
          <Stack.Screen name="settings/categories" />
          <Stack.Screen name="settings/categories/create" />
          <Stack.Screen name="settings/categories/[categoryId]/edit" />
          <Stack.Screen name="settings/rules" />
          <Stack.Screen name="settings/notifications" />
          <Stack.Screen name="settings/security" />
        </Stack>
      </UnderTopBarProvider>
    </View>
  )
}
