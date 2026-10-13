import * as Linking from 'expo-linking'
import { type Href, useRouter } from 'expo-router'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { useProfile } from '@/features/self/use-self-resource'
import { captureAnalyticsEvent } from '@/lib/telemetry/analytics'

import { getRuntimeAppDisplayInfo } from './app-display-info'
import {
  buildFeedbackMailDestination,
  buildSupportMailDestination,
  externalDestinations,
  isApprovedExternalDestination,
} from './link-policy'
import { MoreScreen } from './more-screen'

const openApprovedExternal = async (destination: string) => {
  if (!isApprovedExternalDestination(destination)) throw new Error('Unapproved destination')
  await Linking.openURL(destination)
}

export function MoreRoute() {
  const appInfo = getRuntimeAppDisplayInfo()
  const router = useRouter()
  const { signOut } = useProductRuntime()
  const profile = useProfile()
  return (
    <MoreScreen
      appInfo={appInfo}
      email={profile.data?.profile.emailAddress}
      onLogout={signOut}
      onOpenBudgets={() => router.push('/budgets' as unknown as Href)}
      onOpenLoans={() => router.push('/loans' as unknown as Href)}
      onOpenProfile={() => router.push('/settings/profile' as unknown as Href)}
      onOpenBankConnections={() => router.push('/more/banking' as unknown as Href)}
      onOpenGoals={() => router.push('/goals' as unknown as Href)}
      onOpenMarkets={() => router.push('/markets' as unknown as Href)}
      onOpenReports={() => router.push('/reports' as unknown as Href)}
      onOpenPreferences={() => router.push('/settings/preferences' as unknown as Href)}
      onOpenCategories={() => router.push('/settings/categories' as unknown as Href)}
      onOpenHousehold={() => router.push('/settings/household' as unknown as Href)}
      onOpenNotifications={() => router.push('/settings/notifications' as unknown as Href)}
      onOpenSecurity={() => router.push('/settings/security' as unknown as Href)}
      onOpenHelp={() => openApprovedExternal(externalDestinations.help)}
      onOpenWhatsNew={() => openApprovedExternal(externalDestinations.whatsNew)}
      onOpenPrivacy={() => openApprovedExternal(externalDestinations.privacy)}
      onOpenTerms={() => openApprovedExternal(externalDestinations.terms)}
      onOpenSupport={async () => {
        if (!appInfo) throw new Error('App information unavailable')
        const destination = buildSupportMailDestination(appInfo)
        if (!destination) throw new Error('Support destination unavailable')
        await Linking.openURL(destination)
      }}
      onSubmitFeedback={async (input) => {
        if (!appInfo) throw new Error('App information unavailable')
        const destination = buildFeedbackMailDestination(appInfo, input)
        if (!destination) throw new Error('Feedback destination unavailable')
        await Linking.openURL(destination)
        // RAD-518 — the category only. `input.message` is the user's own words
        // and stays in the mail channel it was written for; see link-policy.ts.
        captureAnalyticsEvent('feedback_submitted', { category: input.category })
      }}
    />
  )
}
