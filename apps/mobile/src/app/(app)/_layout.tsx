import { Stack } from 'expo-router'

import { AuthenticatedRouteBoundary } from '@/components/providers/authenticated-route-boundary'
import { OnboardingGate } from '@/features/onboarding/onboarding-gate'
import { AppLockGate } from '@/features/security/app-lock-gate'

export default function AuthenticatedLayout() {
  return (
    <AuthenticatedRouteBoundary>
      <AppLockGate>
        <OnboardingGate>
          <Stack screenOptions={{ animation: 'none', headerShown: false }}>
          <Stack.Screen name="(tabs)" />
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
          <Stack.Screen name="settings/notifications" />
          <Stack.Screen name="settings/security" />
          </Stack>
        </OnboardingGate>
      </AppLockGate>
    </AuthenticatedRouteBoundary>
  )
}
