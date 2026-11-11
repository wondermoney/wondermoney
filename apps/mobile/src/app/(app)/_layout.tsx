import { Stack, usePathname } from 'expo-router'
import { View } from 'react-native'

import { AuthenticatedRouteBoundary } from '@/components/providers/authenticated-route-boundary'
import { showsTopBar } from '@/components/shell/navigation'
import { UnderTopBarProvider } from '@/components/ui/screen-safe-area'
import { ShellTopBar } from '@/features/navigation/shell-top-bar'
import { OnboardingGate } from '@/features/onboarding/onboarding-gate'
import { AppLockGate } from '@/features/security/app-lock-gate'

export default function AuthenticatedLayout() {
  const pathname = usePathname()
  return (
    <AuthenticatedRouteBoundary>
      <AppLockGate>
        <OnboardingGate>
          {/* One top bar for every product page (web TopBar.tsx), above the
              stack so it stays put while pages change beneath it. It owns the
              top safe area, so screens' SafeAreaViews (components/ui/screen-safe-area)
              drop their top edge while it shows. */}
          <View style={{ flex: 1 }}>
          <ShellTopBar />
          <UnderTopBarProvider active={showsTopBar(pathname)}>
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
        </OnboardingGate>
      </AppLockGate>
    </AuthenticatedRouteBoundary>
  )
}
